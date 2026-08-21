import { InterfaceElementName, SwapEventName } from '@uniswap/analytics-events'
import { Currency, CurrencyAmount, Percent, Price } from '@uniswap/sdk-core'
import { CrossChainRoute } from 'lib/crossChain/types'
import { ReactComponent as ExpandoIconClosed } from 'assets/svg/expando-icon-closed.svg'
import { ReactComponent as ExpandoIconOpened } from 'assets/svg/expando-icon-opened.svg'
import AnimatedDropdown from 'components/AnimatedDropdown'
import { ButtonError, SmallButtonPrimary } from 'components/Button'
import Column from 'components/Column'
import Row, { AutoRow, RowBetween, RowFixed } from 'components/Row'
import { LimitDisclaimer } from 'components/swap/LimitDisclaimer'
import SwapLineItem, { SwapLineItemProps, SwapLineItemType } from 'components/swap/SwapLineItem'
import TradePrice from 'components/swap/TradePrice'
import { SwapCallbackError, SwapShowAcceptChanges } from 'components/swap/styled'
import { Allowance, AllowanceState } from 'hooks/usePermit2Allowance'
import { SwapResult } from 'hooks/useSwapCallback'
import { Trans, t } from 'i18n'
import ms from 'ms'
import { ReactNode, useMemo, useState } from 'react'
import { AlertTriangle } from 'react-feather'
import { easings, useSpring } from 'react-spring'
import { Text } from 'rebass'
import { InterfaceTrade, LimitOrderTrade, RouterPreference } from 'state/routing/types'
import { isClassicTrade, isLimitTrade } from 'state/routing/utils'
import { useRouterPreference, useUserSlippageTolerance } from 'state/user/hooks'
import styled, { useTheme } from 'styled-components'
import { ExternalLink, Separator, ThemedText } from 'theme/components'
import { SpinningLoader } from 'ui/src'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { useTrace } from 'utilities/src/telemetry/trace/TraceContext'
import getRoutingDiagramEntries from 'utils/getRoutingDiagramEntries'
import { formatSwapButtonClickEventProperties } from 'utils/loggingFormatters'
import { BridgeQuote } from 'hooks/useBridgeQuote'

const DetailsContainer = styled(Column)`
  padding: 0px 12px 8px;
`

const StyledAlertTriangle = styled(AlertTriangle)`
  margin-right: 8px;
  min-width: 24px;
`

const ConfirmButton = styled(ButtonError)`
  height: 56px;
`

const DropdownControllerWrapper = styled.div`
  display: flex;
  align-items: center;
  margin-right: -6px;

  padding: 0 16px;
  min-width: fit-content;
  white-space: nowrap;
`

const DropdownButton = styled.button`
  padding: 0px 16px;
  margin-top: 4px;
  margin-bottom: 4px;
  height: 28px;
  text-decoration: none;
  display: flex;
  background: none;
  border: none;
  align-items: center;
  cursor: pointer;
`

const HelpLink = styled(ExternalLink)`
  width: 100%;
  text-align: center;
  margin-top: 16px;
  margin-bottom: 4px;
`

interface CallToAction {
  buttonText: string
  helpLink?: HelpLink
}

interface HelpLink {
  text: string
  url: string
}

function DropdownController({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <DropdownButton onClick={onClick}>
      <Separator />
      <DropdownControllerWrapper>
        <ThemedText.BodySmall color="neutral2">
          {open ? <Trans i18nKey="common.showLess.button" /> : <Trans i18nKey="common.showMore.button" />}
        </ThemedText.BodySmall>
        {open ? <ExpandoIconOpened /> : <ExpandoIconClosed />}
      </DropdownControllerWrapper>
      <Separator />
    </DropdownButton>
  )
}

export interface CrossChainDetailsProps {
  route: CrossChainRoute
  inputCurrency: Currency | null | undefined
  outputCurrency: Currency | null | undefined
  crossChainInputAmount?: CurrencyAmount<Currency>
  crossChainOutputAmount?: CurrencyAmount<Currency>
  leg1Trade?: InterfaceTrade
  leg2Trade?: InterfaceTrade
  allowedSlippage?: Percent
  bridgeQuote?: BridgeQuote
}

export function SwapDetails({
  trade,
  allowance,
  allowedSlippage,
  swapResult,
  onConfirm,
  swapErrorMessage,
  disabledConfirm,
  fiatValueInput,
  fiatValueOutput,
  showAcceptChanges,
  onAcceptChanges,
  isLoading,
  priceImpact,
  crossChainProps,
}: {
  trade?: InterfaceTrade
  allowance?: Allowance
  swapResult?: SwapResult
  allowedSlippage?: Percent
  onConfirm: () => void
  swapErrorMessage?: ReactNode
  disabledConfirm: boolean
  fiatValueInput?: { data?: number; isLoading: boolean }
  fiatValueOutput?: { data?: number; isLoading: boolean }
  showAcceptChanges: boolean
  onAcceptChanges?: () => void
  isLoading: boolean
  priceImpact?: Percent
  crossChainProps?: CrossChainDetailsProps
}) {
  const isAutoSlippage = useUserSlippageTolerance()[0] === 'auto'
  const [routerPreference] = useRouterPreference()
  const routes = trade && isClassicTrade(trade) ? getRoutingDiagramEntries(trade) : undefined
  const theme = useTheme()
  const [showMore, setShowMore] = useState(false)

  const analyticsContext = useTrace()

  const lineItemProps = trade && allowedSlippage ? { trade, allowedSlippage, syncing: false, priceImpact } : undefined

  const callToAction: CallToAction = useMemo(() => {
    if (crossChainProps) {
      if (allowance && allowance.state === AllowanceState.REQUIRED && allowance.needsSetupApproval) {
        return { buttonText: t('swap.approveAndSwap') }
      } else if (allowance && allowance.state === AllowanceState.REQUIRED && allowance.needsPermitSignature) {
        return { buttonText: t('swap.signAndSwap') }
      }
      return { buttonText: t('swap.confirmSwap') }
    }
    if (allowance && allowance.state === AllowanceState.REQUIRED && allowance.needsSetupApproval) {
      return {
        buttonText: trade && isLimitTrade(trade) ? t('swap.approveAndSubmit') : t('swap.approveAndSwap'),
      }
    } else if (allowance && allowance.state === AllowanceState.REQUIRED && allowance.needsPermitSignature) {
      return {
        buttonText: t('swap.signAndSwap'),
      }
    } else {
      return {
        buttonText: trade && isLimitTrade(trade) ? t('swap.placeOrder') : t('swap.confirmSwap'),
      }
    }
  }, [allowance, crossChainProps, trade])

  return (
    <>
      <DetailsContainer gap="sm">
        {crossChainProps ? (
          <CrossChainLineItems
            crossChainProps={crossChainProps}
            showMore={showMore}
            onToggleShowMore={() => setShowMore(!showMore)}
          />
        ) : trade && isLimitTrade(trade) ? (
          <>
            <Separator />
            <LimitLineItems trade={trade} />
          </>
        ) : lineItemProps ? (
          <>
            <DropdownController open={showMore} onClick={() => setShowMore(!showMore)} />
            <SwapLineItems showMore={showMore} {...lineItemProps} />
          </>
        ) : null}
      </DetailsContainer>
      {showAcceptChanges ? (
        <SwapShowAcceptChanges data-testid="show-accept-changes">
          <RowBetween>
            <RowFixed>
              <StyledAlertTriangle size={20} />
              <ThemedText.DeprecatedMain color={theme.accent1}>
                <Trans i18nKey="common.priceUpdated" />
              </ThemedText.DeprecatedMain>
            </RowFixed>
            <SmallButtonPrimary onClick={onAcceptChanges}>
              <Trans i18nKey="common.accept" />
            </SmallButtonPrimary>
          </RowBetween>
        </SwapShowAcceptChanges>
      ) : (
        <AutoRow>
          <Trace
            logPress
            element={InterfaceElementName.CONFIRM_SWAP_BUTTON}
            eventOnTrigger={SwapEventName.SWAP_SUBMITTED_BUTTON_CLICKED}
            properties={
              {
                ...(trade && allowedSlippage
                  ? (formatSwapButtonClickEventProperties({
                      trade,
                      swapResult,
                      allowedSlippage,
                      isAutoSlippage,
                      isAutoRouterApi: routerPreference === RouterPreference.API,
                      routes,
                      fiatValueInput: fiatValueInput?.data,
                      fiatValueOutput: fiatValueOutput?.data,
                    } as any) as object)
                  : {}),
                ...analyticsContext,
              } as any
            }
          >
            <ConfirmButton
              data-testid="confirm-swap-button"
              onClick={onConfirm}
              disabled={disabledConfirm}
              $borderRadius="12px"
              id={InterfaceElementName.CONFIRM_SWAP_BUTTON}
            >
              {isLoading ? (
                <ThemedText.HeadlineSmall color="neutral2">
                  <Row>
                    <SpinningLoader size={14} />
                    <Trans i18nKey="swap.finalizingQuote" />
                  </Row>
                </ThemedText.HeadlineSmall>
              ) : (
                <Text fontSize={20}>{callToAction.buttonText}</Text>
              )}
            </ConfirmButton>
            {callToAction.helpLink && (
              <HelpLink href={callToAction.helpLink.url}>{callToAction.helpLink.text}</HelpLink>
            )}
          </Trace>

          {swapErrorMessage ? <SwapCallbackError error={swapErrorMessage} /> : null}
        </AutoRow>
      )}
    </>
  )
}

function AnimatedLineItem(props: SwapLineItemProps & { open: boolean; delay: number }) {
  const { open, delay } = props

  const animatedProps = useSpring({
    animatedOpacity: open ? 1 : 0,
    config: { duration: ms('300ms'), easing: easings.easeOutSine },
    delay,
  })

  return <SwapLineItem {...props} {...animatedProps} />
}

function SwapLineItems({
  showMore,
  trade,
  allowedSlippage,
  syncing,
  priceImpact,
}: {
  showMore: boolean
  trade: InterfaceTrade
  allowedSlippage: Percent
  syncing: boolean
  priceImpact?: Percent
}) {
  return (
    <>
      <SwapLineItem
        trade={trade}
        allowedSlippage={allowedSlippage}
        syncing={syncing}
        type={SwapLineItemType.EXCHANGE_RATE}
      />
      <ExpandableLineItems trade={trade} allowedSlippage={allowedSlippage} open={showMore} priceImpact={priceImpact} />
      <SwapLineItem
        trade={trade}
        allowedSlippage={allowedSlippage}
        syncing={syncing}
        type={SwapLineItemType.INPUT_TOKEN_FEE_ON_TRANSFER}
      />
      <SwapLineItem
        trade={trade}
        allowedSlippage={allowedSlippage}
        syncing={syncing}
        type={SwapLineItemType.OUTPUT_TOKEN_FEE_ON_TRANSFER}
      />
      <SwapLineItem
        trade={trade}
        allowedSlippage={allowedSlippage}
        syncing={syncing}
        type={SwapLineItemType.SWAP_FEE}
      />
      <SwapLineItem
        trade={trade}
        allowedSlippage={allowedSlippage}
        syncing={syncing}
        type={SwapLineItemType.NETWORK_COST}
      />
    </>
  )
}

function ExpandableLineItems(props: {
  trade: InterfaceTrade
  allowedSlippage: Percent
  open: boolean
  priceImpact?: Percent
  /** Cross-chain: pass both legs so PRICE_IMPACT can combine leg1+leg2 and MINIMUM_OUTPUT
   * can use leg2's (final) output instead of leg1's intermediate one. */
  leg1Trade?: InterfaceTrade
  leg2Trade?: InterfaceTrade
  minimumOutputTrade?: InterfaceTrade
}) {
  const { open, trade, allowedSlippage, priceImpact, leg1Trade, leg2Trade, minimumOutputTrade } = props

  if (!trade) {
    return null
  }

  // MAXIMUM_INPUT must use the leg that spends the original input currency: leg1Trade when
  // present (cross-chain SWAP_BRIDGE/SWAP_BRIDGE_SWAP), else trade itself.
  const maximumInputTrade = leg1Trade ?? trade

  const lineItemProps = {
    trade,
    allowedSlippage,
    syncing: false,
    open,
    priceImpact,
    leg1Trade,
    leg2Trade,
    minimumOutputTrade,
    maximumInputTrade,
  }



  return (
    <AnimatedDropdown
      open={open}
      springProps={{
        marginTop: open ? 0 : -8,
        config: {
          duration: ms('200ms'),
          easing: easings.easeOutSine,
        },
      }}
    >
      <Column gap="sm">
        <AnimatedLineItem {...lineItemProps} type={SwapLineItemType.PRICE_IMPACT} delay={ms('50ms')} />
        <AnimatedLineItem {...lineItemProps} type={SwapLineItemType.MAX_SLIPPAGE} delay={ms('100ms')} />
        <AnimatedLineItem {...lineItemProps} type={SwapLineItemType.MINIMUM_OUTPUT} delay={ms('120ms')} />
        <AnimatedLineItem {...lineItemProps} type={SwapLineItemType.MAXIMUM_INPUT} delay={ms('120ms')} />
      </Column>
    </AnimatedDropdown>
  )
}

/**
 * Cross-chain details — covers both BRIDGE_ONLY (no swap leg) and SWAP_BRIDGE (leg1Trade present).
 * Rate row falls back to crossChainInputAmount/crossChainOutputAmount when there's no leg1Trade.
 * Expandable (price impact/slippage/min-max) only renders when a swap leg exists.
 */
function CrossChainLineItems({
  crossChainProps,
  showMore,
  onToggleShowMore,
}: {
  crossChainProps: CrossChainDetailsProps
  showMore: boolean
  onToggleShowMore: () => void
}) {
  const {
    leg1Trade,
    leg2Trade,
    allowedSlippage,
    inputCurrency,
    outputCurrency,
    crossChainInputAmount,
    crossChainOutputAmount,
    bridgeQuote,
  } = crossChainProps

  const displayPrice = useMemo(() => {
    if (crossChainInputAmount && crossChainOutputAmount) {
      return new Price(
        crossChainInputAmount.currency,
        crossChainOutputAmount.currency,
        crossChainInputAmount.quotient,
        crossChainOutputAmount.quotient,
      )
    }
    if (leg1Trade && outputCurrency) {
      const ep = leg1Trade.executionPrice
      return new Price(ep.baseCurrency, outputCurrency, ep.denominator, ep.numerator)
    }
    return undefined
  }, [leg1Trade, outputCurrency, crossChainInputAmount, crossChainOutputAmount])

  return (
    <>
      <DropdownController open={showMore} onClick={onToggleShowMore} />
      {/* Rate: show inputCurrency → outputCurrency (final token, e.g. JOC) */}
      {displayPrice && (
        <RowBetween>
          <ThemedText.BodySmall color="neutral2">
            <Trans i18nKey="common.rate" />
          </ThemedText.BodySmall>
          <TradePrice price={displayPrice} />
        </RowBetween>
      )}
      {/* Expandable: price impact, max slippage, min output, max input — swap leg only.
          leg1Trade covers SWAP_BRIDGE/SWAP_BRIDGE_SWAP; fall back to leg2Trade for BRIDGE_SWAP
          (was leg1Trade-only, so BRIDGE_SWAP showed no expandable swap details at all).
          Pass both legs through so PRICE_IMPACT combines leg1+leg2 (SWAP_BRIDGE_SWAP) instead of
          showing only leg1's impact, and MINIMUM_OUTPUT uses leg2's final-token output. */}
      {(leg1Trade ?? leg2Trade) && allowedSlippage && (
        <ExpandableLineItems
          trade={(leg1Trade ?? leg2Trade)!}
          allowedSlippage={allowedSlippage}
          open={showMore}
          leg1Trade={leg1Trade}
          leg2Trade={leg2Trade}
          minimumOutputTrade={leg2Trade ?? leg1Trade}
        />
      )}


      {/* Combined Fee (swap fee + bridge fee) */}
      <SwapLineItem
        type={SwapLineItemType.BRIDGE_FEE}
        bridgeQuote={bridgeQuote}
        leg1Trade={leg1Trade}
        leg2Trade={leg2Trade}
        inputCurrency={inputCurrency}
        outputCurrency={outputCurrency}
      />
      {/* Order routing (cross-chain) */}
      <SwapLineItem
        type={SwapLineItemType.ROUTING_INFO}
        crossChainRoute={crossChainProps.route}
        inputCurrency={inputCurrency}
        outputCurrency={outputCurrency}
        leg1Trade={leg1Trade}
        leg2Trade={leg2Trade}
        bridgeQuote={bridgeQuote}
      />
    </>
  )
}

function LimitLineItems({ trade }: { trade: LimitOrderTrade }) {
  return (
    <>
      <SwapLineItem trade={trade} type={SwapLineItemType.EXCHANGE_RATE} />
      <SwapLineItem trade={trade} type={SwapLineItemType.EXPIRY} />
      <SwapLineItem trade={trade} type={SwapLineItemType.SWAP_FEE} />
      <SwapLineItem trade={trade} type={SwapLineItemType.NETWORK_COST} />
      <LimitDisclaimer />
    </>
  )
}
