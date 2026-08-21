import { useEffect, useRef } from 'react'

interface Params {
  candidateCount: number
  routeKey: string // e.g. `${sellChainId}:${sellAddr}->${buyChainId}:${buyAddr}`, resets index when pair changes
  index: number
  setIndex: (i: number) => void
  leg1Failed: boolean // from tradeState === NO_ROUTE_FOUND / INVALID
  bridgeQuoteFailed: boolean // from useBridgeQuote error === true
  leg1Ready: boolean // leg1 (swap) quote settled (not loading)
  bridgeQuoteReady: boolean // bridge quote settled (not loading)
}


interface Result {
  /** True when every candidate has been tried and failed — no route to offer. */
  exhausted: boolean
}

/**
 * Controller for walking a candidate list sequentially (candidateIntermediateTokens for
 * SWAP_BRIDGE/BRIDGE_SWAP, or candidateIntermediateTokenPairs for SWAP_BRIDGE_SWAP): advances
 * `index` (via `setIndex`, externally-owned state) whenever the current candidate's
 * leg1 (swap) or leg2 (bridge) quote fails. Does not fetch quotes itself — the caller
 * feeds the candidate at `index` into useRoutingAPITrade/useBridgeQuote, which
 * re-quote via their own effect deps. Generic over `candidateCount` so it can drive any of
 * the three candidate-list shapes without knowing route internals.
 */
export function useSwapBridgeCandidate({
  candidateCount,
  routeKey,
  index,
  setIndex,
  leg1Failed,
  bridgeQuoteFailed,
  leg1Ready,
  bridgeQuoteReady,
}: Params): Result {
  const prevRouteKey = useRef(routeKey)

  useEffect(() => {
    if (prevRouteKey.current !== routeKey) {
      prevRouteKey.current = routeKey
      setIndex(0)
    }
  }, [routeKey, setIndex])

  useEffect(() => {
    if (!leg1Ready || !bridgeQuoteReady) return
    if (!leg1Failed && !bridgeQuoteFailed) return
    if (index >= candidateCount - 1) return // exhausted, handled below
    setIndex(index + 1)
  }, [leg1Failed, bridgeQuoteFailed, leg1Ready, bridgeQuoteReady, index, candidateCount, setIndex])

  return {
    exhausted:
      candidateCount > 0 &&
      index >= candidateCount - 1 &&
      (leg1Failed || bridgeQuoteFailed) &&
      leg1Ready &&
      bridgeQuoteReady,
  }
}
