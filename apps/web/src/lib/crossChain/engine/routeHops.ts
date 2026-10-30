import { Token, type Currency } from '@uniswap/sdk-core'
import type { BridgeQuote, CrossChainLeg, RouteHop } from 'lib/crossChain/aggregator/types'
import type { InterfaceTrade } from 'state/routing/types'
import type { RouteStep, RouteToken } from 'lib/crossChain/engine/relay/types'
import { isClassicTrade } from 'state/routing/utils'
import getRoutingDiagramEntries from 'utils/getRoutingDiagramEntries'

const pools = (trade?: InterfaceTrade) => (isClassicTrade(trade) ? getRoutingDiagramEntries(trade) : undefined)

/** LZ legs (A/B/C/BRIDGE_ONLY) as display hops. Missing legs are skipped. */
export function toRouteHops(
  leg1?: CrossChainLeg<InterfaceTrade>,
  bridge?: CrossChainLeg<BridgeQuote>,
  leg2?: CrossChainLeg<InterfaceTrade>,
): RouteHop[] {
  const hops: RouteHop[] = []
  if (leg1) {hops.push({ kind: 'swap', tokenIn: leg1.inputCurrency, tokenOut: leg1.outputCurrency, pools: pools(leg1.quote) })}
  if (bridge) {
    hops.push({
      kind: 'bridge',
      tokenIn: bridge.inputCurrency,
      tokenOut: bridge.outputCurrency,
      provider: bridge.quote?.bridgeProvider,
      feePercent: bridge.quote?.feePercent,
    })
  }
  if (leg2) {hops.push({ kind: 'swap', tokenIn: leg2.inputCurrency, tokenOut: leg2.outputCurrency, pools: pools(leg2.quote) })}
  return hops
}

/** Direct-rail provider steps as display hops; ends use the user's own currencies (keeps native logos). */
export function directRouteHops(
  steps: RouteStep[] | undefined,
  input: Currency,
  output: Currency,
  bridge?: BridgeQuote,
): RouteHop[] {
  const list = steps?.length ? steps : undefined
  const tok = (t: RouteToken) => new Token(t.chainId, t.address, t.decimals, t.symbol)
  if (!list) {return [{ kind: 'bridge', tokenIn: input, tokenOut: output, provider: bridge?.bridgeProvider, feePercent: bridge?.feePercent }]}
  return list.map((s, i) => ({
    kind: s.kind,
    tokenIn: i === 0 ? input : tok(s.tokenIn),
    tokenOut: i === list.length - 1 ? output : tok(s.tokenOut),
    ...(s.kind === 'bridge' ? { provider: bridge?.bridgeProvider, feePercent: bridge?.feePercent } : {}),
  }))
}
