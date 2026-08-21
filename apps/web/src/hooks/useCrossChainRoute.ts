import { Currency } from '@uniswap/sdk-core'
import { findCrossChainRoute, RouteTokenInput } from 'lib/crossChain/routeFinder'
import { CrossChainRoute } from 'lib/crossChain/types'
import { toBridgeAddress } from 'lib/crossChain/commandBuilders'
import { useEffect, useRef, useState } from 'react'

interface UseCrossChainRouteResult {
  route: CrossChainRoute | null
  loading: boolean
  error: string | null
  isCrossChain: boolean
}

// Native currencies are represented by their WETH address — Across routes/bridges
// natives as WETH under the hood (wrap on deposit, unwrap on fill to an EOA).
function toCurrencyInput(currency: Currency): RouteTokenInput {
  return {
    chainId: currency.chainId,
    address: toBridgeAddress(currency),
    symbol: currency.symbol ?? '',
    decimals: currency.decimals,
  }
}

/**
 * Determines the cross-chain route for a given sell/buy currency pair.
 * Only active when the two currencies are on different chains.
 * Results are debounced (300ms) and cached per unique (sell, buy) pair.
 */
export function useCrossChainRoute(
  inputCurrency?: Currency | null,
  outputCurrency?: Currency | null,
): UseCrossChainRouteResult {
  const isCrossChain =
    !!inputCurrency && !!outputCurrency && inputCurrency.chainId !== outputCurrency.chainId

  const [route, setRoute] = useState<CrossChainRoute | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cache: key → route result
  const cache = useRef(new Map<string, CrossChainRoute>())
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track latest request to ignore stale responses
  const requestId = useRef(0)

  useEffect(() => {
    if (!isCrossChain || !inputCurrency || !outputCurrency) {
      setRoute(null)
      setLoading(false)
      setError(null)
      return
    }

    const sell = toCurrencyInput(inputCurrency)
    const buy = toCurrencyInput(outputCurrency)
    const cacheKey = `${sell.chainId}:${sell.address.toLowerCase()}→${buy.chainId}:${buy.address.toLowerCase()}`

    // Return cached result immediately
    if (cache.current.has(cacheKey)) {
      setRoute(cache.current.get(cacheKey)!)
      setLoading(false)
      setError(null)
      return
    }

    // Debounce API calls
    if (debounceTimer.current) clearTimeout(debounceTimer.current)

    setLoading(true)
    setError(null)

    const currentId = ++requestId.current

    debounceTimer.current = setTimeout(async () => {
      try {
        const result = await findCrossChainRoute(sell, buy)
        if (requestId.current !== currentId) return // stale
        cache.current.set(cacheKey, result)
        setRoute(result)
        setError(result.error ?? null)
      } catch (err) {
        if (requestId.current !== currentId) return
        setError(err instanceof Error ? err.message : 'Unknown error')
        setRoute(null)
      } finally {
        if (requestId.current === currentId) setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [isCrossChain, inputCurrency, outputCurrency])

  return { route, loading, error, isCrossChain }
}
