import { NEVER_RELOAD } from '@uniswap/redux-multicall'
import { useWeb3React } from '@web3-react/core'
import { SupportedInterfaceChainId, getChain, useSupportedChainId } from 'constants/chains'
import { useAccount } from 'hooks/useAccount'
import useCurrentBlockTimestamp from 'hooks/useCurrentBlockTimestamp'
import useBlockNumber, { useFastForwardBlockNumber } from 'lib/hooks/useBlockNumber'
import ms from 'ms'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CanceledError, RetryableError, retry } from 'state/activity/polling/retry'
import { OnActivityUpdate } from 'state/activity/types'
import { useAppDispatch } from 'state/hooks'
import { isPendingTx, useMultichainTransactions, useTransactionRemover } from 'state/transactions/hooks'
import { checkedTransaction, markCrossChainSwapBridgePending } from 'state/transactions/reducer'

import { PendingTransactionDetails, TransactionType } from 'state/transactions/types'
import { waitForBridge, type BridgeProviderId } from 'lib/crossChain/bridge'
import { getBridgeProvider } from 'lib/crossChain/engine/registry'
import { trackerFor } from 'lib/crossChain/engine/pickRail'


import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { FeatureFlags } from 'uniswap/src/features/gating/flags'
import { useFeatureFlag } from 'uniswap/src/features/gating/hooks'
import { InterfaceChainId, RetryOptions } from 'uniswap/src/types/chains'
import { SUBSCRIPTION_CHAINIDS } from 'utilities/src/apollo/constants'

interface Transaction {
  addedTime: number
  receipt?: unknown
  lastCheckedBlockNumber?: number
}

export function shouldCheck(lastBlockNumber: number, tx: Transaction): boolean {
  if (tx.receipt) {
    return false
  }
  if (!tx.lastCheckedBlockNumber) {
    return true
  }
  const blocksSinceCheck = lastBlockNumber - tx.lastCheckedBlockNumber
  if (blocksSinceCheck < 1) {
    return false
  }
  const minutesPending = (new Date().getTime() - tx.addedTime) / ms(`1m`)
  if (minutesPending > 60) {
    // every 10 blocks if pending longer than an hour
    return blocksSinceCheck > 9
  } else if (minutesPending > 5) {
    // every 3 blocks if pending longer than 5 minutes
    return blocksSinceCheck > 2
  } else {
    // otherwise every block
    return true
  }
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = { n: 1, minWait: 0, maxWait: 0 }

function usePendingTransactions(chainId?: SupportedInterfaceChainId) {
  const multichainTransactions = useMultichainTransactions()
  return useMemo(() => {
    if (!chainId) {
      return []
    }
    return multichainTransactions.flatMap(([tx, txChainId]) => {
      if (isPendingTx(tx) && txChainId === chainId) {
        return tx
      } else {
        return []
      }
    })
  }, [chainId, multichainTransactions])
}

export function usePollPendingTransactions(onActivityUpdate: OnActivityUpdate) {
  const realtimeEnabled = useFeatureFlag(FeatureFlags.Realtime)
  const { provider } = useWeb3React()
  const account = useAccount()

  const pendingTransactions = usePendingTransactions(
    // We can skip polling when the app's current chain is supported by the subscription service.
    realtimeEnabled &&
      account.chainId &&
      (SUBSCRIPTION_CHAINIDS as unknown as InterfaceChainId[]).includes(account.chainId)
      ? undefined
      : account.chainId,
  )
  const supportedChain = useSupportedChainId(account.chainId)
  const hasPending = pendingTransactions.length > 0
  const blockTimestamp = useCurrentBlockTimestamp(hasPending ? undefined : NEVER_RELOAD)

  const lastBlockNumber = useBlockNumber()
  const fastForwardBlockNumber = useFastForwardBlockNumber()
  const removeTransaction = useTransactionRemover()
  const dispatch = useAppDispatch()

  const getReceipt = useCallback(
    (tx: PendingTransactionDetails) => {
      if (!provider || !supportedChain) {
        throw new Error('No provider or chainId')
      }
      const retryOptions =
        getChain({ chainId: supportedChain })?.pendingTransactionsRetryOptions ?? DEFAULT_RETRY_OPTIONS
      return retry(
        () =>
          provider.getTransactionReceipt(tx.hash).then(async (receipt) => {
            if (receipt === null) {
              if (account.isConnected) {
                // Remove transactions past their deadline or - if there is no deadline - older than 6 hours.
                if (tx.deadline) {
                  // Deadlines are expressed as seconds since epoch, as they are used on-chain.
                  if (blockTimestamp && tx.deadline < blockTimestamp.toNumber()) {
                    removeTransaction(tx.hash)
                  }
                } else if (tx.addedTime + ms(`6h`) < Date.now()) {
                  removeTransaction(tx.hash)
                }
              }
              throw new RetryableError()
            }
            return receipt
          }),
        retryOptions,
      )
    },
    [account.isConnected, blockTimestamp, provider, removeTransaction, supportedChain],
  )

  useEffect(() => {
    if (!account.chainId || !provider || !lastBlockNumber || !hasPending) {
      return
    }

    const cancels = pendingTransactions
      .filter((tx) => shouldCheck(lastBlockNumber, tx))
      // Skip CROSS_CHAIN_SWAP txs that are already waiting for bridge leg delivery
      .filter((tx) => !tx.bridgePending)

      .map((tx) => {
        const { promise, cancel } = getReceipt(tx)
        promise
          .then((receipt) => {
            if (!account.chainId) {
              return
            }
            fastForwardBlockNumber(receipt.blockNumber)

            // For BRIDGE / CROSS_CHAIN_SWAP: src-chain confirmed → keep Pending, start bridge-leg polling.
            // Some providers (Across) need a depositId from the receipt to poll completion.
            if (
              (tx.info.type === TransactionType.CROSS_CHAIN_SWAP || tx.info.type === TransactionType.BRIDGE) &&
              receipt.status === 1
            ) {
              // XChainSender providers read an id from the receipt; Relay txs track by order id.
              const depositId =
                tx.info.bridgeProtocol === 'relay'
                  ? undefined
                  : getBridgeProvider(tx.info.bridgeProtocol).getDepositId?.(receipt.logs)
              dispatch(markCrossChainSwapBridgePending({ chainId: account.chainId, hash: tx.hash, depositId }))
              return
            }


            onActivityUpdate({
              type: 'transaction',
              chainId: account.chainId,
              original: tx,
              update: {
                status: receipt.status === 1 ? TransactionStatus.Confirmed : TransactionStatus.Failed,
                info: tx.info,
              },
            })
          })
          .catch((error) => {
            if (error instanceof CanceledError || !account.chainId) {
              return
            }
            dispatch(checkedTransaction({ chainId: account.chainId, hash: tx.hash, blockNumber: lastBlockNumber }))
          })
        return cancel
      })

    return () => {
      cancels.forEach((cancel) => cancel())
    }
  }, [
    account.chainId,
    provider,
    lastBlockNumber,
    getReceipt,
    pendingTransactions,
    fastForwardBlockNumber,
    hasPending,
    dispatch,
    onActivityUpdate,
  ])
}

const BRIDGE_TIMEOUT = ms('2h')

/**
 * Poll the tx's bridge provider (`bridgeProtocol`, see lib/crossChain/engine) for pending bridge-leg txs:
 * - BRIDGE txs (standalone bridge)
 * - CROSS_CHAIN_SWAP txs once src-chain leg confirmed (tx.bridgePending === true)
 * Dispatches per tx's `bridgeProtocol`. Uses a ref to track active polls so re-renders
 * don't abort in-flight requests.
 */
export function usePollPendingBridgeTransactions(onActivityUpdate: OnActivityUpdate) {
  const account = useAccount()
  const multichainTransactions = useMultichainTransactions()

  const pendingBridgeTxs = useMemo(() => {
    return multichainTransactions.flatMap(([tx, txChainId]) => {
      if (!isPendingTx(tx)) {
        return []
      }
      // Only once the src-chain tx is confirmed (bridgePending), so the bridge leg is polled after it.
      const isBridgeLeg =
        (tx.info.type === TransactionType.BRIDGE || tx.info.type === TransactionType.CROSS_CHAIN_SWAP) &&
        tx.bridgePending
      if (isBridgeLeg) {
        return [{ tx, chainId: txChainId }]
      }
      return []
    })
  }, [multichainTransactions])

  const activePolls = useRef(new Map<string, AbortController>())

  const onActivityUpdateRef = useRef(onActivityUpdate)
  useEffect(() => {
    onActivityUpdateRef.current = onActivityUpdate
  }, [onActivityUpdate])

  // Unmount: stop every poll (otherwise they keep fetching and dispatching forever).
  useEffect(() => {
    const polls = activePolls.current
    return () => {
      polls.forEach((ctrl) => ctrl.abort())
      polls.clear()
    }
  }, [])

  useEffect(() => {
    if (!account.isConnected) {
      activePolls.current.forEach((ctrl) => ctrl.abort())
      activePolls.current.clear()
      return
    }

    const currentHashes = new Set(pendingBridgeTxs.map((t) => t.tx.hash))

    // Abort polls for txs no longer pending
    for (const [hash, ctrl] of activePolls.current) {
      if (!currentHashes.has(hash)) {
        ctrl.abort()
        activePolls.current.delete(hash)
      }
    }

    // Start polls only for new txs
    for (const { tx, chainId } of pendingBridgeTxs) {
      if (activePolls.current.has(tx.hash)) {continue}

      const ctrl = new AbortController()
      activePolls.current.set(tx.hash, ctrl)

      const info = tx.info as { bridgeProtocol?: BridgeProviderId; depositId?: string; aggregatorOrderId?: string }
      const waitPromise = waitForBridge(
        trackerFor(info, tx.hash),
        { hash: tx.hash, srcChainId: chainId, depositId: info.depositId },
        ctrl.signal,
        // Both BRIDGE and CROSS_CHAIN_SWAP: past this the tx is marked Failed (funds sit with fallbackReceiver/bridge refund).
        tx.addedTime + BRIDGE_TIMEOUT,
      )

      waitPromise
        .then(() => {
          activePolls.current.delete(tx.hash)
          onActivityUpdateRef.current({
            type: 'transaction',
            chainId,
            original: tx,
            update: { status: TransactionStatus.Confirmed, info: tx.info },
          })
        })
        .catch((err) => {
          activePolls.current.delete(tx.hash)
          if (err?.message === 'Aborted') {return}
          onActivityUpdateRef.current({
            type: 'transaction',
            chainId,
            original: tx,
            update: { status: TransactionStatus.Failed, info: tx.info },
          })
        })
    }
  }, [pendingBridgeTxs, account.isConnected])
}
