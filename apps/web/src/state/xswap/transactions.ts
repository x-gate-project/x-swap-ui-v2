import { InfiniteData, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_TXN_DISMISS_MS } from 'constants/misc'
import { NATIVE_CHAIN_ID } from 'constants/tokens'
import { useAccount } from 'hooks/useAccount'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAddPopup } from 'state/application/hooks'
import { PopupType } from 'state/application/reducer'
import { useAppDispatch } from 'state/hooks'
import { useMultichainTransactions } from 'state/transactions/hooks'
import { addTransaction } from 'state/transactions/reducer'
import {
  ApproveTransactionInfo,
  TransactionDetails,
  TransactionType,
  XSwapDepositTransactionInfo,
} from 'state/transactions/types'
import { isXSwapApiEnabled, registerXSwapOrder } from 'state/xswap/client'
import { decodeXSwapApproval } from 'state/xswap/execute'
import { useXSwapOrderHistory, xswapQueryKeys } from 'state/xswap/hooks'
import { XSwapOrder, XSwapOrdersPage, XSwapQuote, XSwapTx } from 'state/xswap/types'
import { isXSwapNativeAddress } from 'state/xswap/utils'
import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { InterfaceChainId } from 'uniswap/src/types/chains'
import { logger } from 'utilities/src/logger/logger'

/** The panel registers the order itself right after the deposit; only a deposit still unregistered after this is retried. */
const REGISTER_GRACE_MS = 60_000
/** Older deposits are left alone: their quote is long gone from the API. */
const REGISTER_MAX_AGE_MS = 24 * 60 * 60 * 1000
const REGISTER_CHECK_INTERVAL_MS = 30_000

function currencyId(address: string): string {
  return isXSwapNativeAddress(address) ? NATIVE_CHAIN_ID : address
}

/** How a sent tx of `quote` is kept in the local transaction store. */
export function xswapTxInfo(
  tx: XSwapTx,
  quote: XSwapQuote,
): ApproveTransactionInfo | XSwapDepositTransactionInfo | undefined {
  if (tx.kind === 'deposit') {
    return {
      type: TransactionType.XSWAP_DEPOSIT,
      quoteId: quote.quoteId,
      routeClass: quote.routeClass,
      inputChainId: quote.tokenIn.chainId,
      inputCurrencyId: currencyId(quote.tokenIn.address),
      inputCurrencyAmountRaw: quote.inputAmount,
      outputChainId: quote.tokenOut.chainId,
      outputCurrencyId: currencyId(quote.tokenOut.address),
      expectedOutputCurrencyAmountRaw: quote.outputAmount,
    }
  }
  const approval = decodeXSwapApproval(tx)
  return approval
    ? { type: TransactionType.APPROVAL, tokenAddress: approval.token, spender: approval.spender, amount: approval.amount }
    : undefined
}

/**
 * Adds a tx the x-swap panel sent to the local transaction store, so it gets a pending row in Activity and its toasts
 * (pending now, confirmed / failed once the activity updater sees its receipt).
 */
export function useXSwapTxAdder(): (tx: XSwapTx, hash: string, quote: XSwapQuote, from: string) => void {
  const dispatch = useAppDispatch()
  const addPopup = useAddPopup()
  return useCallback(
    (tx: XSwapTx, hash: string, quote: XSwapQuote, from: string) => {
      // Bookkeeping only: it must never fail the swap.
      try {
        const info = xswapTxInfo(tx, quote)
        if (!info) {
          return
        }
        dispatch(addTransaction({ chainId: tx.chainId as InterfaceChainId, hash, from, info }))
        addPopup({ type: PopupType.Transaction, hash }, hash, DEFAULT_TXN_DISMISS_MS)
      } catch (error) {
        logger.warn('xswap/transactions', 'useXSwapTxAdder', `could not track ${tx.kind} ${hash}`, error)
      }
    },
    [addPopup, dispatch],
  )
}

function sameHash(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Puts a just-registered order at the top of the wallet's cached order history, so its row replaces the deposit's at
 * once instead of on the next poll, then refetches the history.
 */
export function useAddXSwapOrderToHistory(): (order: XSwapOrder) => void {
  const queryClient = useQueryClient()
  return useCallback(
    (order: XSwapOrder) => {
      const queryKey = xswapQueryKeys.orders(order.swapper)
      queryClient.setQueryData<InfiniteData<XSwapOrdersPage, string | undefined>>(queryKey, (data) => {
        if (!data || data.pages.some((page) => page.orders.some((o) => sameHash(o.originTxHash, order.originTxHash)))) {
          return data
        }
        const [first, ...rest] = data.pages
        return { ...data, pages: [{ ...first, orders: [order, ...first.orders] }, ...rest] }
      })
      queryClient.invalidateQueries({ queryKey })
    },
    [queryClient],
  )
}

type XSwapDeposit = TransactionDetails & { info: XSwapDepositTransactionInfo }

/**
 * Deposits of `account` that should have an order by now and have none in `registered` (lowercased origin tx hashes):
 * sent at least `REGISTER_GRACE_MS` ago and less than `REGISTER_MAX_AGE_MS` ago, and not reverted or cancelled.
 */
export function findUnregisteredXSwapDeposits(
  transactions: TransactionDetails[],
  account: string,
  registered: ReadonlySet<string>,
  now: number,
): XSwapDeposit[] {
  return transactions.filter(
    (tx): tx is XSwapDeposit =>
      tx.info.type === TransactionType.XSWAP_DEPOSIT &&
      sameHash(tx.from, account) &&
      tx.status !== TransactionStatus.Failed &&
      !tx.cancelled &&
      now - tx.addedTime >= REGISTER_GRACE_MS &&
      now - tx.addedTime < REGISTER_MAX_AGE_MS &&
      !registered.has(tx.hash.toLowerCase()),
  )
}

/**
 * Registers (`POST /v1/orders`) deposits the connected wallet sent whose order the API does not list, e.g. the page
 * was closed before the panel registered it or every attempt failed. Each deposit is tried once per page load.
 */
export function XSwapRegistrationUpdater() {
  const account = useAccount()
  const address = account.status === 'connected' ? account.address : undefined
  const transactions = useMultichainTransactions()
  const history = useXSwapOrderHistory(address)
  const addToHistory = useAddXSwapOrderToHistory()
  const attempted = useRef(new Set<string>())
  const [now, setNow] = useState(() => Date.now())

  const deposits = useMemo(
    () =>
      address
        ? transactions.flatMap(([tx]) =>
            tx.info.type === TransactionType.XSWAP_DEPOSIT && sameHash(tx.from, address) ? [tx] : [],
          )
        : [],
    [address, transactions],
  )

  // A deposit becomes due once its grace period is over: check again from time to time while some are in the store.
  const waiting = deposits.some((tx) => now - tx.addedTime < REGISTER_GRACE_MS)
  useEffect(() => {
    if (!waiting) {
      return undefined
    }
    const interval = setInterval(() => setNow(Date.now()), REGISTER_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [waiting])

  useEffect(() => {
    // Only a listing the API answered tells which deposits have no order.
    if (!address || !isXSwapApiEnabled() || !history.isSuccess || history.isFetching) {
      return
    }
    const registered = new Set(
      history.data.pages.flatMap((page) => page.orders.map((order) => order.originTxHash.toLowerCase())),
    )
    findUnregisteredXSwapDeposits(deposits, address, registered, now)
      .filter((tx) => !attempted.current.has(tx.hash.toLowerCase()))
      .forEach((tx) => {
        attempted.current.add(tx.hash.toLowerCase())
        registerXSwapOrder({ quoteId: tx.info.quoteId, txHash: tx.hash })
          .then(addToHistory)
          .catch((error) =>
            logger.warn('xswap/transactions', 'XSwapRegistrationUpdater', `could not register ${tx.hash}`, error),
          )
      })
  }, [addToHistory, address, deposits, history.data, history.isFetching, history.isSuccess, now])

  return null
}
