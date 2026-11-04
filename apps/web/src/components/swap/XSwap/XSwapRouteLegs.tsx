import {
  Badge,
  Muted,
  formatXSwapTokenAmount,
  formatXSwapTokenSymbol,
  useXSwapChainName,
  useXSwapLegTokenLookup,
  useXSwapNativeSymbol,
  xswapProviderName,
} from 'components/swap/XSwap/shared'
import { t } from 'i18n'
import { XSwapTokenLookup } from 'state/xswap/hooks'
import { XSwapLeg, XSwapQuote } from 'state/xswap/types'
import { formatXSwapUnits } from 'state/xswap/utils'
import styled from 'styled-components'
import { ThemedText } from 'theme/components'

const List = styled.ol`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Item = styled.li`
  display: flex;
  gap: 8px;
  align-items: flex-start;
`

const Index = styled.span`
  flex: none;
  width: 16px;
  color: ${({ theme }) => theme.neutral3};
  font-size: 12px;
  line-height: 20px;
`

const Body = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`

const Title = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
`

const VENUE_NAMES: Record<string, string> = {
  'uniswap-v3': 'Uniswap v3',
  'uniswap-v2': 'Uniswap v2',
  uniswap: 'Uniswap',
}

function xswapVenueName(venue: string): string {
  return VENUE_NAMES[venue] ?? venue
}

/** Label of a bridge's native fee: XGate pays LayerZero with it. */
export function xswapNativeFeeLabel(provider: string | undefined): string {
  return provider === 'xgate' ? t('xswap.route.fee.layerZero') : t('xswap.route.fee.bridgeNative')
}

/**
 * `Uniswap v3 → Across → Uniswap v2`: the route's legs at a glance, each swap by its venue and the bridge by its
 * provider, so composite routes of one shape but different venues can be told apart.
 */
export function xswapLegSummary(legs: XSwapLeg[] | undefined): string | undefined {
  if (!legs?.length) {
    return undefined
  }
  return legs
    .map((leg) => (leg.type === 'swap' ? xswapVenueName(leg.venue) : xswapProviderName(leg.provider)))
    .join(' → ')
}

/** The name of a route: its legs when it has more than one, its provider otherwise. */
export function xswapRouteName(route: Pick<XSwapQuote, 'provider' | 'legs'>): string {
  return ((route.legs?.length ?? 0) > 1 && xswapLegSummary(route.legs)) || xswapProviderName(route.provider)
}

/** Whether a route's legs say more than the details rows: any route with a bridge or more than one leg. */
export function xswapShowsLegs(legs: XSwapLeg[] | undefined): boolean {
  return Boolean(legs?.some((leg) => leg.type === 'bridge') || (legs?.length ?? 0) > 1)
}

/** ` (min X)`, only when the minimum differs from the expected output. */
function minSuffix(expectedOut: string, minOut: string, formatted: string): string {
  return BigInt(minOut) === BigInt(expectedOut) ? '' : ` ${t('xswap.route.leg.min', { minOut: formatted })}`
}

/**
 * The route of a quote in execution order: each swap (chain, token path, venue) and the bridge between the chains
 * (provider, token in and out). A composite route reads e.g. swap on Sepolia, bridge to Arbitrum, swap on Arbitrum.
 */
export function XSwapRouteLegs({ legs, lookup: listLookup }: { legs: XSwapLeg[]; lookup: XSwapTokenLookup }) {
  const lookup = useXSwapLegTokenLookup(listLookup)
  const chainName = useXSwapChainName()
  const nativeSymbol = useXSwapNativeSymbol()
  const symbol = (chainId: number, address: string) => formatXSwapTokenSymbol(lookup, nativeSymbol, chainId, address)
  const amount = (chainId: number, address: string, value: string) =>
    formatXSwapTokenAmount(lookup, nativeSymbol, chainId, address, value)

  return (
    <List data-testid="xswap-route-legs">
      {legs.map((leg, i) => (
        <Item key={i} data-testid={`xswap-route-leg-${leg.type}`}>
          <Index>{i + 1}.</Index>
          {leg.type === 'swap' ? (
            <Body>
              <Title>
                <Badge>{t('xswap.route.leg.swapTitle')}</Badge>
                <ThemedText.BodySmall>
                  {(leg.path?.tokens ?? [leg.tokenIn, leg.tokenOut])
                    .map((token) => symbol(leg.chainId, token))
                    .join(' → ')}
                </ThemedText.BodySmall>
              </Title>
              <Muted>
                {t('xswap.route.leg.swapDetail', {
                  chain: chainName(leg.chainId),
                  venue: xswapVenueName(leg.venue),
                  amountIn: amount(leg.chainId, leg.tokenIn, leg.amountIn),
                  amountOut: amount(leg.chainId, leg.tokenOut, leg.expectedOut),
                })}
                {minSuffix(leg.expectedOut, leg.minOut, amount(leg.chainId, leg.tokenOut, leg.minOut))}
              </Muted>
            </Body>
          ) : (
            <Body>
              <Title>
                <Badge $tone="accent">{t('xswap.route.leg.bridgeTitle')}</Badge>
                <ThemedText.BodySmall>
                  {symbol(leg.tokenInChainId, leg.tokenIn)} → {symbol(leg.tokenOutChainId, leg.tokenOut)}
                </ThemedText.BodySmall>
              </Title>
              <Muted>
                {t('xswap.route.leg.bridgeDetail', {
                  from: chainName(leg.tokenInChainId),
                  to: chainName(leg.tokenOutChainId),
                  provider: xswapProviderName(leg.provider),
                  amountOut: amount(leg.tokenOutChainId, leg.tokenOut, leg.expectedOut),
                })}
                {minSuffix(leg.expectedOut, leg.minOut, amount(leg.tokenOutChainId, leg.tokenOut, leg.minOut))}
                {BigInt(leg.nativeFee || '0') > 0n &&
                  ` · ${xswapNativeFeeLabel(leg.provider)} ${formatXSwapUnits(leg.nativeFee, 18)} ${nativeSymbol(leg.tokenInChainId)}`}
              </Muted>
            </Body>
          )}
        </Item>
      ))}
    </List>
  )
}
