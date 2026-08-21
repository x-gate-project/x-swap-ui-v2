import { Currency, Percent } from '@uniswap/sdk-core'

import Column from 'components/Column'
import RouterLabel from 'components/RouterLabel'
import RoutingDiagram from 'components/RoutingDiagram/RoutingDiagram'
import { RowBetween } from 'components/Row'
import { UniswapXDescription } from 'components/swap/GasBreakdownTooltip'
import { SUPPORTED_GAS_ESTIMATE_CHAIN_IDS } from 'constants/chains'
import { Trans } from 'i18n'
import { CrossChainRoute } from 'lib/crossChain/types'
import { ClassicTrade, InterfaceTrade, SubmittableTrade } from 'state/routing/types'
import { isClassicTrade } from 'state/routing/utils'
import { Separator, ThemedText } from 'theme/components'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import getRoutingDiagramEntries from 'utils/getRoutingDiagramEntries'

// TODO(WEB-2022)
// Can `trade.gasUseEstimateUSD` be defined when `chainId` is not in `SUPPORTED_GAS_ESTIMATE_CHAIN_IDS`?
function useGasPrice({ gasUseEstimateUSD, inputAmount }: ClassicTrade) {
  const { formatNumber } = useFormatter()
  if (!gasUseEstimateUSD || !SUPPORTED_GAS_ESTIMATE_CHAIN_IDS.includes(inputAmount.currency.chainId)) {
    return undefined
  }

  return gasUseEstimateUSD === 0 ? '<$0.01' : formatNumber({ input: gasUseEstimateUSD, type: NumberType.FiatGasPrice })
}

function RouteLabel({ trade }: { trade: SubmittableTrade }) {
  return (
    <RowBetween>
      <ThemedText.BodySmall color="neutral2">Order Routing</ThemedText.BodySmall>
      <RouterLabel trade={trade} color="neutral1" />
    </RowBetween>
  )
}

function PriceImpactRow({ trade }: { trade: ClassicTrade }) {
  const { formatPercent } = useFormatter()
  return (
    <ThemedText.BodySmall color="neutral2">
      <RowBetween>
        <Trans i18nKey="swap.priceImpact.upperCase" />
        <div>{formatPercent(trade.priceImpact)}</div>
      </RowBetween>
    </ThemedText.BodySmall>
  )
}

export function RoutingTooltip({ trade }: { trade: SubmittableTrade }) {
  return isClassicTrade(trade) ? (
    <Column gap="md">
      <PriceImpactRow trade={trade} />
      <Separator />
      <RouteLabel trade={trade} />
      <SwapRoute trade={trade} />
    </Column>
  ) : (
    <Column gap="md">
      <RouteLabel trade={trade} />
      <Separator />
      <UniswapXDescription />
    </Column>
  )
}

export function CrossChainSwapRoute({
  crossChainRoute,
  inputCurrency,
  outputCurrency,
  leg1Trade,
  leg2Trade,
  bridgeProtocol,
  bridgeFeePercent,
}: {
  crossChainRoute: CrossChainRoute
  inputCurrency: Currency
  outputCurrency: Currency
  /** Leg1 trade for SWAP_BRIDGE / SWAP_BRIDGE_SWAP — used to render pool route diagram on swap step */
  leg1Trade?: InterfaceTrade
  /** Leg2 trade for BRIDGE_SWAP / SWAP_BRIDGE_SWAP — used to render pool route diagram on final swap step */
  leg2Trade?: InterfaceTrade
  /** Bridge adapter used — determines which logo to show on the bridge leg */
  bridgeProtocol?: string
  /** Relayer fee % for the bridge leg */
  bridgeFeePercent?: Percent
}) {
  const leg1Routes = isClassicTrade(leg1Trade) ? getRoutingDiagramEntries(leg1Trade) : []
  const leg2Routes = isClassicTrade(leg2Trade) ? getRoutingDiagramEntries(leg2Trade) : []

  return (
    <Column gap="md">
      <RoutingDiagram
        routes={[]}
        currencyIn={inputCurrency}
        currencyOut={outputCurrency}
        crossChainRoute={crossChainRoute}
        leg1Routes={leg1Routes}
        leg2Routes={leg2Routes}
        bridgeProtocol={bridgeProtocol}
        bridgeFeePercent={bridgeFeePercent}
      />


      <ThemedText.Caption color="neutral2">
        <Trans i18nKey="swap.route.optimizedGasCost" />
      </ThemedText.Caption>
    </Column>
  )
}

export function SwapRoute({ trade }: { trade: ClassicTrade }) {
  const { inputAmount, outputAmount } = trade
  const routes = getRoutingDiagramEntries(trade)
  const gasPrice = useGasPrice(trade)

  return (
    <Column gap="md">
      <RoutingDiagram routes={routes} currencyIn={inputAmount.currency} currencyOut={outputAmount.currency} />
      <ThemedText.Caption color="neutral2">
        {Boolean(gasPrice) && <Trans i18nKey="swap.bestRoute.cost" values={{ gasPrice }} />}
        {Boolean(gasPrice) && ' '}
        <Trans i18nKey="swap.route.optimizedGasCost" />
      </ThemedText.Caption>
    </Column>
  )
}
