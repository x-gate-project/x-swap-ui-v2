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
import { fetchAcrossDepositStatus, extractAcrossDepositId } from 'lib/crossChain/bridge/across'


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

            // For CROSS_CHAIN_SWAP: src-chain confirmed → keep Pending, start bridge-leg polling.
            // Across needs depositId (from FundsDeposited event) to poll GET /deposit/status.
            if (
              tx.info.type === TransactionType.CROSS_CHAIN_SWAP &&
              receipt.status === 1
            ) {
              const depositId =
                tx.info.bridgeProtocol === 'across' ? extractAcrossDepositId(receipt.logs) : undefined
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
const LZ_POLL_INTERVAL = 5000

// Testnet chainIds that should use scan-testnet.layerzero-api.com
const LZ_TESTNET_CHAIN_IDS = new Set([
  11155111, // Sepolia
  80001,    // Mumbai
  97,       // BSC testnet
  421613,   // Arbitrum Goerli
  420,      // Optimism Goerli
  43113,    // Fuji (Avalanche testnet)
  84531,    // Base Goerli
  10081,    // JOC testnet
])

/**
 * Poll LZ V2 API until DELIVERED or FAILED.
 * Uses testnet endpoint for testnet chains (e.g. Sepolia).
 */
async function waitForLzDelivered(txHash: string, srcChainId: number, signal: AbortSignal): Promise<void> {
  const isTestnet = LZ_TESTNET_CHAIN_IDS.has(srcChainId)
  const baseUrl = isTestnet
    ? 'https://scan-testnet.layerzero-api.com/v1'
    : 'https://scan.layerzero-api.com/v1'

  while (!signal.aborted) {
    try {
      const res = await fetch(`${baseUrl}/messages/tx/${txHash}`, { signal })
      if (res.ok) {
        const data = await res.json()
        const message = data?.data?.[0]
        if (message?.status?.name === 'DELIVERED') return
        if (message?.status?.name === 'FAILED') {
          throw new Error(`LZ message failed: ${message?.dstTxError ?? 'unknown'}`)
        }
      }
    } catch (err) {
      if (signal.aborted) break
      // Re-throw FAILED errors, swallow network errors (retry next interval)
      if (err instanceof Error && err.message.startsWith('LZ message failed')) throw err
    }
    await new Promise((r) => setTimeout(r, LZ_POLL_INTERVAL))
  }
  throw new Error('Aborted')
}

const ACROSS_POLL_INTERVAL = 5000

/**
 * Poll Across `GET /deposit/status` until 'filled' (or terminal failure state).
 * See integration-guide-bridge.md §Bước G.
 */
async function waitForAcrossFilled(originChainId: number, depositId: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      const { status } = await fetchAcrossDepositStatus(originChainId, depositId)
      if (status === 'filled') return
      if (status === 'expired' || status === 'refunded') {
        throw new Error(`Across deposit ${status}`)
      }
    } catch (err) {
      if (signal.aborted) break
      if (err instanceof Error && err.message.startsWith('Across deposit')) throw err
    }
    await new Promise((r) => setTimeout(r, ACROSS_POLL_INTERVAL))
  }
  throw new Error('Aborted')
}

/**
 * Poll LayerZero V2 (OFT tokens) or Across (all other tokens) for pending bridge-leg txs:
 * - BRIDGE txs (standalone bridge)
 * - CROSS_CHAIN_SWAP txs once src-chain leg confirmed (tx.bridgePending === true)
 * Dispatches per tx's `bridgeProtocol`. Uses a ref to track active polls so re-renders
 * don't abort in-flight requests.
 */
export function usePollPendingBridgeTransactions(onActivityUpdate: OnActivityUpdate) {
  const account = useAccount()
  const multichainTransactions = useMultichainTransactions()
  const removeTransaction = useTransactionRemover()

  const pendingBridgeTxs = useMemo(() => {
    return multichainTransactions.flatMap(([tx, txChainId]) => {
      if (!isPendingTx(tx)) {
        return []
      }
      const isBridge = tx.info.type === TransactionType.BRIDGE
      const isCrossChainSwapBridgeLeg = tx.info.type === TransactionType.CROSS_CHAIN_SWAP && tx.bridgePending
      if (isBridge || isCrossChainSwapBridgeLeg) {
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

  const removeTransactionRef = useRef(removeTransaction)
  useEffect(() => {
    removeTransactionRef.current = removeTransaction
  }, [removeTransaction])

  useEffect(() => {
    if (!account.isConnected) return

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
      if (activePolls.current.has(tx.hash)) continue

      // Timeout guard — only for standalone BRIDGE txs (matches prior behavior;
      // CROSS_CHAIN_SWAP bridge-leg was never subject to this timeout).
      if (tx.info.type === TransactionType.BRIDGE && Date.now() - tx.addedTime > BRIDGE_TIMEOUT) {
        removeTransactionRef.current(tx.hash)
        continue
      }

      const ctrl = new AbortController()
      activePolls.current.set(tx.hash, ctrl)

      const bridgeProtocol =
        tx.info.type === TransactionType.BRIDGE || tx.info.type === TransactionType.CROSS_CHAIN_SWAP
          ? tx.info.bridgeProtocol ?? 'lz'
          : 'lz'
      const depositId =
        tx.info.type === TransactionType.BRIDGE || tx.info.type === TransactionType.CROSS_CHAIN_SWAP
          ? tx.info.depositId
          : undefined

      const waitPromise =
        bridgeProtocol === 'across'
          ? depositId
            ? waitForAcrossFilled(chainId, depositId, ctrl.signal)
            : Promise.reject(new Error('Across bridge tx missing depositId'))
          : waitForLzDelivered(tx.hash, chainId, ctrl.signal)

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
          if (err?.message === 'Aborted') return
          onActivityUpdateRef.current({
            type: 'transaction',
            chainId,
            original: tx,
            update: { status: TransactionStatus.Failed, info: tx.info },
          })
        })
    }

    return () => {
      if (!pendingBridgeTxs.length) {
        activePolls.current.forEach((ctrl) => ctrl.abort())
        activePolls.current.clear()
      }
    }
  }, [pendingBridgeTxs, account.isConnected])
}
