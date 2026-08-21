import { Currency, CurrencyAmount, Token, TradeType } from '@uniswap/sdk-core'
import { Field } from 'components/swap/constants'
import { useAccount } from 'hooks/useAccount'
import { BridgeQuote, useBridgeQuote } from 'hooks/useBridgeQuote'
import { useCrossChainRoute } from 'hooks/useCrossChainRoute'
import { useSwapBridgeCandidate } from 'hooks/useSwapBridgeCandidate'
import { CrossChainRoute } from 'lib/crossChain/types'
import { useCallback, useMemo } from 'react'
import { useRoutingAPITrade } from 'state/routing/useRoutingAPITrade'
import { InterfaceTrade, RouterPreference, TradeState } from 'state/routing/types'

import { isClassicTrade } from 'state/routing/utils'
import { useSwapContext } from 'state/swap/hooks'

/** One hop of a cross-chain route: its own quote/error/loading, scoped to its own input/output. */
export interface CrossChainLeg<TQuote> {
  quote: TQuote | undefined
  errorMessage?: string
  loading: boolean
  inputCurrency: Currency
  outputCurrency: Currency
}

export interface UseCrossChainQuoteResult {
  /** Final route driving display + useCrossChainCallback (candidate/winner already applied). */
  effectiveRoute: CrossChainRoute
  /** Cross-chain exact-in user amount (mirrors parsedAmounts[Field.INPUT]). */
  inputAmount: CurrencyAmount<Currency> | undefined
  outputAmount: CurrencyAmount<Currency> | undefined
  inputCurrency: Currency
  outputCurrency: Currency
  /** SOR swap leg — present for SWAP_BRIDGE (leg1) and SWAP_BRIDGE_SWAP (leg1). Undefined for
   * BRIDGE_ONLY/BRIDGE_SWAP, where the first hop is the bridge itself. */
  leg1Trade: CrossChainLeg<InterfaceTrade> | undefined
  /** The bridge hop — always present, at whichever position the active route puts it. */
  bridge: CrossChainLeg<BridgeQuote> | undefined
  /** SOR swap leg after the bridge — present for BRIDGE_SWAP and SWAP_BRIDGE_SWAP (leg2/leg3). */
  leg2Trade: CrossChainLeg<InterfaceTrade> | undefined
  /** True once every candidate has been tried and none produced a usable route. */
  quoteFailed: boolean
}

/**
 * Cross-chain quote orchestrator: routeEngine route -> up to 3 candidate branches
 * (A: SWAP_BRIDGE, B: BRIDGE_SWAP, C: SWAP_BRIDGE_SWAP) -> winner selection -> final
 * effective route + per-leg quotes. Self-contained: pulls account, swap state, and currencies
 * from context/hooks directly. See lib/crossChain/PLAN_SWAP_BRIDGE_VS_BRIDGE_SWAP.md.
 * Returns undefined when the current pair isn't cross-chain, or the route isn't resolved yet.
 */
export function useCrossChainQuote(): UseCrossChainQuoteResult | undefined {
  const { address: accountAddress } = useAccount()
  const { swapState, setSwapState, derivedSwapInfo } = useSwapContext()
  const { independentField } = swapState
  const {
    trade: { state: tradeState, trade },
    parsedAmount,
    currencies,
  } = derivedSwapInfo

  // Cross-chain is always exact-in (onSwitchTokens forces Field.INPUT when chains differ,
  // and showWrap is always false across chains) — this mirrors SwapForm's
  // parsedAmounts[Field.INPUT] without needing it passed in.
  const inputAmount =
    independentField === Field.INPUT ? parsedAmount : (trade?.inputAmount as CurrencyAmount<Currency> | undefined)

  const isCrossChain = Boolean(
    currencies[Field.INPUT] &&
      currencies[Field.OUTPUT] &&
      currencies[Field.INPUT]!.chainId !== currencies[Field.OUTPUT]!.chainId,
  )

  const { route: crossChainRoute } = useCrossChainRoute(currencies[Field.INPUT], currencies[Field.OUTPUT])


  const isSwapBridge = isCrossChain && crossChainRoute?.routeCase === 'SWAP_BRIDGE'
  // 3-hop route (swap -> bridge -> swap), only ever the main route (no alternate — see
  // routeEngine.ts, it's the fallback tier below SWAP_BRIDGE/BRIDGE_SWAP). leg1 (sell ->
  // src intermediate) reuses the same SOR `trade` as SWAP_BRIDGE (state/swap/hooks.tsx
  // already targets srcIntermediateToken for this routeCase via crossChainCandidateIndex).
  const isSwapBridgeSwapMain =
    isCrossChain &&
    crossChainRoute?.routeCase === 'SWAP_BRIDGE_SWAP' &&
    !!crossChainRoute?.candidateIntermediateTokenPairs?.length

  // Sequential intermediate-token fallback for SWAP_BRIDGE (see lib/crossChain/PLAN.md):
  // candidateIndex lives in swapState so useDerivedSwapInfo's SOR quote picks the same
  // candidate. useSwapBridgeCandidate advances it whenever leg1 (SOR) or leg2 (bridge)
  // quote fails for the current candidate.
  const candidateIndex = swapState.crossChainCandidateIndex ?? 0
  const setCandidateIndex = useCallback(
    (i: number) => setSwapState((s) => ({ ...s, crossChainCandidateIndex: i })),
    [setSwapState],
  )
  const routeKey = crossChainRoute
    ? `${currencies[Field.INPUT]?.chainId}:${currencies[Field.INPUT]?.wrapped.address}->${currencies[Field.OUTPUT]?.chainId}:${currencies[Field.OUTPUT]?.wrapped.address}`
    : ''

  // aEffectiveRoute: SWAP_BRIDGE (nhánh A)-specific route with intermediateToken overridden
  // to the active candidate — drives nhánh A's own leg2 (bridge) quote input below. The
  // final winner-based `effectiveRoute` (for display/execute) is computed later, after all
  // three branches are quoted.
  const aEffectiveRoute = useMemo(() => {
    if (!crossChainRoute || !isSwapBridge) return crossChainRoute
    const active = crossChainRoute.candidateIntermediateTokens?.[candidateIndex]
    if (!active) return crossChainRoute
    return { ...crossChainRoute, intermediateToken: active }
  }, [crossChainRoute, isSwapBridge, candidateIndex])

  // leg1Trade: the shared SOR `trade` doubles as leg1 for both nhánh A (SWAP_BRIDGE) and
  // nhánh C (SWAP_BRIDGE_SWAP) — state/swap/hooks.tsx targets srcIntermediateToken for
  // both routeCases already.
  const leg1Trade = isSwapBridge || isSwapBridgeSwapMain ? trade : undefined
  const leg1OutputAmount = isSwapBridge ? (isClassicTrade(trade) ? trade.outputAmount : undefined) : undefined

  const leg1Ready = tradeState !== TradeState.LOADING
  // SOR trade is only truly "settled" at VALID — STALE means a reconciliation is still in
  // flight (previous quote shown while amount/currency changed underneath it).
  const leg1Loading = tradeState === TradeState.LOADING || tradeState === TradeState.STALE

  const srcIntermediateTokenInfo = useMemo(() => {
    if (!isCrossChain || !aEffectiveRoute) return null
    return aEffectiveRoute.intermediateToken ?? null
  }, [isCrossChain, aEffectiveRoute])

  const srcIntermediateCurrency = useMemo(() => {
    if (!srcIntermediateTokenInfo) return null
    return new Token(
      srcIntermediateTokenInfo.chainId,
      srcIntermediateTokenInfo.address,
      srcIntermediateTokenInfo.decimals,
      srcIntermediateTokenInfo.symbol,
    )
  }, [srcIntermediateTokenInfo])

  const crossChainInputCurrency = useMemo(() => {
    if (!isCrossChain || !aEffectiveRoute) return null
    if (aEffectiveRoute.routeCase === 'SWAP_BRIDGE') return srcIntermediateCurrency
    return currencies[Field.INPUT] ?? null
  }, [isCrossChain, aEffectiveRoute, srcIntermediateCurrency, currencies])

  const crossChainOutputCurrency = isCrossChain ? (currencies[Field.OUTPUT] ?? null) : null
  const bridgeInputAmount = useMemo(() => {
    if (!crossChainInputCurrency) return undefined
    if (aEffectiveRoute?.routeCase === 'SWAP_BRIDGE') {
      if (leg1OutputAmount) {
        try {
          return CurrencyAmount.fromRawAmount(crossChainInputCurrency, leg1OutputAmount.quotient)
        } catch {
          return undefined
        }
      }
      return undefined
    }
    // BRIDGE_ONLY: user typed amount is bridge input
    return inputAmount
  }, [crossChainInputCurrency, aEffectiveRoute, leg1OutputAmount, inputAmount])

  const {
    quote: bridgeQuote,
    loading: bridgeQuoteLoading,
    error: bridgeQuoteError,
    errorMessage: bridgeQuoteErrorMessage,
  } = useBridgeQuote(crossChainInputCurrency, crossChainOutputCurrency, bridgeInputAmount, aEffectiveRoute?.unwrapToOrigin)

  const leg1Failed = isSwapBridge && (tradeState === TradeState.NO_ROUTE_FOUND || tradeState === TradeState.INVALID)

  // Advances candidateIndex when the active candidate's leg1 or leg2 quote fails;
  // `exhausted` (all candidates tried) is folded into `quoteFailed` below so the
  // "insufficient liquidity" messaging covers it too.
  const { exhausted: candidatesExhausted } = useSwapBridgeCandidate({
    candidateCount: crossChainRoute?.candidateIntermediateTokens?.length ?? 0,
    routeKey,
    index: candidateIndex,
    setIndex: setCandidateIndex,
    leg1Failed,
    bridgeQuoteFailed: bridgeQuoteError,
    leg1Ready,
    bridgeQuoteReady: !bridgeQuoteLoading,
  })

  // ── Nhánh B: BRIDGE_SWAP — either the main route, or crossChainRoute.alternateRoute
  // quoted alongside SWAP_BRIDGE (nhánh A) so we can pick whichever yields the better output
  // (winner logic below). leg1 = bridge (sell -> intermediate), leg2 = swap
  // (intermediate -> buy) on the destination chain.
  const isBridgeSwapMain = isCrossChain && crossChainRoute?.routeCase === 'BRIDGE_SWAP'
  const hasAlternate = isSwapBridge && !!crossChainRoute?.alternateRoute
  const bridgeSwapRoute: CrossChainRoute | undefined =
    (isBridgeSwapMain ? crossChainRoute : hasAlternate ? crossChainRoute!.alternateRoute : undefined) ?? undefined

  // main BRIDGE_SWAP reuses crossChainCandidateIndex (mutually exclusive with SWAP_BRIDGE
  // main — a route is never both at once); alternate BRIDGE_SWAP (alongside SWAP_BRIDGE
  // main) uses the separate Alt index so both branches can advance independently.
  const candidateIndexAlt = swapState.crossChainCandidateIndexAlt ?? 0
  const setCandidateIndexAlt = useCallback(
    (i: number) => setSwapState((s) => ({ ...s, crossChainCandidateIndexAlt: i })),
    [setSwapState],
  )
  const bIndex = isBridgeSwapMain ? candidateIndex : candidateIndexAlt
  const setBIndex = isBridgeSwapMain ? setCandidateIndex : setCandidateIndexAlt

  const bIntermediateCurrency = useMemo(() => {
    const tok = bridgeSwapRoute?.candidateIntermediateTokens?.[bIndex]
    if (!tok) return undefined
    return new Token(tok.chainId, tok.address, tok.decimals, tok.symbol)
  }, [bridgeSwapRoute, bIndex])

  // bEffectiveRoute: mirrors aEffectiveRoute — overrides intermediateToken to the candidate
  // actually active at bIndex, so effectiveRoute (used by RoutingDiagram/useCrossChainCallback)
  // reflects the real quoted token, not always candidateIntermediateTokens[0].
  const bEffectiveRoute = useMemo(() => {
    if (!bridgeSwapRoute) return bridgeSwapRoute
    const active = bridgeSwapRoute.candidateIntermediateTokens?.[bIndex]
    if (!active) return bridgeSwapRoute
    return { ...bridgeSwapRoute, intermediateToken: active }
  }, [bridgeSwapRoute, bIndex])

  const bLeg1InputAmount = bridgeSwapRoute ? inputAmount : undefined

  const {
    quote: bLeg1BridgeQuote,
    loading: bLeg1Loading,
    error: bLeg1Error,
    errorMessage: bLeg1ErrorMessage,
  } = useBridgeQuote(
    bridgeSwapRoute ? currencies[Field.INPUT] : undefined,
    bridgeSwapRoute ? bIntermediateCurrency : undefined,
    bLeg1InputAmount,
    bridgeSwapRoute?.unwrapToOrigin,
  )

  const { state: bLeg2TradeState, trade: bLeg2Trade } = useRoutingAPITrade(
    !bridgeSwapRoute || !bLeg1BridgeQuote,
    TradeType.EXACT_INPUT,
    bLeg1BridgeQuote?.outputAmount,
    bridgeSwapRoute ? (currencies[Field.OUTPUT] ?? undefined) : undefined,
    RouterPreference.API,
    accountAddress,
  )

  const bLeg1Ready = !bLeg1Loading
  const bLeg2Ready = bLeg2TradeState !== TradeState.LOADING
  const bLeg2Failed = bLeg2TradeState === TradeState.NO_ROUTE_FOUND || bLeg2TradeState === TradeState.INVALID
  const bLeg2Loading = bLeg2TradeState === TradeState.LOADING || bLeg2TradeState === TradeState.STALE

  const { exhausted: bCandidatesExhausted } = useSwapBridgeCandidate({
    candidateCount: bridgeSwapRoute?.candidateIntermediateTokens?.length ?? 0,
    routeKey: bridgeSwapRoute ? `${routeKey}:B` : '',
    index: bIndex,
    setIndex: setBIndex,
    leg1Failed: bLeg1Error,
    bridgeQuoteFailed: bLeg2Failed,
    leg1Ready: bLeg1Ready,
    bridgeQuoteReady: bLeg2Ready,
  })

  // ── Nhánh C: SWAP_BRIDGE_SWAP (3-hop) — only ever the main route (fallback tier below
  // SWAP_BRIDGE/BRIDGE_SWAP, no alternate). leg1 = swap sell -> pair.src (this IS the shared
  // `trade`/`tradeState` above: state/swap/hooks.tsx already targets srcIntermediateToken =
  // candidateIntermediateTokenPairs[crossChainCandidateIndex].src for this routeCase, so no
  // separate SOR call needed for leg1). leg2 = bridge pair.src -> pair.dst. leg3 = swap
  // pair.dst -> buy on dst chain.
  const cPair = crossChainRoute?.candidateIntermediateTokenPairs?.[candidateIndex]

  const cSrcCurrency = useMemo(() => {
    if (!isSwapBridgeSwapMain || !cPair) return undefined
    return new Token(cPair.src.chainId, cPair.src.address, cPair.src.decimals, cPair.src.symbol)
  }, [isSwapBridgeSwapMain, cPair])

  const cDstCurrency = useMemo(() => {
    if (!isSwapBridgeSwapMain || !cPair) return undefined
    return new Token(cPair.dst.chainId, cPair.dst.address, cPair.dst.decimals, cPair.dst.symbol)
  }, [isSwapBridgeSwapMain, cPair])

  const cLeg1Ready = leg1Ready
  const cLeg1Failed = isSwapBridgeSwapMain && (tradeState === TradeState.NO_ROUTE_FOUND || tradeState === TradeState.INVALID)
  const cLeg1OutputAmount = isSwapBridgeSwapMain && isClassicTrade(trade) ? trade.outputAmount : undefined

  const cLeg2InputAmount = useMemo(() => {
    if (!cSrcCurrency || !cLeg1OutputAmount) return undefined
    try {
      return CurrencyAmount.fromRawAmount(cSrcCurrency, cLeg1OutputAmount.quotient)
    } catch {
      return undefined
    }
  }, [cSrcCurrency, cLeg1OutputAmount])

  const {
    quote: cLeg2BridgeQuote,
    loading: cLeg2Loading,
    error: cLeg2Failed,
    errorMessage: cLeg2ErrorMessage,
  } = useBridgeQuote(cSrcCurrency, cDstCurrency, cLeg2InputAmount, crossChainRoute?.unwrapToOrigin)

  const { state: cLeg3TradeState, trade: cLeg3Trade } = useRoutingAPITrade(
    !isSwapBridgeSwapMain || !cLeg2BridgeQuote,
    TradeType.EXACT_INPUT,
    cLeg2BridgeQuote?.outputAmount,
    isSwapBridgeSwapMain ? (currencies[Field.OUTPUT] ?? undefined) : undefined,
    RouterPreference.API,
    accountAddress,
  )

  const cLeg2Ready = !cLeg2Loading
  const cLeg3Ready = cLeg3TradeState !== TradeState.LOADING
  const cLeg3Failed = cLeg3TradeState === TradeState.NO_ROUTE_FOUND || cLeg3TradeState === TradeState.INVALID
  const cLeg3Loading = cLeg3TradeState === TradeState.LOADING || cLeg3TradeState === TradeState.STALE

  const { exhausted: cCandidatesExhausted } = useSwapBridgeCandidate({
    candidateCount: crossChainRoute?.candidateIntermediateTokenPairs?.length ?? 0,
    routeKey: isSwapBridgeSwapMain ? `${routeKey}:C` : '',
    index: candidateIndex,
    setIndex: setCandidateIndex,
    leg1Failed: cLeg1Failed || cLeg3Failed,
    bridgeQuoteFailed: cLeg2Failed,
    leg1Ready: cLeg1Ready && cLeg3Ready,
    bridgeQuoteReady: cLeg2Ready,
  })

  // ── Winner logic: A (SWAP_BRIDGE) vs B-alternate (BRIDGE_SWAP), only when hasAlternate.
  // If no alternate, the "winner" is whichever single branch is active (A, B-main, or C) —
  // its own bridgeQuote/leg2Trade already IS the final quote, nothing to compare.
  const aUsable = isSwapBridge && !leg1Failed && !bridgeQuoteError && !!bridgeQuote
  const aReady = leg1Ready && !bridgeQuoteLoading

  const bUsable = !!bridgeSwapRoute && !bLeg1Error && !bLeg2Failed && !!bLeg2Trade
  const bReady = bLeg1Ready && bLeg2Ready

  // Distinguishes "still deciding" (null while loading) from "both branches settled and
  // failed" — winner alone can't tell these apart (both collapse to null), which used to
  // make effectiveRoute/mode default to A even when A failed for real (see bug: A's SOR
  // leg1 fails before A's bridge quote ever runs, hiding B's real bridge error from the UI).
  const bothFailed = aReady && bReady && !aUsable && !bUsable

  const winner = useMemo((): 'A' | 'B' | null => {
    if (!hasAlternate) return null // single-branch case, no comparison needed
    if (!aReady || !bReady) return null

    if (aUsable && bUsable) {
      const aOut = bridgeQuote?.outputAmount
      const bOut = isClassicTrade(bLeg2Trade) ? bLeg2Trade.outputAmount : undefined
      if (aOut && bOut) return aOut.greaterThan(bOut) ? 'A' : 'B'
      return aUsable ? 'A' : 'B'
    }
    if (aUsable) return 'A'
    if (bUsable) return 'B'
    return null
  }, [hasAlternate, aReady, bReady, aUsable, bUsable, bridgeQuote, bLeg2Trade])

  // effectiveRoute: final route driving display + useCrossChainCallback. Picks among
  // nhánh A / B / C depending on which is active and (when hasAlternate) which won.
  const effectiveRoute = useMemo(() => {
    if (hasAlternate) {
      if (winner === 'B') return bEffectiveRoute
      // winner === null: either still loading (default to A, matches old behavior), or both
      // branches settled and failed (bothFailed) — in that case show B instead of A, since
      // A's bridge quote never even ran (blocked behind A's failed SOR leg1) while B's bridge
      // quote always runs independently and carries the real error worth surfacing.
      if (winner === null && bothFailed) return bEffectiveRoute
      return aEffectiveRoute ?? undefined
    }

    if (isBridgeSwapMain) return bEffectiveRoute
    if (isSwapBridgeSwapMain && cPair) {
      return { ...crossChainRoute!, intermediateTokenSrc: cPair.src, intermediateTokenDst: cPair.dst }
    }
    return aEffectiveRoute ?? undefined
  }, [hasAlternate, winner, bothFailed, bEffectiveRoute, aEffectiveRoute, isBridgeSwapMain, isSwapBridgeSwapMain, cPair, crossChainRoute])


  // outputAmount: the amount actually shown to the user + fed into useCrossChainCallback,
  // switching between nhánh A's bridgeQuote, nhánh B's leg2 swap, or nhánh C's leg3 swap.
  const outputAmount = hasAlternate
    ? winner === 'B'
      ? isClassicTrade(bLeg2Trade)
        ? bLeg2Trade.outputAmount
        : undefined
      : bridgeQuote?.outputAmount
    : isBridgeSwapMain
      ? isClassicTrade(bLeg2Trade)
        ? bLeg2Trade.outputAmount
        : undefined
      : isSwapBridgeSwapMain
        ? isClassicTrade(cLeg3Trade)
          ? cLeg3Trade.outputAmount
          : undefined
        : bridgeQuote?.outputAmount

  const bridgeReady = hasAlternate
    ? aReady && bReady
    : isBridgeSwapMain
      ? bReady
      : isSwapBridgeSwapMain
        ? cLeg1Ready && cLeg2Ready && cLeg3Ready
        : !bridgeQuoteLoading && leg1Ready

  const quoteFailed =
    isCrossChain &&
    bridgeReady &&
    (hasAlternate
      ? candidatesExhausted && bCandidatesExhausted // both A and B-alt exhausted
      : isBridgeSwapMain
        ? bCandidatesExhausted
        : isSwapBridgeSwapMain
          ? cCandidatesExhausted
          : candidatesExhausted || (leg1Failed && !crossChainRoute?.candidateIntermediateTokens?.length) || bridgeQuoteError)

  // ── Active mode: which branch is actually driving effectiveRoute/outputAmount right now.
  // Mirrors effectiveRoute's bothFailed fallback: when both A and B settled and failed,
  // show B's legs (real bridge error) instead of A's (leg1 SOR error only, bridge never ran).
  const mode: 'BRIDGE_ONLY' | 'A' | 'B' | 'C' = hasAlternate
    ? winner === 'B' || (winner === null && bothFailed)
      ? 'B'
      : 'A'
    : isBridgeSwapMain
      ? 'B'
      : isSwapBridgeSwapMain

        ? 'C'
        : isSwapBridge
          ? 'A'
          : 'BRIDGE_ONLY'

  const inCur = currencies[Field.INPUT]
  const outCur = currencies[Field.OUTPUT]

  let leg1TradeLeg: CrossChainLeg<InterfaceTrade> | undefined
  let bridgeLeg: CrossChainLeg<BridgeQuote> | undefined
  let leg2TradeLeg: CrossChainLeg<InterfaceTrade> | undefined

  if (mode === 'BRIDGE_ONLY') {
    bridgeLeg =
      inCur && outCur
        ? {
            quote: bridgeQuote,
            errorMessage: bridgeQuoteErrorMessage,
            loading: bridgeQuoteLoading,
            inputCurrency: inCur,
            outputCurrency: outCur,
          }
        : undefined
  } else if (mode === 'A') {
    leg1TradeLeg =
      inCur && srcIntermediateCurrency
        ? {
            quote: leg1Trade,
            errorMessage: leg1Failed ? 'No route found' : undefined,
            loading: leg1Loading,
            inputCurrency: inCur,
            outputCurrency: srcIntermediateCurrency,
          }
        : undefined
    bridgeLeg =
      srcIntermediateCurrency && outCur
        ? {
            quote: bridgeQuote,
            errorMessage: bridgeQuoteErrorMessage,
            loading: bridgeQuoteLoading,
            inputCurrency: srcIntermediateCurrency,
            outputCurrency: outCur,
          }
        : undefined
  } else if (mode === 'B') {
    bridgeLeg =
      inCur && bIntermediateCurrency
        ? {
            quote: bLeg1BridgeQuote,
            errorMessage: bLeg1ErrorMessage,
            loading: bLeg1Loading,
            inputCurrency: inCur,
            outputCurrency: bIntermediateCurrency,
          }
        : undefined
    leg2TradeLeg =
      bIntermediateCurrency && outCur
        ? {
            quote: bLeg2Trade,
            errorMessage: bLeg2Failed ? 'No route found' : undefined,
            loading: bLeg2Loading,
            inputCurrency: bIntermediateCurrency,
            outputCurrency: outCur,
          }
        : undefined
  } else {
    // mode === 'C'
    leg1TradeLeg =
      inCur && cSrcCurrency
        ? {
            quote: leg1Trade,
            errorMessage: cLeg1Failed ? 'No route found' : undefined,
            loading: leg1Loading,
            inputCurrency: inCur,
            outputCurrency: cSrcCurrency,
          }
        : undefined
    bridgeLeg =
      cSrcCurrency && cDstCurrency
        ? {
            quote: cLeg2BridgeQuote,
            errorMessage: cLeg2ErrorMessage,
            loading: cLeg2Loading,
            inputCurrency: cSrcCurrency,
            outputCurrency: cDstCurrency,
          }
        : undefined
    leg2TradeLeg =
      cDstCurrency && outCur
        ? {
            quote: cLeg3Trade,
            errorMessage: cLeg3Failed ? 'No route found' : undefined,
            loading: cLeg3Loading,
            inputCurrency: cDstCurrency,
            outputCurrency: outCur,
          }
        : undefined
  }

  if (!isCrossChain || !effectiveRoute || !inCur || !outCur) return undefined

  return {
    effectiveRoute,
    inputAmount,
    outputAmount,
    inputCurrency: inCur,
    outputCurrency: outCur,
    leg1Trade: leg1TradeLeg,
    bridge: bridgeLeg,
    leg2Trade: leg2TradeLeg,
    quoteFailed,
  }
}
