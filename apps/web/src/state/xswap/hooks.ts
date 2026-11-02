import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useFallbackListTokens } from 'hooks/Tokens'
import useDebounce from 'hooks/useDebounce'
import { useCallback, useMemo } from 'react'
import {
  getXSwapChains,
  getXSwapOrder,
  getXSwapOrders,
  getXSwapQuote,
  getXSwapTokens,
  isXSwapApiEnabled,
} from 'state/xswap/client'
import { XSwapError, getXSwapErrorMessage, toXSwapError } from 'state/xswap/errors'
import {
  XSWAP_TERMINAL_ORDER_STATUSES,
  XSwapChain,
  XSwapOrder,
  XSwapQuoteRequest,
  XSwapQuoteResponse,
  XSwapToken,
} from 'state/xswap/types'
import {
  XSwapChainMode,
  XSwapFlow,
  getXSwapChainMode,
  getXSwapFlow,
  isSameXSwapToken,
  isXSwapNativeAddress,
  percentToBps,
  toXSwapAddress,
  xswapTokenKey,
  xswapTokenToCurrency,
} from 'state/xswap/utils'
import { InterfaceChainId } from 'uniswap/src/types/chains'

// Chains and tokens are API config: refetch often enough that switching a chain or class off shows up without a
// release or a reload.
const CATALOG_STALE_TIME_MS = 60_000
const QUOTE_STALE_TIME_MS = 15_000
const QUOTE_DEBOUNCE_MS = 300
const ORDER_POLL_MS = 3_000
const ORDER_HISTORY_POLL_MS = 15_000

export const xswapQueryKeys = {
  chains: ['xswap', 'chains'] as const,
  tokens: (chainId?: number) => ['xswap', 'tokens', chainId] as const,
  quotes: ['xswap', 'quote'] as const,
  quote: (params?: XSwapQuoteRequest) => ['xswap', 'quote', params] as const,
  order: (id?: string) => ['xswap', 'order', id] as const,
  orders: (wallet?: string) => ['xswap', 'orders', wallet?.toLowerCase()] as const,
}

/** `GET /v1/chains`: chains enabled in API config. Empty while loading or when the API is disabled. */
export function useXSwapChains({ enabled = true }: { enabled?: boolean } = {}): {
  chains: XSwapChain[]
  chainIds?: number[]
  loading: boolean
} {
  const { data, isLoading } = useQuery({
    queryKey: xswapQueryKeys.chains,
    queryFn: ({ signal }) => getXSwapChains(signal),
    enabled: enabled && isXSwapApiEnabled(),
    staleTime: CATALOG_STALE_TIME_MS,
  })
  return useMemo(
    () => ({ chains: data ?? [], chainIds: data?.map((c) => c.chainId), loading: isLoading }),
    [data, isLoading],
  )
}

/**
 * Whether `chainId` uses the API (`api`) or the token lists and client-side router (`legacy`). A chain the API does
 * not enable, or every chain when `GET /v1/chains` fails, falls back to `legacy` so chains the API does not serve yet
 * (e.g. mainnets while it runs testnets only) keep working.
 */
export function useXSwapChainMode(chainId?: number, { enabled = true }: { enabled?: boolean } = {}): XSwapChainMode {
  const apiEnabled = enabled && isXSwapApiEnabled()
  const { chainIds, loading } = useXSwapChains({ enabled: apiEnabled })
  return getXSwapChainMode({ apiEnabled, chainId, chainIds, loading })
}

/** `GET /v1/tokens?chainId=`. */
function useXSwapTokens(chainId?: number, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: xswapQueryKeys.tokens(chainId),
    queryFn: ({ signal }) => getXSwapTokens(chainId as number, signal),
    enabled: enabled && isXSwapApiEnabled() && !!chainId,
    staleTime: CATALOG_STALE_TIME_MS,
  })
}

export type XSwapTokenEntry = { token: XSwapToken; currency: Currency }

/**
 * The API token list of a chain as SDK currencies. A token also present in the local token lists reuses that
 * instance so it keeps its logo and tags.
 */
export function useXSwapTokenCurrencies(
  chainId?: InterfaceChainId,
  { enabled = true }: { enabled?: boolean } = {},
): { entries: XSwapTokenEntry[]; loading: boolean } {
  const { data: tokens, isLoading } = useXSwapTokens(chainId, { enabled })
  const listTokens = useFallbackListTokens(chainId)
  const { chains } = useXSwapChains({ enabled })
  const wrappedNative = chains.find((c) => c.chainId === chainId)?.wrappedNative

  const entries = useMemo(() => {
    if (!tokens) {
      return []
    }
    const listTokensByAddress = new Map(Object.values(listTokens).map((t) => [t.address.toLowerCase(), t]))
    return tokens.map((token) => {
      const listToken = isXSwapNativeAddress(token.address)
        ? undefined
        : listTokensByAddress.get(token.address.toLowerCase())
      const currency =
        listToken && listToken.chainId === token.chainId ? listToken : xswapTokenToCurrency(token, wrappedNative)
      return { token, currency }
    })
  }, [listTokens, tokens, wrappedNative])

  return { entries, loading: isLoading }
}

type XSwapQuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  /** `refreshing`: a background re-quote of the same request is in flight; the shown answer stays usable. */
  | { status: 'success'; response: XSwapQuoteResponse; flow: XSwapFlow; refreshing: boolean }
  | { status: 'error'; error: XSwapError; message: string }

type UseXSwapQuoteArgs = {
  inputCurrency?: Currency
  outputCurrency?: Currency
  /** Exact input amount. The API only quotes EXACT_INPUT. */
  inputAmount?: CurrencyAmount<Currency>
  swapper?: string
  /** User slippage; undefined lets the API pick its default. */
  slippage?: Percent
  enabled?: boolean
  /** Re-quote interval so a shown quote does not go stale (default 15 s); false while the user executes one. */
  refetchIntervalMs?: number | false
}

export function buildXSwapQuoteRequest({
  inputCurrency,
  outputCurrency,
  inputAmount,
  swapper,
  slippage,
}: Omit<UseXSwapQuoteArgs, 'enabled' | 'refetchIntervalMs'>): XSwapQuoteRequest | undefined {
  if (!inputCurrency || !outputCurrency || !inputAmount || !swapper) {
    return undefined
  }
  if (isSameXSwapToken(inputCurrency, outputCurrency) || !inputAmount.currency.equals(inputCurrency)) {
    return undefined
  }
  if (!inputAmount.greaterThan(0)) {
    return undefined
  }
  return {
    tokenIn: toXSwapAddress(inputCurrency),
    tokenInChainId: inputCurrency.chainId,
    tokenOut: toXSwapAddress(outputCurrency),
    tokenOutChainId: outputCurrency.chainId,
    amount: inputAmount.quotient.toString(),
    swapper,
    slippageBps: slippage ? percentToBps(slippage) : undefined,
  }
}

/**
 * `POST /v1/quote` for the current pair, then dispatch on `routeClass`: `local` is the same-chain flow, any other
 * class is the cross-chain flow.
 */
export function useXSwapQuote({
  enabled = true,
  refetchIntervalMs = QUOTE_STALE_TIME_MS,
  ...args
}: UseXSwapQuoteArgs): XSwapQuoteState {
  const { inputCurrency, outputCurrency, inputAmount, swapper, slippage } = args
  const request = useMemo(
    () => buildXSwapQuoteRequest({ inputCurrency, outputCurrency, inputAmount, swapper, slippage }),
    [inputAmount, inputCurrency, outputCurrency, slippage, swapper],
  )
  // Debounce on a string so a new but equal request object (e.g. a re-created amount) does not restart the timer.
  const requestJson = request ? JSON.stringify(request) : undefined
  const debouncedRequestJson = useDebounce(requestJson, QUOTE_DEBOUNCE_MS)
  const isDebouncing = requestJson !== debouncedRequestJson
  const debouncedRequest = useMemo(
    (): XSwapQuoteRequest | undefined => (debouncedRequestJson ? JSON.parse(debouncedRequestJson) : undefined),
    [debouncedRequestJson],
  )
  const active = enabled && isXSwapApiEnabled() && !!debouncedRequest

  const { data, error, isFetching } = useQuery({
    queryKey: xswapQueryKeys.quote(debouncedRequest),
    queryFn: ({ signal }) => getXSwapQuote(debouncedRequest as XSwapQuoteRequest, signal),
    enabled: active,
    staleTime: QUOTE_STALE_TIME_MS,
    // Quotes expire (`expiresAt`); keep them fresh while the pair stays on screen.
    refetchInterval: refetchIntervalMs,
    // Every quote error code is a definite answer; retrying only delays the message.
    retry: false,
  })

  return useMemo((): XSwapQuoteState => {
    if (!enabled || !isXSwapApiEnabled() || !request) {
      return { status: 'idle' }
    }
    // A background refetch keeps the last answer on screen; only a new request shows loading.
    if (isDebouncing) {
      return { status: 'loading' }
    }
    if (error) {
      const xswapError = toXSwapError(error)
      return { status: 'error', error: xswapError, message: getXSwapErrorMessage(xswapError) }
    }
    if (data) {
      return { status: 'success', response: data, flow: getXSwapFlow(data.routeClass), refreshing: isFetching }
    }
    return { status: active ? 'loading' : 'idle' }
  }, [active, data, enabled, error, isDebouncing, isFetching, request])
}

/** Drops every cached quote and asks again, e.g. after `quote_unavailable`. */
export function useXSwapRequote(): () => Promise<void> {
  const queryClient = useQueryClient()
  return useCallback(() => queryClient.resetQueries({ queryKey: xswapQueryKeys.quotes }), [queryClient])
}

export function isXSwapOrderTerminal(order?: XSwapOrder): boolean {
  return Boolean(order && XSWAP_TERMINAL_ORDER_STATUSES.has(order.status))
}

/** `GET /v1/orders/:id`, polled until the order is terminal. `initial` is shown until the first poll answers. */
export function useXSwapOrder(id?: string, initial?: XSwapOrder) {
  return useQuery({
    queryKey: xswapQueryKeys.order(id),
    queryFn: ({ signal }) => getXSwapOrder(id as string, signal),
    enabled: isXSwapApiEnabled() && !!id,
    initialData: initial && initial.id === id ? initial : undefined,
    // Polls from the start: a registered order is at most SUBMITTED.
    initialDataUpdatedAt: 0,
    refetchInterval: (query) => (isXSwapOrderTerminal(query.state.data) ? false : ORDER_POLL_MS),
    // A transient error must not stop the polling.
    retry: true,
  })
}

/** `GET /v1/orders?wallet=` for the Activity tab, newest first, one page per cursor. */
export function useXSwapOrderHistory(wallet?: string) {
  return useInfiniteQuery({
    queryKey: xswapQueryKeys.orders(wallet),
    queryFn: ({ pageParam, signal }) => getXSwapOrders(wallet as string, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: isXSwapApiEnabled() && !!wallet,
    // Polls while an order is still moving; settled history does not change.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.orders.some((order) => !isXSwapOrderTerminal(order)))
        ? ORDER_HISTORY_POLL_MS
        : false,
  })
}

export type XSwapTokenLookup = (chainId: number, address: string) => XSwapToken | undefined

/**
 * Finds API tokens by chain and address across several chains, e.g. to format the amounts of a route's legs or of an
 * order whose output is on another chain. Unknown tokens (and chains the API does not list) return undefined.
 */
export function useXSwapTokenLookup(chainIds: (number | undefined)[]): XSwapTokenLookup {
  const uniqueChainIds = useMemo(
    () => [...new Set(chainIds.filter((id): id is number => !!id))].sort((a, b) => a - b),
    [chainIds],
  )
  const results = useQueries({
    queries: uniqueChainIds.map((chainId) => ({
      queryKey: xswapQueryKeys.tokens(chainId),
      queryFn: ({ signal }: { signal: AbortSignal }) => getXSwapTokens(chainId, signal),
      enabled: isXSwapApiEnabled(),
      staleTime: CATALOG_STALE_TIME_MS,
    })),
  })
  const dataKey = results.map((r) => r.dataUpdatedAt).join(',')
  const byKey = useMemo(() => {
    const map = new Map<string, XSwapToken>()
    results.forEach((r) => r.data?.forEach((token) => map.set(xswapTokenKey(token.chainId, token.address), token)))
    return map
    // `results` is a new array every render; rebuild only when some list changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])
  return useCallback((chainId, address) => byKey.get(xswapTokenKey(chainId, address)), [byKey])
}
