import { useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useFallbackListTokens } from 'hooks/Tokens'
import useDebounce from 'hooks/useDebounce'
import { useMemo } from 'react'
import { getXSwapChains, getXSwapQuote, getXSwapTokens, isXSwapApiEnabled } from 'state/xswap/client'
import { XSwapError, getXSwapErrorMessage, toXSwapError } from 'state/xswap/errors'
import { XSwapChain, XSwapQuoteRequest, XSwapQuoteResponse, XSwapToken } from 'state/xswap/types'
import {
  XSwapChainMode,
  XSwapFlow,
  getXSwapChainMode,
  getXSwapFlow,
  isSameXSwapToken,
  isXSwapNativeAddress,
  percentToBps,
  toXSwapAddress,
  xswapTokenToCurrency,
} from 'state/xswap/utils'
import { InterfaceChainId } from 'uniswap/src/types/chains'

// Chains and tokens are API config: refetch often enough that switching a chain or class off shows up without a
// release or a reload.
const CATALOG_STALE_TIME_MS = 60_000
const QUOTE_STALE_TIME_MS = 15_000
const QUOTE_DEBOUNCE_MS = 300

const xswapQueryKeys = {
  chains: ['xswap', 'chains'] as const,
  tokens: (chainId?: number) => ['xswap', 'tokens', chainId] as const,
  quote: (params?: XSwapQuoteRequest) => ['xswap', 'quote', params] as const,
}

/** `GET /v1/chains`: chains enabled in API config. Empty while loading or when the API is disabled. */
function useXSwapChains({ enabled = true }: { enabled?: boolean } = {}): {
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

  const entries = useMemo(() => {
    if (!tokens) {
      return []
    }
    const listTokensByAddress = new Map(Object.values(listTokens).map((t) => [t.address.toLowerCase(), t]))
    return tokens.map((token) => {
      const listToken = isXSwapNativeAddress(token.address)
        ? undefined
        : listTokensByAddress.get(token.address.toLowerCase())
      const currency = listToken && listToken.chainId === token.chainId ? listToken : xswapTokenToCurrency(token)
      return { token, currency }
    })
  }, [listTokens, tokens])

  return { entries, loading: isLoading }
}

type XSwapQuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; response: XSwapQuoteResponse; flow: XSwapFlow }
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
}

export function buildXSwapQuoteRequest({
  inputCurrency,
  outputCurrency,
  inputAmount,
  swapper,
  slippage,
}: Omit<UseXSwapQuoteArgs, 'enabled'>): XSwapQuoteRequest | undefined {
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
export function useXSwapQuote({ enabled = true, ...args }: UseXSwapQuoteArgs): XSwapQuoteState {
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

  const { data, error } = useQuery({
    queryKey: xswapQueryKeys.quote(debouncedRequest),
    queryFn: ({ signal }) => getXSwapQuote(debouncedRequest as XSwapQuoteRequest, signal),
    enabled: active,
    staleTime: QUOTE_STALE_TIME_MS,
    // Quotes expire (`expiresAt`); keep the gate fresh while the pair stays on screen.
    refetchInterval: QUOTE_STALE_TIME_MS,
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
      return { status: 'success', response: data, flow: getXSwapFlow(data.routeClass) }
    }
    return { status: active ? 'loading' : 'idle' }
  }, [active, data, enabled, error, isDebouncing, request])
}
