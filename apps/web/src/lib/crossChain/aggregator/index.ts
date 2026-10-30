import type { Percent } from '@uniswap/sdk-core'
import type { AggregatorExecution, AggregatorQuote, CrossChainQuoteRequest } from 'lib/crossChain/aggregator/types'
import type { BridgeDisplay } from 'lib/crossChain/bridge'
import { useEngineExecute, useEngineQuote } from 'lib/crossChain/engine'
import { acrossProvider } from 'lib/crossChain/engine/across/provider'
import { PROVIDER_DISPLAY } from 'lib/crossChain/engine/relay/source'

/** Bridge providers the engine can route through, for UI that shows them before a quote exists. */
export const BRIDGE_DISPLAYS: BridgeDisplay[] = [
  { name: acrossProvider.name, logoUrl: acrossProvider.logoUrl },
  PROVIDER_DISPLAY.relay,
]

/**
 * Aggregator client — the only cross-chain entry point the UI uses. Returns the best route + quote
 * for the given pair/amount; undefined when the pair isn't cross-chain.
 * ponytail: backed by the in-app engine (lib/crossChain/engine). When the aggregator backend API
 * ships, replace this body with the API call; callers stay unchanged.
 */
export function useAggregatorQuote(req: CrossChainQuoteRequest): AggregatorQuote | undefined {
  return useEngineQuote(req)
}

/**
 * Executes a quote returned by useAggregatorQuote (approvals + src-chain tx + tx history entry).
 * ponytail: same as above — swap the body for the backend's execute/tx-build call.
 */
export function useAggregatorExecute(
  quote: AggregatorQuote | undefined,
  allowedSlippage: Percent,
  permit2Data?: `0x${string}`,
): AggregatorExecution {
  return useEngineExecute(quote, allowedSlippage, permit2Data)
}
