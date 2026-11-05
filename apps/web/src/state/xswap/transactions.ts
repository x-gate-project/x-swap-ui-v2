import { InfiniteData, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_TXN_DISMISS_MS } from 'constants/misc'
import { NATIVE_CHAIN_ID } from 'constants/tokens'
import { useAccount } from 'hooks/useAccount'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAddPopup } from 'state/application/hooks'
import { PopupType } from 'state/application/reducer'
import { useAppDispatch, useAppSelector } from 'state/hooks'
import { addTransaction } from 'state/transactions/reducer'
import {
  ApproveTransactionInfo,
  TransactionDetails,
  TransactionType,
  XSwapDepositTransactionInfo,
} from 'state/transactions/types'
import { isXSwapApiEnabled, registerXSwapOrder } from 'state/xswap/client'
import { decodeXSwapApproval, isDefiniteXSwapRegisterError } from 'state/xswap/execute'
import { useXSwapOrderHistory, xswapQueryKeys } from 'state/xswap/hooks'
import { XSwapOrder, XSwapOrdersPage, XSwapQuote, XSwapTx } from 'state/xswap/types'
import { isXSwapNativeAddress } from 'state/xswap/utils'
import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { InterfaceChainId, WEB_SUPPORTED_CHAIN_IDS } from 'uniswap/src/types/chains'
import { logger } from 'utilities/src/logger/logger'

/** The panel registers the order itself right after the deposit; only a deposit still unregistered after this is retried. */
const REGISTER_GRACE_MS = 60_000
/** Older deposits are left alone: their quote is long gone from the API. */
const REGISTER_MAX_AGE_MS = 24 * 60 * 60 * 1000
const REGISTER_CHECK_INTERVAL_MS = 30_000
/** Tries of a deposit that fails with a transient error (network, 429, 5xx) before it is left for the next page load. */
const REGISTER_MAX_ATTEMPTS = 5

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
  // A `permit2-approve` is kept as an APPROVAL of the token to the deposit target, though it is Permit2's allowance,
  // not an ERC-20 one: nothing reading APPROVAL rows may take it for the token's ERC-20 allowance of that spender.
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
 * mined (a pending deposit is `tx_not_found` to the API), sent at least `REGISTER_GRACE_MS` ago and less than
 * `REGISTER_MAX_AGE_MS` ago, and not cancelled. `listedSince` is the time (ms) of the oldest order loaded when the
 * history has more pages: an older deposit may be registered on a page not loaded, so it is left alone.
 */
export function findUnregisteredXSwapDeposits(
  transactions: TransactionDetails[],
  account: string,
  registered: ReadonlySet<string>,
  now: number,
  listedSince?: number,
): XSwapDeposit[] {
  return transactions.filter(
    (tx): tx is XSwapDeposit =>
      tx.info.type === TransactionType.XSWAP_DEPOSIT &&
      sameHash(tx.from, account) &&
      tx.status === TransactionStatus.Confirmed &&
      !tx.cancelled &&
      now - tx.addedTime >= REGISTER_GRACE_MS &&
      now - tx.addedTime < REGISTER_MAX_AGE_MS &&
      (listedSince === undefined || tx.addedTime >= listedSince) &&
      !registered.has(tx.hash.toLowerCase()),
  )
}

/** The time (ms) of the oldest order in `pages`, or undefined when there are none. */
function oldestOrderTime(pages: XSwapOrdersPage[]): number | undefined {
  const times = pages.flatMap((page) => page.orders.map((order) => Date.parse(order.createdAt)))
  return times.length ? Math.min(...times) : undefined
}

/**
 * Registers (`POST /v1/orders`) deposits the connected wallet sent whose order the API does not list, e.g. the page
 * was closed before the panel registered it or every attempt failed. A deposit is tried until it registers or the API
 * gives a definite answer, at most `REGISTER_MAX_ATTEMPTS` times per page load.
 */
export function XSwapRegistrationUpdater() {
  const account = useAccount()
  const address = account.status === 'connected' ? account.address : undefined
  const transactionsByChain = useAppSelector((state) => state.transactions)
  const history = useXSwapOrderHistory(address)
  const addToHistory = useAddXSwapOrderToHistory()
  // Lowercased hashes: registered or definitely refused, being registered, and the failed attempts so far.
  const settled = useRef(new Set<string>())
  const inFlight = useRef(new Set<string>())
  const failures = useRef(new Map<string, number>())
  const [now, setNow] = useState(() => Date.now())

  const deposits = useMemo(
    () =>
      address
        ? WEB_SUPPORTED_CHAIN_IDS.flatMap((chainId) =>
            Object.values(transactionsByChain[chainId] ?? {}).filter(
              (tx) => tx.info.type === TransactionType.XSWAP_DEPOSIT && sameHash(tx.from, address),
            ),
          )
        : [],
    [address, transactionsByChain],
  )

  // A deposit becomes due once its grace period is over, and a failed one once it may be retried: check again from
  // time to time while some wait.
  const [retrying, setRetrying] = useState(false)
  const waiting = retrying || deposits.some((tx) => now - tx.addedTime < REGISTER_GRACE_MS)
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
    const { pages } = history.data
    const registered = new Set(pages.flatMap((page) => page.orders.map((order) => order.originTxHash.toLowerCase())))
    const listedSince = history.hasNextPage ? oldestOrderTime(pages) : undefined
    const due = findUnregisteredXSwapDeposits(deposits, address, registered, now, listedSince).filter((tx) => {
      const hash = tx.hash.toLowerCase()
      return (
        !settled.current.has(hash) &&
        !inFlight.current.has(hash) &&
        (failures.current.get(hash) ?? 0) < REGISTER_MAX_ATTEMPTS
      )
    })
    due.forEach((tx) => {
      const hash = tx.hash.toLowerCase()
      inFlight.current.add(hash)
      registerXSwapOrder({ quoteId: tx.info.quoteId, txHash: tx.hash })
        .then((order) => {
          settled.current.add(hash)
          addToHistory(order)
        })
        .catch((error) => {
          logger.warn('xswap/transactions', 'XSwapRegistrationUpdater', `could not register ${tx.hash}`, error)
          if (isDefiniteXSwapRegisterError(error)) {
            settled.current.add(hash)
          } else {
            failures.current.set(hash, (failures.current.get(hash) ?? 0) + 1)
          }
        })
        .finally(() => {
          inFlight.current.delete(hash)
          setRetrying(
            [...failures.current].some(
              ([failed, count]) => count < REGISTER_MAX_ATTEMPTS && !settled.current.has(failed),
            ),
          )
        })
    })
  }, [addToHistory, address, deposits, history.data, history.hasNextPage, history.isFetching, history.isSuccess, now])

  return null
}
