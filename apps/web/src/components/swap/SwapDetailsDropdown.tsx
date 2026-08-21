import { InterfaceElementName, SwapEventName } from '@uniswap/analytics-events'
import { Currency, CurrencyAmount, Percent, Price } from '@uniswap/sdk-core'
import { ReactNode } from 'react'
import { CrossChainRoute } from 'lib/crossChain/types'
import AnimatedDropdown from 'components/AnimatedDropdown'
import Column from 'components/Column'
import { LoadingOpacityContainer } from 'components/Loader/styled'
import { RowBetween, RowFixed } from 'components/Row'
import GasEstimateTooltip from 'components/swap/GasEstimateTooltip'
import SwapLineItem, { SwapLineItemType } from 'components/swap/SwapLineItem'
import TradePrice from 'components/swap/TradePrice'
import { Trans } from 'i18n'
import { formatCommonPropertiesForTrade } from 'lib/utils/analytics'
import { useState } from 'react'
import { ChevronDown } from 'react-feather'
import { InterfaceTrade } from 'state/routing/types'
import { isSubmittableTrade } from 'state/routing/utils'
import styled, { useTheme } from 'styled-components'
import Trace from 'uniswap/src/features/telemetry/Trace'

import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'
import { useFormatter } from 'utils/formatNumbers'
import { BridgeQuote } from 'hooks/useBridgeQuote'

const StyledHeaderRow = styled(RowBetween)<{ disabled: boolean; open: boolean }>`
  padding: 0;
  align-items: center;
  cursor: ${({ disabled }) => (disabled ? 'initial' : 'pointer')};
`

const RotatingArrow = styled(ChevronDown)<{ open?: boolean }>`
  transform: ${({ open }) => (open ? 'rotate(180deg)' : 'none')};
  transition: transform 0.1s linear;
`

const SwapDetailsWrapper = styled(Column)`
  padding-top: ${({ theme }) => theme.grids.md};
`

const Wrapper = styled(Column)`
  border-radius: 16px;
  padding: 12px 16px;
`

interface SwapDetailsProps {
  trade?: InterfaceTrade
  syncing: boolean
  loading: boolean
  allowedSlippage: Percent
  priceImpact?: Percent
  label?: ReactNode
  crossChainRoute?: CrossChainRoute | null
  inputCurrency?: Currency | null
  outputCurrency?: Currency | null
  leg1Trade?: InterfaceTrade
  leg2Trade?: InterfaceTrade
  bridgeQuote?: BridgeQuote
  /** Cross-chain input amount (user-typed) and final output amount — used to compute the
   * end-to-end rate (input -> final output) instead of just leg1's swap rate. */
  crossChainInputAmount?: CurrencyAmount<Currency>
  crossChainOutputAmount?: CurrencyAmount<Currency>
}


export default function SwapDetailsDropdown(props: SwapDetailsProps) {

  const { trade, syncing, loading, allowedSlippage, crossChainRoute, inputCurrency, outputCurrency, bridgeQuote, crossChainInputAmount, crossChainOutputAmount } = props
  const theme = useTheme()
  const [showDetails, setShowDetails] = useState(false)
  const trace = useTrace()

  // End-to-end rate (input -> final output) when both amounts are known; falls back to the
  // old leg1-only approximation otherwise (e.g. still loading).
  const bridgePrice =
    crossChainInputAmount && crossChainOutputAmount
      ? new Price(
          crossChainInputAmount.currency,
          crossChainOutputAmount.currency,
          crossChainInputAmount.quotient,
          crossChainOutputAmount.quotient,
        )
      : bridgeQuote
        ? new Price(
            bridgeQuote.outputCurrency,
            trade?.executionPrice.baseCurrency ?? bridgeQuote.inputCurrency,
            trade?.executionPrice.numerator ?? bridgeQuote.outputAmount.quotient,
            trade?.executionPrice.denominator ?? bridgeQuote.inputAmount.quotient,
          )
        : undefined

  const displayPrice = bridgePrice ?? trade?.executionPrice

  const isFetchingPrice = !trade && (loading || syncing)
  const isCrossChain = Boolean(crossChainRoute && inputCurrency && outputCurrency)
  const isExpandable = Boolean(trade || isCrossChain) && !isFetchingPrice

  return (
    <Wrapper>
      {props.label && (
        <div style={{ marginBottom: 4, fontSize: 12, color: theme.neutral2, fontWeight: 600 }}>
          {props.label}
        </div>
      )}
      <Trace
        logPress
        logImpression={!showDetails}
        eventOnTrigger={SwapEventName.SWAP_DETAILS_EXPANDED}
        element={InterfaceElementName.SWAP_DETAILS_DROPDOWN}
        properties={{
          ...(trade ? formatCommonPropertiesForTrade(trade, allowedSlippage) : {}),
          ...trace,
        }}
      >
        <StyledHeaderRow
          data-testid="swap-details-header-row"
          onClick={() => isExpandable && setShowDetails(!showDetails)}
          disabled={!isExpandable}
          open={showDetails}
        >
          <RowFixed>
            {displayPrice ? (
              <LoadingOpacityContainer $loading={syncing} data-testid="trade-price-container">
                <TradePrice price={displayPrice} />
              </LoadingOpacityContainer>
            ) : loading || syncing ? (
              <div style={{ fontSize: 14, color: theme.neutral2 }}>
                <Trans i18nKey="swap.fetchingBestPrice" />
              </div>
            ) : null}
          </RowFixed>
          <RowFixed gap="xs">
            {!showDetails && isSubmittableTrade(trade) && (
              <GasEstimateTooltip trade={trade} loading={syncing || loading} />
            )}
            <RotatingArrow
              stroke={isExpandable ? theme.neutral3 : theme.surface2}
              open={Boolean(isExpandable && showDetails)}
            />
          </RowFixed>
        </StyledHeaderRow>
      </Trace>
      <AdvancedSwapDetails {...props} open={showDetails} />
    </Wrapper>
  )
}

function AdvancedSwapDetails(props: SwapDetailsProps & { open: boolean }) {
  const {
    open,
    trade,
    allowedSlippage,
    syncing = false,
    priceImpact,
    crossChainRoute,
    inputCurrency,
    outputCurrency,
    leg1Trade,
    leg2Trade,
    bridgeQuote,
  } = props
  const format = useFormatter()

  const isCrossChain = Boolean(crossChainRoute && inputCurrency && outputCurrency)

  if (!trade && !isCrossChain) {
    return null
  }

  // MINIMUM_OUTPUT must use the last swap leg's minimumAmountOut() so the unit matches
  // outputCurrency: SWAP_BRIDGE/SWAP_BRIDGE_SWAP -> leg2Trade if present else leg1Trade;
  // BRIDGE_SWAP -> leg2Trade; non-cross-chain -> trade itself.
  const minimumOutputTrade = leg2Trade ?? leg1Trade ?? trade
  // MAXIMUM_INPUT must use the leg that spends the original input currency: leg1Trade when
  // present (cross-chain SWAP_BRIDGE/SWAP_BRIDGE_SWAP), else trade itself.
  const maximumInputTrade = leg1Trade ?? trade

  const lineItemProps = {
    trade,
    allowedSlippage,
    format,
    syncing,
    priceImpact,
    leg1Trade,
    leg2Trade,
    bridgeQuote,
    minimumOutputTrade,
    maximumInputTrade,
  }



  return (
    <AnimatedDropdown open={open}>
      <SwapDetailsWrapper gap="sm" data-testid="advanced-swap-details">
        {trade && (
          <>
            <SwapLineItem {...lineItemProps} type={SwapLineItemType.PRICE_IMPACT} />
            <SwapLineItem {...lineItemProps} type={SwapLineItemType.MAX_SLIPPAGE} />
            <SwapLineItem {...lineItemProps} type={SwapLineItemType.MINIMUM_OUTPUT} />
            <SwapLineItem {...lineItemProps} type={SwapLineItemType.INPUT_TOKEN_FEE_ON_TRANSFER} />
            <SwapLineItem {...lineItemProps} type={SwapLineItemType.OUTPUT_TOKEN_FEE_ON_TRANSFER} />
            {!isCrossChain && <SwapLineItem {...lineItemProps} type={SwapLineItemType.SWAP_FEE} />}
            <SwapLineItem {...lineItemProps} type={SwapLineItemType.NETWORK_COST} />
          </>
        )}
        {(
          <>
            {isCrossChain && (
              <SwapLineItem {...lineItemProps} type={SwapLineItemType.BRIDGE_FEE} />
            )}
            <SwapLineItem
              {...lineItemProps}
              type={SwapLineItemType.ROUTING_INFO}
              crossChainRoute={crossChainRoute}
              inputCurrency={inputCurrency}
              outputCurrency={outputCurrency}
            />
          </>
        )}
      </SwapDetailsWrapper>
    </AnimatedDropdown>
  )
}
