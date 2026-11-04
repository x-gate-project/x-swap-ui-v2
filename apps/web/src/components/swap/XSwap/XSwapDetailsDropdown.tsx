import { Currency, CurrencyAmount, Percent, Price } from '@uniswap/sdk-core'
import AnimatedDropdown from 'components/AnimatedDropdown'
import Column from 'components/Column'
import { LoadingOpacityContainer } from 'components/Loader/styled'
import { RowBetween, RowFixed } from 'components/Row'
import { DetailLineItem } from 'components/swap/DetailLineItem'
import { SlippageTooltipContent } from 'components/swap/SwapLineItem'
import TradePrice from 'components/swap/TradePrice'
import { XSwapRouteLegs, xswapNativeFeeLabel, xswapRouteName, xswapShowsLegs } from 'components/swap/XSwap/XSwapRouteLegs'
import {
  formatXSwapTokenSymbol,
  useXSwapLegTokenLookup,
  useXSwapNativeSymbol,
  xswapRouteKey,
} from 'components/swap/XSwap/shared'
import { Trans, t } from 'i18n'
import { useMemo, useState } from 'react'
import { ChevronDown } from 'react-feather'
import { useUserSlippageTolerance } from 'state/user/hooks'
import { SlippageTolerance } from 'state/user/types'
import { XSwapTokenLookup } from 'state/xswap/hooks'
import { XSwapLeg, XSwapQuote } from 'state/xswap/types'
import { formatXSwapEta, formatXSwapUnits, xswapBridgeNativeFee } from 'state/xswap/utils'
import styled, { DefaultTheme, useTheme } from 'styled-components'
import { ThemedText } from 'theme/components'
import { NumberType, useFormatter } from 'utils/formatNumbers'
import { getPriceImpactColor } from 'utils/prices'

const Wrapper = styled(Column)`
  border-radius: 16px;
  padding: 12px 16px;
`

const StyledHeaderRow = styled(RowBetween)<{ disabled: boolean }>`
  padding: 0;
  align-items: center;
  cursor: ${({ disabled }) => (disabled ? 'initial' : 'pointer')};
`

const RotatingArrow = styled(ChevronDown)<{ open?: boolean }>`
  transform: ${({ open }) => (open ? 'rotate(180deg)' : 'none')};
  transition: transform 0.1s linear;
`

const DetailsWrapper = styled(Column)`
  padding-top: ${({ theme }) => theme.grids.md};
`

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
`

const RouteOption = styled.button<{ $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid ${({ theme, $selected }) => ($selected ? theme.accent1 : 'transparent')};
  border-radius: 12px;
  background: ${({ theme, $selected }) => ($selected ? theme.surface2 : 'transparent')};
  color: ${({ theme }) => theme.neutral1};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.surface2};
  }

  &:disabled {
    cursor: default;
  }
`

type Props = {
  routes?: XSwapQuote[]
  selected?: XSwapQuote
  bestQuoteId?: string
  inputCurrency: Currency
  outputCurrency: Currency
  lookup: XSwapTokenLookup
  /** A new amount or pair is being quoted: no route yet. */
  loading: boolean
  /** A background re-quote of the shown route is in flight. */
  syncing: boolean
  /** An order is executing: the route cannot change. */
  disabled?: boolean
  /** Picks a route by `xswapRouteKey`. */
  onSelectRoute: (routeKey: string) => void
}

/** Slippage the API applied: how far `minOutputAmount` is below `outputAmount`. */
function quoteSlippage(quote: XSwapQuote): Percent | undefined {
  const out = BigInt(quote.outputAmount)
  if (out === 0n) {
    return undefined
  }
  return new Percent((out - BigInt(quote.minOutputAmount)).toString(), out.toString())
}

/**
 * x-swap API counterpart of `SwapDetailsDropdown`, same-chain and cross-chain: the rate, then price impact, max slippage, minimum output, fees,
 * estimated time and order routing (with its legs) of the selected route, and the other routes to pick from.
 */
export function XSwapDetailsDropdown({
  routes,
  selected,
  bestQuoteId,
  inputCurrency,
  outputCurrency,
  lookup,
  loading,
  syncing,
  disabled,
  onSelectRoute,
}: Props) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const { formatCurrencyAmount, formatPercent } = useFormatter()
  const nativeSymbol = useXSwapNativeSymbol()
  // The bridge fee is in the bridged leg's token, which may be an unlisted wrapped native.
  const legLookup = useXSwapLegTokenLookup(lookup)
  const isAutoSlippage = useUserSlippageTolerance()[0] === SlippageTolerance.Auto

  const price = useMemo(
    () =>
      selected && BigInt(selected.inputAmount) > 0n && BigInt(selected.outputAmount) > 0n
        ? new Price(inputCurrency, outputCurrency, selected.inputAmount, selected.outputAmount)
        : undefined,
    [inputCurrency, outputCurrency, selected],
  )

  const details = useMemo(() => {
    if (!selected) {
      return undefined
    }
    const bridge = selected.legs?.find((leg): leg is Extract<XSwapLeg, { type: 'bridge' }> => leg.type === 'bridge')
    const feeToken = bridge ? legLookup(bridge.tokenInChainId, bridge.tokenIn) : undefined
    const bridgeFee = (['lp', 'relayer', 'app'] as const).reduce((sum, key) => sum + BigInt(selected.fees[key]), 0n)
    const fees: string[] = []
    if (bridgeFee > 0n) {
      fees.push(
        feeToken ? `${formatXSwapUnits(bridgeFee.toString(), feeToken.decimals)} ${feeToken.symbol}` : `${bridgeFee}`,
      )
    }
    // XGate's LayerZero fee, sent as the deposit's `msg.value` on the source chain.
    const nativeFee = xswapBridgeNativeFee(selected)
    const nativeFeeText =
      nativeFee > 0n
        ? `${formatXSwapUnits(nativeFee.toString(), 18)} ${nativeSymbol(selected.tokenIn.chainId)}`
        : undefined
    if (nativeFeeText) {
      fees.push(nativeFeeText)
    }
    if (BigInt(selected.fees.gas) > 0n) {
      fees.push(`${formatXSwapUnits(selected.fees.gas, 18)} ${nativeSymbol(selected.tokenIn.chainId)}`)
    }
    const feeBreakdown = (
      [
        ['lp', t('xswap.route.fee.lp')],
        ['relayer', t('xswap.route.fee.relayer')],
        ['app', t('xswap.route.fee.app')],
      ] as const
    )
      .filter(([key]) => selected.fees[key] !== '0')
      .map(
        ([key, label]) =>
          `${label}: ${feeToken ? formatXSwapUnits(selected.fees[key], feeToken.decimals) : selected.fees[key]}`,
      )
    if (nativeFeeText) {
      feeBreakdown.push(`${xswapNativeFeeLabel(bridge?.provider)}: ${nativeFeeText}`)
    }
    if (selected.fees.gas !== '0') {
      feeBreakdown.push(
        `${t('xswap.route.fee.gas')}: ${formatXSwapUnits(selected.fees.gas, 18)} ${nativeSymbol(selected.tokenIn.chainId)}`,
      )
    }
    return {
      priceImpact: new Percent(selected.priceImpactBps, 10_000),
      slippage: quoteSlippage(selected),
      minOutput: CurrencyAmount.fromRawAmount(outputCurrency, selected.minOutputAmount),
      fees,
      feeBreakdown,
      // The token the user holds if the destination swap fails: a wrapped native stays wrapped, so no leg lookup.
      fallbackSymbol:
        selected.destSwap && selected.fallbackToken
          ? formatXSwapTokenSymbol(lookup, nativeSymbol, selected.tokenOut.chainId, selected.fallbackToken)
          : undefined,
    }
  }, [legLookup, lookup, nativeSymbol, outputCurrency, selected])

  const canOpen = Boolean(selected)
  // A same-chain swap is one leg the rows above already describe; any route with a bridge shows its legs.
  const showLegs = xswapShowsLegs(selected?.legs)

  return (
    <Wrapper data-testid="xswap-details">
      <StyledHeaderRow
        data-testid="xswap-details-header-row"
        onClick={() => canOpen && setOpen(!open)}
        disabled={!canOpen}
      >
        <RowFixed>
          {price ? (
            <LoadingOpacityContainer $loading={syncing}>
              <TradePrice price={price} />
            </LoadingOpacityContainer>
          ) : loading ? (
            <ThemedText.DeprecatedMain fontSize={14}>
              <Trans i18nKey="swap.fetchingBestPrice" />
            </ThemedText.DeprecatedMain>
          ) : null}
        </RowFixed>
        <RotatingArrow stroke={canOpen ? theme.neutral3 : theme.surface2} open={canOpen && open} />
      </StyledHeaderRow>

      {selected && details && (
        <AnimatedDropdown open={open}>
          <DetailsWrapper gap="sm" data-testid="xswap-advanced-details">
            {selected.priceImpactBps > 0 && (
              <DetailLineItem
                syncing={syncing}
                LineItem={{
                  Label: () => <Trans i18nKey="swap.priceImpact" />,
                  TooltipBody: () => <Trans i18nKey="swap.impactOfTrade" />,
                  Value: () => (
                    <ColorWrapper textColor={getPriceImpactColor(details.priceImpact)}>
                      ~{formatPercent(details.priceImpact)}
                    </ColorWrapper>
                  ),
                }}
              />
            )}
            {details.slippage && (
              <DetailLineItem
                syncing={syncing}
                LineItem={{
                  Label: () => <Trans i18nKey="settings.maxSlippage" />,
                  TooltipBody: () => <SlippageTooltipContent />,
                  Value: () => (
                    <RowFixed gap="8px">
                      {isAutoSlippage && <AutoBadge>{t('common.automatic')}</AutoBadge>}
                      {details.slippage && formatPercent(details.slippage)}
                    </RowFixed>
                  ),
                }}
              />
            )}
            <DetailLineItem
              syncing={syncing}
              LineItem={{
                Label: () => <Trans i18nKey="swap.receive.atLeast" />,
                Value: () => (
                  <>
                    {formatCurrencyAmount({ amount: details.minOutput, type: NumberType.SwapDetailsAmount })}{' '}
                    {outputCurrency.symbol}
                  </>
                ),
                loaderWidth: 70,
              }}
            />
            <DetailLineItem
              syncing={syncing}
              LineItem={{
                Label: () => <Trans i18nKey="common.fee.caps" />,
                TooltipBody: details.feeBreakdown.length
                  ? () => (
                      <>
                        {details.feeBreakdown.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </>
                    )
                  : undefined,
                Value: () => <>{details.fees.length ? details.fees.join(' + ') : '0'}</>,
              }}
            />
            {details.fallbackSymbol && (
              <DetailLineItem
                syncing={syncing}
                LineItem={{
                  Label: () => <>{t('xswap.route.fallback')}</>,
                  TooltipBody: () => <>{t('xswap.route.fallback.tooltip')}</>,
                  Value: () => <>{details.fallbackSymbol}</>,
                }}
              />
            )}
            <DetailLineItem
              syncing={syncing}
              LineItem={{
                Label: () => <>{t('xswap.route.eta')}</>,
                Value: () => <>~{formatXSwapEta(selected.etaSec)}</>,
              }}
            />
            <DetailLineItem
              syncing={syncing}
              LineItem={{
                Label: () => <Trans i18nKey="swap.orderRouting" />,
                Value: () => <>{xswapRouteName(selected)}</>,
              }}
            />
            {showLegs && selected.legs && <XSwapRouteLegs legs={selected.legs} lookup={lookup} />}
            {routes && routes.length > 1 && (
              <Column gap="xs" data-testid="xswap-routes">
                <ThemedText.BodySmall color="neutral2">{t('xswap.route.title')}</ThemedText.BodySmall>
                {routes.map((route) => (
                  <RouteOption
                    key={route.quoteId}
                    type="button"
                    $selected={route.quoteId === selected.quoteId}
                    aria-pressed={route.quoteId === selected.quoteId}
                    disabled={disabled}
                    onClick={() => onSelectRoute(xswapRouteKey(route))}
                    data-testid={`xswap-route-${route.provider}`}
                  >
                    <ThemedText.BodySmall>
                      {xswapRouteName(route)}
                      {route.quoteId === bestQuoteId && ` · ${t('xswap.route.best')}`}
                      {!route.executable && ` · ${t('xswap.route.quoteOnly')}`}
                      {` · ~${formatXSwapEta(route.etaSec)}`}
                    </ThemedText.BodySmall>
                    <ThemedText.BodySmall>
                      {formatCurrencyAmount({
                        amount: CurrencyAmount.fromRawAmount(outputCurrency, route.outputAmount),
                        type: NumberType.SwapDetailsAmount,
                      })}{' '}
                      {outputCurrency.symbol}
                    </ThemedText.BodySmall>
                  </RouteOption>
                ))}
              </Column>
            )}
          </DetailsWrapper>
        </AnimatedDropdown>
      )}
    </Wrapper>
  )
}
