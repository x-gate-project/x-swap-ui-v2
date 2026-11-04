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
import { XSwapLeg } from 'state/xswap/types'
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
  uniswap: 'Uniswap API',
}

/** `Swap → Across → Swap`: the route's legs at a glance, to tell routes of one provider apart. */
export function xswapLegSummary(legs: XSwapLeg[] | undefined): string | undefined {
  if (!legs?.length) {
    return undefined
  }
  return legs
    .map((leg) => (leg.type === 'swap' ? t('xswap.route.leg.swapTitle') : xswapProviderName(leg.provider)))
    .join(' → ')
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
                  venue: VENUE_NAMES[leg.venue] ?? leg.venue,
                  amountOut: amount(leg.chainId, leg.tokenOut, leg.expectedOut),
                  minOut: amount(leg.chainId, leg.tokenOut, leg.minOut),
                })}
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
                  minOut: amount(leg.tokenOutChainId, leg.tokenOut, leg.minOut),
                })}
              </Muted>
            </Body>
          )}
        </Item>
      ))}
    </List>
  )
}
