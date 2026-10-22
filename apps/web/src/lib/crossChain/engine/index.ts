import type { Percent } from '@uniswap/sdk-core'
import type { AggregatorExecution, AggregatorQuote, CrossChainQuoteRequest } from 'lib/crossChain/aggregator/types'
import { XCHAINSENDER_ADDRESS } from 'lib/crossChain/constants'
import { useRelayExecute } from 'lib/crossChain/engine/relay/useRelayExecute'
import { useRelayQuote } from 'lib/crossChain/engine/relay/useRelayQuote'
import { useCrossChainCallback } from 'lib/crossChain/engine/useCrossChainCallback'
import { useCrossChainQuote } from 'lib/crossChain/engine/useCrossChainQuote'
import { isRelayPair } from 'lib/crossChain/engine/pickRail'
import { directRouteHops, toRouteHops } from 'lib/crossChain/engine/routeHops'
import { useMemo } from 'react'
import type { ClassicTrade } from 'state/routing/types'

/**
 * Blackbox behind lib/crossChain/aggregator: picks the rail and returns its best quote.
 * - XChainSender rail (LayerZero for JOC/OFT, Across otherwise; routeEngine A/B/C branches): useCrossChainQuote.
 * - Relay rail (chains without AcrossAdapter, see pickRail): useRelayQuote.
 * Both hooks always run (rules of hooks); the inactive one stays idle.
 */
export function useEngineQuote(req: CrossChainQuoteRequest): AggregatorQuote | undefined {
  const { inputCurrency, outputCurrency, inputAmount } = req
  const isCrossChain = !!inputCurrency && !!outputCurrency && inputCurrency.chainId !== outputCurrency.chainId
  const isDirect = isCrossChain && isRelayPair(inputCurrency, outputCurrency)
  const lz = useCrossChainQuote(req)
  const direct = useRelayQuote(inputCurrency, outputCurrency, inputAmount, isDirect)

  return useMemo(() => {
    if (!isCrossChain) {return undefined}
    if (!isDirect) {
      if (!lz) {return undefined}
      return {
        ...lz,
        route: toRouteHops(lz.leg1Trade, lz.bridge, lz.leg2Trade),
        permit2Spender: XCHAINSENDER_ADDRESS[lz.inputCurrency.chainId],
      }
    }
    // Relay rail: one deposit tx, provider-internal swaps; the deposit's own approvals replace Permit2.
    return {
      inputAmount,
      inputCurrency,
      outputCurrency,
      route: directRouteHops(direct.quote?.directQuote?.route, inputCurrency, outputCurrency, direct.quote),
      bridge: {
        quote: direct.quote,
        errorMessage: direct.errorMessage,
        loading: direct.loading,
        inputCurrency,
        outputCurrency,
      },
      outputAmount: direct.quote?.outputAmount,
      quoteFailed: direct.error && !direct.loading,
    }
  }, [isCrossChain, isDirect, lz, direct, inputAmount, inputCurrency, outputCurrency])
}

/** Executes a quote from useEngineQuote on the rail that produced it. */
export function useEngineExecute(
  quote: AggregatorQuote | undefined,
  allowedSlippage: Percent,
  permit2Data?: `0x${string}`,
): AggregatorExecution {
  const directQuote = quote?.bridge?.quote?.directQuote
  const lz = useCrossChainCallback(
    quote?.effectiveRoute,
    quote?.inputCurrency,
    quote?.outputCurrency,
    quote?.inputAmount,
    quote?.outputAmount,
    quote?.leg1Trade?.quote as ClassicTrade | undefined,
    permit2Data,
    quote?.leg2Trade?.quote as ClassicTrade | undefined,
    allowedSlippage,
  )
  const direct = useRelayExecute(directQuote, quote?.inputCurrency, quote?.outputCurrency, quote?.inputAmount)
  return directQuote ? direct : lz
}
