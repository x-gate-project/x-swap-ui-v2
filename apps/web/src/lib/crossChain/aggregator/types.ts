import type { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import type { BridgeDisplay } from 'lib/crossChain/bridge'
import type { Quote as DirectQuote } from 'lib/crossChain/engine/relay/types'
import type { CrossChainRoute } from 'lib/crossChain/types'
import type { InterfaceTrade } from 'state/routing/types'
import type { RoutingDiagramEntry } from 'utils/getRoutingDiagramEntries'

export interface CrossChainQuoteRequest {
  inputCurrency?: Currency
  outputCurrency?: Currency
  /** Exact-in amount (cross-chain is always exact-in). */
  inputAmount?: CurrencyAmount<Currency>
}

/** The bridge hop as shown to the user. */
export interface BridgeQuote {
  inputCurrency: Currency
  outputCurrency: Currency
  inputAmount: CurrencyAmount<Currency>
  outputAmount: CurrencyAmount<Currency>
  /** Provider that serves this quote — name/logo for display. */
  bridgeProvider: BridgeDisplay
  feePercent: Percent
  nativeFeeAmount?: CurrencyAmount<Currency>
  bridgeFeeAmount?: CurrencyAmount<Currency>
  /** Engine-internal payload (direct Across/Relay quote whose txs get executed). UI must not read it. */
  directQuote?: DirectQuote
}

/** One displayed step of the chosen route, in order. Same shape for every rail. */
export interface RouteHop {
  kind: 'swap' | 'bridge'
  tokenIn: Currency
  tokenOut: Currency
  /** Swap hop pool split (LZ rail); undefined = provider-internal swap. */
  pools?: RoutingDiagramEntry[]
  /** Bridge hop provider; undefined = not chosen yet. */
  provider?: BridgeDisplay
  feePercent?: Percent
}

/** One hop of a cross-chain route: its own quote/error/loading, scoped to its own input/output. */
export interface CrossChainLeg<TQuote> {
  quote?: TQuote
  errorMessage?: string
  loading: boolean
  inputCurrency: Currency
  outputCurrency: Currency
}

/**
 * Best route + quote for the current cross-chain pair, as the aggregator returns it.
 * ponytail: legs reuse InterfaceTrade so the existing details UI renders unchanged; switch to a plain
 * display type when the backend API lands (it can't build InterfaceTrade).
 */
export interface AggregatorQuote {
  /** Engine-internal LZ route (execute only). UI must not read it — display uses `route`. */
  effectiveRoute?: CrossChainRoute
  /** Ordered hops for display. */
  route: RouteHop[]
  inputAmount?: CurrencyAmount<Currency>
  outputAmount?: CurrencyAmount<Currency>
  inputCurrency: Currency
  outputCurrency: Currency
  /** Src-chain swap before the bridge (SWAP_BRIDGE, SWAP_BRIDGE_SWAP). */
  leg1Trade?: CrossChainLeg<InterfaceTrade>
  /** The bridge hop — always present. */
  bridge?: CrossChainLeg<BridgeQuote>
  /** Dst-chain swap after the bridge (BRIDGE_SWAP, SWAP_BRIDGE_SWAP). */
  leg2Trade?: CrossChainLeg<InterfaceTrade>
  /** True once every candidate has been tried and none produced a usable route. */
  quoteFailed: boolean
  /** Contract the user signs a Permit2 for. undefined = execute handles approvals itself. */
  permit2Spender?: `0x${string}`
}

export type ExecuteStatus = 'idle' | 'pending' | 'success' | 'error'

export interface AggregatorExecution {
  execute: (permit2Data?: `0x${string}`) => Promise<`0x${string}` | undefined>
  status: ExecuteStatus
  txHash?: `0x${string}`
  error?: Error
  reset: () => void
}
