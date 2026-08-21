import { Currency, CurrencyAmount, Percent, TradeType } from '@uniswap/sdk-core'
import { formatTimestamp } from 'components/AccountDrawer/MiniPortfolio/formatTimestamp'
import { LoadingRow } from 'components/Loader/styled'
import { ChainLogo } from 'components/Logo/ChainLogo'
import RouterLabel from 'components/RouterLabel'
import Row from 'components/Row'
import { BRIDGE_PROTOCOL_ICON } from 'components/RoutingDiagram/RoutingDiagram'
import { TooltipSize } from 'components/Tooltip'
import { DetailLineItem, LineItemData } from 'components/swap/DetailLineItem'
import { GasBreakdownTooltip, UniswapXDescription } from 'components/swap/GasBreakdownTooltip'
import GasEstimateTooltip from 'components/swap/GasEstimateTooltip'
import { CrossChainSwapRoute, RoutingTooltip, SwapRoute } from 'components/swap/SwapRoute'
import TradePrice from 'components/swap/TradePrice'
import { SUPPORTED_GAS_ESTIMATE_CHAIN_IDS } from 'constants/chains'
import { BridgeQuote } from 'hooks/useBridgeQuote'
import { useUSDPrice } from 'hooks/useUSDPrice'
import { Trans, t } from 'i18n'
import { CrossChainRoute } from 'lib/crossChain/types'
import React, { ReactNode, useEffect, useState } from 'react'
import { SpringValue, animated } from 'react-spring'
import { InterfaceTrade, SubmittableTrade, TradeFillType } from 'state/routing/types'
import {
  isClassicTrade,
  isLimitTrade,
  isPreviewTrade,
  isSubmittableTrade,
  isUniswapXTrade,
  isUniswapXTradeType,
} from 'state/routing/utils'
import { useUserSlippageTolerance } from 'state/user/hooks'
import { SlippageTolerance } from 'state/user/types'
import styled, { DefaultTheme } from 'styled-components'
import { ThemedText } from 'theme/components'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import { computeRealizedPriceImpact, getPriceImpactColor } from 'utils/prices'


export enum SwapLineItemType {
  EXCHANGE_RATE,
  NETWORK_COST,
  INPUT_TOKEN_FEE_ON_TRANSFER,
  OUTPUT_TOKEN_FEE_ON_TRANSFER,
  PRICE_IMPACT,
  MAX_SLIPPAGE,
  SWAP_FEE,
  MAXIMUM_INPUT,
  MINIMUM_OUTPUT,
  ROUTING_INFO,
  EXPIRY,
  BRIDGE_FEE,
}

const ColorWrapper = styled.span<{ textColor?: keyof DefaultTheme }>`
  ${({ textColor, theme }) => textColor && `color: ${theme[textColor]};`}
`

const AutoBadge = styled(ThemedText.LabelMicro).attrs({ fontWeight: 535 })`
  display: flex;
  background: ${({ theme }) => theme.surface3};
  border-radius: 8px;
  color: ${({ theme }) => theme.neutral2};
  height: 20px;
  padding: 0 6px;
  align-items: center;

  ::after {
    content: '${t('common.automatic')}';
  }
`

function BaseTooltipContent({ children, url }: { children: ReactNode; url: string }) {
  return (
    <>
      {children}
      {/* <br />
      <ExternalLink href={url}>
        <Trans i18nKey="common.learnMore.link" />
      </ExternalLink> */}
    </>
  )
}

export function FOTTooltipContent() {
  return (
    <BaseTooltipContent url="https://support.uniswap.org/hc/en-us/articles/18673568523789-What-is-a-token-fee-">
      <Trans i18nKey="swap.tokenOwnFees" />
    </BaseTooltipContent>
  )
}

function SwapFeeTooltipContent({ hasFee }: { hasFee: boolean }) {
  const message = hasFee ? <Trans i18nKey="swap.fees.experience" /> : <Trans i18nKey="swap.fees.noFee" />
  return (
    <BaseTooltipContent url="https://support.uniswap.org/hc/en-us/articles/20131678274957">
      {message}
    </BaseTooltipContent>
  )
}

export function SlippageTooltipContent() {
  return (
    <BaseTooltipContent url="https://support.uniswap.org/hc/en-us/articles/20131678274957">
      <Trans i18nKey="swap.slippage.tooltip" />
    </BaseTooltipContent>
  )
}

function MinimumOutputTooltipContent({ amount }: { amount: CurrencyAmount<Currency> }) {
  const { formatCurrencyAmount } = useFormatter()
  const formattedAmount = formatCurrencyAmount({ amount, type: NumberType.SwapDetailsAmount })

  return (
    <BaseTooltipContent url="https://support.uniswap.org/hc/en-us/articles/8643794102669-Price-Impact-vs-Price-Slippage">
      <Trans i18nKey="swap.minPriceSlip.revert" values={{ amount: `${formattedAmount} ${amount.currency.symbol}` }} />
    </BaseTooltipContent>
  )
}

function Loading({ width = 50 }: { width?: number }) {
  return <LoadingRow data-testid="loading-row" height={15} width={width} />
}

function ColoredPercentRow({ percent, estimate }: { percent: Percent; estimate?: boolean }) {
  const { formatPercent } = useFormatter()
  const formattedPercent = (estimate ? '~' : '') + formatPercent(percent)
  return <ColorWrapper textColor={getPriceImpactColor(percent)}>{formattedPercent}</ColorWrapper>
}

function CurrencyAmountRow({ amount }: { amount: CurrencyAmount<Currency> }) {
  const { formatCurrencyAmount } = useFormatter()
  const formattedAmount = formatCurrencyAmount({ amount, type: NumberType.SwapDetailsAmount })
  return <>{`${formattedAmount} ${amount.currency.symbol}`}</>
}

function CurrencyAmountWithChainRow({ amount, suffix }: { amount: CurrencyAmount<Currency>; suffix?: string }) {
  const { formatCurrencyAmount } = useFormatter()
  const formattedAmount = formatCurrencyAmount({ amount, type: NumberType.SwapDetailsAmount })
  return (
    <>
      {formattedAmount} {amount.currency.symbol}
    </>
  )
}

const InlineIcon = styled.img`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  vertical-align: middle;
`

function CombinedFeeRow({
  swapFeeAmount,
  swapFeeChainId,
  swapFeeAmount2,
  swapFeeChainId2,
  bridgePortion,
  bridgeProtocol,
}: {
  swapFeeAmount?: CurrencyAmount<Currency>
  swapFeeChainId?: number
  swapFeeAmount2?: CurrencyAmount<Currency>
  swapFeeChainId2?: number
  bridgePortion?: CurrencyAmount<Currency>
  bridgeProtocol?: string
}) {
  const bridgeIcon = bridgeProtocol && BRIDGE_PROTOCOL_ICON[bridgeProtocol]
  const parts: ReactNode[] = []
  if (swapFeeAmount) {
    parts.push(
      <Row gap="4px" key="leg1">
        {swapFeeChainId && <ChainLogo chainId={swapFeeChainId} size={14} />}
        <CurrencyAmountWithChainRow amount={swapFeeAmount} />
      </Row>,
    )
  }
  if (bridgePortion) {
    parts.push(
      <Row gap="4px" key="bridge">
        {bridgeIcon && <InlineIcon src={bridgeIcon} alt={bridgeProtocol} />}
        <CurrencyAmountWithChainRow amount={bridgePortion} />
      </Row>,
    )
  }
  if (swapFeeAmount2) {
    parts.push(
      <Row gap="4px" key="leg2">
        {swapFeeChainId2 && <ChainLogo chainId={swapFeeChainId2} size={14} />}
        <CurrencyAmountWithChainRow amount={swapFeeAmount2} />
      </Row>,
    )
  }
  return (
    <Row gap="4px">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span>+</span>}
          {part}
        </React.Fragment>
      ))}
    </Row>
  )
}

function CombinedPercentRow({
  leg1Impact,
  leg1ChainId,
  leg2Impact,
  leg2ChainId,
}: {
  leg1Impact?: Percent
  leg1ChainId?: number
  leg2Impact?: Percent
  leg2ChainId?: number
}) {
  const parts: ReactNode[] = []
  if (leg1Impact) {
    parts.push(
      <Row gap="4px" key="leg1">
        {leg1ChainId && <ChainLogo chainId={leg1ChainId} size={14} />}
        <ColoredPercentRow percent={leg1Impact} estimate />
      </Row>,
    )
  }
  if (leg2Impact) {
    parts.push(
      <Row gap="4px" key="leg2">
        {leg2ChainId && <ChainLogo chainId={leg2ChainId} size={14} />}
        <ColoredPercentRow percent={leg2Impact} estimate />
      </Row>,
    )
  }
  return (
    <Row gap="4px">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span>+</span>}
          {part}
        </React.Fragment>
      ))}
    </Row>
  )
}


function FeeRow({ trade: { swapFee, outputAmount } }: { trade: SubmittableTrade }) {
  const { formatNumber } = useFormatter()

  const feeCurrencyAmount = CurrencyAmount.fromRawAmount(outputAmount.currency, swapFee?.amount ?? 0)
  const { data: outputFeeFiatValue } = useUSDPrice(feeCurrencyAmount, feeCurrencyAmount?.currency)

  if (outputFeeFiatValue === undefined) {
    return <CurrencyAmountRow amount={feeCurrencyAmount} />
  }

  return <>{formatNumber({ input: outputFeeFiatValue, type: NumberType.FiatGasPrice })}</>
}

function useLineItem(props: SwapLineItemProps): LineItemData | undefined {
  const { trade, syncing, allowedSlippage, type, priceImpact, crossChainRoute, inputCurrency, outputCurrency, minimumOutputTrade, maximumInputTrade, leg1Trade, leg2Trade, bridgeQuote } = props



  const { formatPercent } = useFormatter()
  const isAutoSlippage = useUserSlippageTolerance()[0] === SlippageTolerance.Auto

  const [lastSubmittableFillType, setLastSubmittableFillType] = useState<TradeFillType>()
  useEffect(() => {
    if (trade && trade.fillType !== TradeFillType.None) {
      setLastSubmittableFillType(trade.fillType)
    }
  }, [trade?.fillType])

  if (type === SwapLineItemType.BRIDGE_FEE) {
    const bridgePortion = bridgeQuote ? (bridgeQuote.nativeFeeAmount ?? bridgeQuote.bridgeFeeAmount) : undefined

    const swapFeeRaw = leg1Trade && isSubmittableTrade(leg1Trade) ? leg1Trade.swapFee : undefined
    const swapFeeAmount =
      leg1Trade && swapFeeRaw?.amount
        ? CurrencyAmount.fromRawAmount(leg1Trade.outputAmount.currency, swapFeeRaw.amount)
        : undefined

    const swapFeeRaw2 = leg2Trade && isSubmittableTrade(leg2Trade) ? leg2Trade.swapFee : undefined
    const swapFeeAmount2 =
      leg2Trade && swapFeeRaw2?.amount
        ? CurrencyAmount.fromRawAmount(leg2Trade.outputAmount.currency, swapFeeRaw2.amount)
        : undefined

    if (!swapFeeAmount && !swapFeeAmount2 && !bridgePortion) return undefined

    return {
      Label: () => <Trans i18nKey="common.fee.caps" />,
      TooltipBody: () => <Trans i18nKey="swap.fees.experience" />,
      Value: () => (
        <CombinedFeeRow
          swapFeeAmount={swapFeeAmount}
          swapFeeChainId={leg1Trade?.inputAmount.currency.chainId}
          swapFeeAmount2={swapFeeAmount2}
          swapFeeChainId2={leg2Trade?.outputAmount.currency.chainId}
          bridgePortion={bridgePortion}
          bridgeProtocol={bridgeQuote?.bridgeProtocol}
        />
      ),
    }
  }


  if (type === SwapLineItemType.ROUTING_INFO && crossChainRoute && inputCurrency && outputCurrency) {
    const needsLeg1 = crossChainRoute.routeCase === 'SWAP_BRIDGE' || crossChainRoute.routeCase === 'SWAP_BRIDGE_SWAP'
    const needsLeg2 = crossChainRoute.routeCase === 'SWAP_BRIDGE_SWAP' || crossChainRoute.routeCase === 'BRIDGE_SWAP'
    const swapLegReady = (!needsLeg1 || Boolean(leg1Trade ?? trade)) && (!needsLeg2 || Boolean(leg2Trade))
    if (!swapLegReady || syncing) {
      return undefined
    }
    return {
      Label: () => <Trans i18nKey="swap.orderRouting" />,
      TooltipBody: () => (
        <CrossChainSwapRoute
          crossChainRoute={crossChainRoute}
          inputCurrency={inputCurrency}
          outputCurrency={outputCurrency}
          leg1Trade={leg1Trade}
          leg2Trade={leg2Trade}
          bridgeProtocol={bridgeQuote?.bridgeProtocol}
          bridgeFeePercent={bridgeQuote?.feePercent}
        />

      ),
      tooltipSize: TooltipSize.Large,
      Value: () => (trade && isSubmittableTrade(trade)) ? <RouterLabel trade={trade} /> : <>Client</>,
    }
  }

  if (!trade) return undefined

  const isUniswapX = isUniswapXTrade(trade)
  const isPreview = isPreviewTrade(trade)
  const chainId = trade.inputAmount.currency.chainId

  switch (type) {
    case SwapLineItemType.EXCHANGE_RATE:
      return {
        Label: () => (isLimitTrade(trade) ? <Trans i18nKey="limits.price.label" /> : <Trans i18nKey="common.rate" />),
        Value: () => <TradePrice price={trade.executionPrice} />,
        TooltipBody: !isPreview ? () => <RoutingTooltip trade={trade} /> : undefined,
        tooltipSize: isUniswapX ? TooltipSize.Small : TooltipSize.Large,
      }
    case SwapLineItemType.NETWORK_COST:
      if (!SUPPORTED_GAS_ESTIMATE_CHAIN_IDS.includes(chainId)) {
        return
      }
      return {
        Label: () => <Trans i18nKey="common.networkCost" />,
        TooltipBody: () => <GasBreakdownTooltip trade={trade} />,
        Value: () => {
          if (isPreview) {
            return <Loading />
          }
          return <GasEstimateTooltip trade={trade} loading={!!syncing} />
        },
      }
    case SwapLineItemType.PRICE_IMPACT: {
      if (isUniswapX || (isPreview && isUniswapXTradeType(lastSubmittableFillType))) {
        return
      }
      // Cross-chain (SWAP_BRIDGE_SWAP): combine leg1 + leg2 price impact instead of showing
      // only one leg (previously always leg1, hiding leg2's impact entirely).
      const leg1Impact = leg1Trade && isClassicTrade(leg1Trade) ? computeRealizedPriceImpact(leg1Trade) : undefined
      const leg2Impact = leg2Trade && isClassicTrade(leg2Trade) ? computeRealizedPriceImpact(leg2Trade) : undefined
      const hasLegImpact = Boolean(leg1Impact || leg2Impact)
      if (!hasLegImpact && !priceImpact) {
        return
      }
      return {
        Label: () => <Trans i18nKey="swap.priceImpact" />,
        TooltipBody: () => <Trans i18nKey="swap.impactOfTrade" />,
        Value: () =>
          isPreview ? (
            <Loading />
          ) : hasLegImpact ? (
            <CombinedPercentRow
              leg1Impact={leg1Impact}
              leg1ChainId={leg1Trade?.inputAmount.currency.chainId}
              leg2Impact={leg2Impact}
              leg2ChainId={leg2Trade?.outputAmount.currency.chainId}
            />
          ) : (
            <ColoredPercentRow percent={priceImpact!} estimate />
          ),
      }
    }

    case SwapLineItemType.MAX_SLIPPAGE:
      return {
        Label: () => <Trans i18nKey="settings.maxSlippage" />,
        TooltipBody: () => <SlippageTooltipContent />,
        Value: () => (
          <Row gap="8px">
            {isAutoSlippage && <AutoBadge />} {formatPercent(allowedSlippage)}
          </Row>
        ),
      }
    case SwapLineItemType.SWAP_FEE: {
      if (isPreview) {
        return { Label: () => <Trans i18nKey="common.fee.caps" />, Value: () => <Loading /> }
      }
      return {
        Label: () => (
          <>
            <Trans i18nKey="common.fee.caps" /> {trade.swapFee && `(${formatPercent(trade.swapFee.percent)})`}
          </>
        ),
        TooltipBody: () => <SwapFeeTooltipContent hasFee={Boolean(trade.swapFee)} />,
        Value: () => <FeeRow trade={trade} />,
      }
    }
    case SwapLineItemType.MAXIMUM_INPUT: {
      const maxInputSourceTrade = maximumInputTrade ?? trade
      if (maxInputSourceTrade.tradeType === TradeType.EXACT_INPUT) {
        return
      }
      return {
        Label: () => <Trans i18nKey="swap.payAtMost" />,
        TooltipBody: () => <Trans i18nKey="swap.maxPriceSlip.revert" />,
        Value: () => (
          <CurrencyAmountRow amount={maxInputSourceTrade.maximumAmountIn(allowedSlippage ?? new Percent(0))} />
        ),
        loaderWidth: 70,
      }
    }

    case SwapLineItemType.MINIMUM_OUTPUT: {
      const displayAmount = (minimumOutputTrade ?? trade).minimumAmountOut(allowedSlippage ?? new Percent(0))
      return {
        Label: () => <Trans i18nKey="swap.receive.atLeast" />,
        TooltipBody: () => <MinimumOutputTooltipContent amount={displayAmount} />,
        Value: () => <CurrencyAmountRow amount={displayAmount} />,
        loaderWidth: 70,
      }
    }
    case SwapLineItemType.ROUTING_INFO:
      if (isPreview || syncing) {
        return { Label: () => <Trans i18nKey="swap.orderRouting" />, Value: () => <Loading /> }
      }
      return {
        Label: () => <Trans i18nKey="swap.orderRouting" />,
        TooltipBody: () => {
          if (isUniswapX) {
            return <UniswapXDescription />
          }
          return <SwapRoute data-testid="swap-route-info" trade={trade} />
        },
        tooltipSize: isUniswapX ? TooltipSize.Small : TooltipSize.Large,
        Value: () => <RouterLabel trade={trade} />,
      }
    case SwapLineItemType.INPUT_TOKEN_FEE_ON_TRANSFER:
    case SwapLineItemType.OUTPUT_TOKEN_FEE_ON_TRANSFER:
      return getFOTLineItem(props)
    case SwapLineItemType.EXPIRY:
      if (!isLimitTrade(trade)) {
        return
      }
      return {
        Label: () => <Trans i18nKey="common.expiry" />,
        Value: () => <Row>{formatTimestamp(trade.deadline, true)}</Row>,
      }
  }
}

function getFOTLineItem({ type, trade }: SwapLineItemProps): LineItemData | undefined {
  if (!trade) return undefined
  const isInput = type === SwapLineItemType.INPUT_TOKEN_FEE_ON_TRANSFER
  const currency = isInput ? trade.inputAmount.currency : trade.outputAmount.currency
  const tax = isInput ? trade.inputTax : trade.outputTax
  if (tax.equalTo(0)) {
    return
  }

  return {
    Label: () => <>{t(`swap.namedFee`, { name: currency.symbol ?? currency.name ?? t('common.token') })}</>,
    TooltipBody: FOTTooltipContent,
    Value: () => <ColoredPercentRow percent={tax} />,
  }
}

export interface SwapLineItemProps {
  trade?: InterfaceTrade
  syncing?: boolean
  allowedSlippage?: Percent
  type: SwapLineItemType
  animatedOpacity?: SpringValue<number>
  priceImpact?: Percent
  crossChainRoute?: CrossChainRoute | null
  inputCurrency?: Currency | null
  outputCurrency?: Currency | null
  /** Trade whose minimumAmountOut() should back MINIMUM_OUTPUT. For cross-chain routes,
   * `trade` may be leg1 (intermediate-token output) — pass the last swap leg (leg2Trade if
   * present, else leg1Trade) so the unit matches outputCurrency. */
  minimumOutputTrade?: InterfaceTrade
  /** Trade whose maximumAmountIn() should back MAXIMUM_INPUT. For cross-chain routes, `trade`
   * may be leg1/leg2 depending on caller — pass the leg that spends the original input currency
   * (leg1Trade if present, else trade) so the unit matches inputCurrency. */
  maximumInputTrade?: InterfaceTrade
  leg1Trade?: InterfaceTrade
  leg2Trade?: InterfaceTrade
  bridgeQuote?: BridgeQuote
}



function SwapLineItem(props: SwapLineItemProps) {

  const LineItem = useLineItem(props)
  if (!LineItem) {
    return null
  }

  return (
    <animated.div style={{ opacity: props.animatedOpacity }}>
      <DetailLineItem LineItem={LineItem} syncing={props.syncing} />
    </animated.div>
  )
}

export default React.memo(SwapLineItem)
