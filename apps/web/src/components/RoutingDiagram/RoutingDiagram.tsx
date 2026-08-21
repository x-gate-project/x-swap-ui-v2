import { Protocol } from '@uniswap/router-sdk'
import { Currency, Percent, Token } from '@uniswap/sdk-core'

import { FeeAmount } from '@uniswap/v3-sdk'
import { ReactComponent as DotLine } from 'assets/svg/dot_line.svg'
import Badge from 'components/Badge'
import { DoubleCurrencyLogo } from 'components/DoubleLogo'
import CurrencyLogo from 'components/Logo/CurrencyLogo'
import Row, { AutoRow } from 'components/Row'
import { MouseoverTooltip, TooltipSize } from 'components/Tooltip'
import { BIPS_BASE } from 'constants/misc'
import { Trans } from 'i18n'
import { CrossChainRoute, IntermediateToken } from 'lib/crossChain/types'
import { Box } from 'rebass'
import styled from 'styled-components'
import { ThemedText } from 'theme/components'
import { Z_INDEX } from 'theme/zIndex'
import { RoutingDiagramEntry } from 'utils/getRoutingDiagramEntries'

const Wrapper = styled(Box)`
  align-items: center;
  width: 100%;
`

const RouteContainerRow = styled(Row)`
  display: grid;
  grid-template-columns: 24px 1fr 24px;
`

const RouteRow = styled(Row)`
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 0.1rem 0.5rem;
  position: relative;
`

const PoolBadge = styled(Badge)`
  display: flex;
  padding: 4px 4px;
`

const DottedLine = styled.div`
  display: flex;
  align-items: center;
  position: absolute;
  width: calc(100%);
  z-index: 1;
  opacity: 0.5;
`

const DotColor = styled(DotLine)`
  path {
    stroke: ${({ theme }) => theme.surface3};
  }
`

const OpaqueBadge = styled(Badge)`
  background-color: ${({ theme }) => theme.surface2};
  border-radius: 8px;
  display: grid;
  grid-gap: 4px;
  grid-auto-flow: column;
  justify-content: start;
  padding: 4px 6px;
  z-index: ${Z_INDEX.sticky};
`

const ProtocolBadge = styled(Badge)`
  background-color: ${({ theme }) => theme.surface2};
  border-radius: 4px;
  color: ${({ theme }) => theme.neutral2};
  font-size: 10px;
  padding: 2px 4px;
  z-index: ${Z_INDEX.sticky + 1};
`

const MixedProtocolBadge = styled(ProtocolBadge)`
  width: 60px;
`

const BadgeText = styled(ThemedText.LabelMicro)`
  word-break: normal;
`

// ── Cross-chain bridge row styles ────────────────────────────────────────────

const BridgeRouteRow = styled(Row)`
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
  width: 100%;
`

const BridgeIconsRow = styled(Row)`
  align-items: center;
  display: grid;
  grid-template-columns: 24px 1fr 24px;
  width: 100%;
`

const BridgeMiddle = styled(Row)`
  align-items: center;
  display: flex;
  justify-content: center;
  padding: 0 0.5rem;
  position: relative;
`

const BridgeProtocolIcon = styled.img`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  z-index: ${Z_INDEX.sticky};
  background: ${({ theme }) => theme.surface1};
`


/** Split circle icon (half LayerZero / half Across) shown when the bridge protocol isn't known yet. */
const SplitProtocolIcon = styled.div`
  position: relative;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  overflow: hidden;
  z-index: ${Z_INDEX.sticky};
  background: ${({ theme }) => theme.surface1};
`

const SplitIconHalf = styled.img<{ side: 'left' | 'right' }>`
  position: absolute;
  top: 0;
  left: 0;
  width: 18px;
  height: 18px;
  object-fit: cover;
  clip-path: ${({ side }) => (side === 'left' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)')};
`


const BridgeFeeText = styled(ThemedText.LabelMicro)`
  color: ${({ theme }) => theme.neutral2};
  white-space: nowrap;
`


// ── Pool component ────────────────────────────────────────────────────────────

function Pool({ currency0, currency1, feeAmount }: { currency0: Currency; currency1: Currency; feeAmount: FeeAmount }) {
  // TODO - link pool icon to info.uniswap.org via query params
  return (
    <MouseoverTooltip
      text={
        <Trans
          i18nKey="pool.percent"
          values={{ pct: currency0?.symbol + '/' + currency1?.symbol + ' ' + feeAmount / 10000 }}
        />
      }
      size={TooltipSize.ExtraSmall}
    >
      <PoolBadge>
        <Box margin="0 4px 0 12px">
          <DoubleCurrencyLogo currencies={[currency0, currency1]} size={20} />
        </Box>
        <BadgeText>{feeAmount / BIPS_BASE}%</BadgeText>
      </PoolBadge>
    </MouseoverTooltip>
  )
}

// ── Bridge route display ──────────────────────────────────────────────────────

/** Convert IntermediateToken plain object → SDK Token for CurrencyLogo */
function toToken(t: IntermediateToken): Token {
  return new Token(t.chainId, t.address, t.decimals, t.symbol)
}

/** Maps a bridge adapter protocol to its logo asset (served from /public). */
export const BRIDGE_PROTOCOL_ICON: Record<string, string> = {
  Across: '/images/logos/across-logo.png',
  'LayerZero OFT': '/images/logos/layer_zero.png',
}


/** Bridge leg: reuses the same icon-row layout, showing the bridge adapter's logo (or a text badge fallback). */
function BridgeLegRow({
  left,
  right,
  bridgeProtocol,
  bridgeFeePercent,
}: {
  left: Currency
  right: Currency
  bridgeProtocol?: string
  /** Relayer fee % for this bridge leg — shown under the icon */
  bridgeFeePercent?: Percent
}) {
  const iconSrc = bridgeProtocol && BRIDGE_PROTOCOL_ICON[bridgeProtocol]
  const feeLabel = bridgeFeePercent && !bridgeFeePercent.equalTo(0) ? `${bridgeFeePercent.toSignificant(2)}%` : undefined
  const tooltipText = bridgeProtocol && feeLabel ? `${bridgeProtocol} — ${feeLabel}` : bridgeProtocol ?? 'Bridge protocol pending'

  return (
    <BridgeIconsRow>
      <CurrencyLogo currency={left} size={20} />
      <BridgeMiddle>
        <DottedLine>
          <DotColor />
        </DottedLine>
        <AutoRow gap="1px" width="100%" style={{ justifyContent: 'space-evenly', zIndex: 2 }}>
          <MouseoverTooltip text={tooltipText} size={TooltipSize.ExtraSmall}>
            <PoolBadge>
              <Box margin={feeLabel ? '0 4px 0 12px' : '0 4px'}>
                {iconSrc ? (
                  <BridgeProtocolIcon src={iconSrc} alt={bridgeProtocol} />
                ) : (
                  <SplitProtocolIcon>
                    <SplitIconHalf side="left" src={BRIDGE_PROTOCOL_ICON['LayerZero OFT']} alt="" />
                    <SplitIconHalf side="right" src={BRIDGE_PROTOCOL_ICON.Across} alt="" />
                  </SplitProtocolIcon>
                )}
              </Box>
              {feeLabel && <BridgeFeeText>{feeLabel}</BridgeFeeText>}
            </PoolBadge>
          </MouseoverTooltip>
        </AutoRow>
      </BridgeMiddle>
      <CurrencyLogo currency={right} size={20} />
    </BridgeIconsRow>
  )
}



function BridgeRoute({
  currencyIn,
  currencyOut,
  route,
  leg1Routes,
  leg2Routes,
  bridgeProtocol,
  bridgeFeePercent,
}: {
  currencyIn: Currency
  currencyOut: Currency
  route: CrossChainRoute
  leg1Routes?: RoutingDiagramEntry[]
  leg2Routes?: RoutingDiagramEntry[]
  bridgeProtocol?: string
  bridgeFeePercent?: Percent
}) {
  const { routeCase, intermediateToken, intermediateTokenSrc, intermediateTokenDst } = route

  if (routeCase === 'SWAP_BRIDGE_SWAP' && intermediateTokenSrc && intermediateTokenDst) {
    const srcCurrency = toToken(intermediateTokenSrc)
    const dstCurrency = toToken(intermediateTokenDst)
    return (
      <BridgeRouteRow>
        {/* Row 1: Swap leg1 — srcToken → intermediateTokenSrc */}
        {leg1Routes && leg1Routes.length > 0 ? (
          leg1Routes.map((entry, i) => (
            <RouteContainerRow key={i}>
              <CurrencyLogo currency={currencyIn} size={20} />
              <Route entry={entry} />
              <CurrencyLogo currency={srcCurrency} size={20} />
            </RouteContainerRow>
          ))
        ) : (
          <BridgeLegRow left={currencyIn} right={srcCurrency} />
        )}
        {/* Row 2: Bridge leg — intermediateTokenSrc → intermediateTokenDst */}
        <BridgeLegRow
          left={srcCurrency}
          right={dstCurrency}
          bridgeProtocol={bridgeProtocol}
          bridgeFeePercent={bridgeFeePercent}
        />
        {/* Row 3: Swap leg2 — intermediateTokenDst → destToken */}
        {leg2Routes && leg2Routes.length > 0 ? (
          leg2Routes.map((entry, i) => (
            <RouteContainerRow key={i}>
              <CurrencyLogo currency={dstCurrency} size={20} />
              <Route entry={entry} />
              <CurrencyLogo currency={currencyOut} size={20} />
            </RouteContainerRow>
          ))
        ) : (
          <BridgeLegRow left={dstCurrency} right={currencyOut} />
        )}
      </BridgeRouteRow>
    )
  }

  if (routeCase === 'BRIDGE_SWAP' && intermediateToken) {
    const intermediateCurrency = toToken(intermediateToken)
    return (
      <BridgeRouteRow>
        {/* Row 1: Bridge leg — srcToken → intermediateToken */}
        <BridgeLegRow
          left={currencyIn}
          right={intermediateCurrency}
          bridgeProtocol={bridgeProtocol}
          bridgeFeePercent={bridgeFeePercent}
        />
        {/* Row 2: Swap leg2 — intermediateToken → destToken */}
        {leg2Routes && leg2Routes.length > 0 ? (
          leg2Routes.map((entry, i) => (
            <RouteContainerRow key={i}>
              <CurrencyLogo currency={intermediateCurrency} size={20} />
              <Route entry={entry} />
              <CurrencyLogo currency={currencyOut} size={20} />
            </RouteContainerRow>
          ))
        ) : (
          <BridgeLegRow left={intermediateCurrency} right={currencyOut} />
        )}
      </BridgeRouteRow>
    )
  }

  if (routeCase === 'SWAP_BRIDGE' && intermediateToken) {
    const intermediateCurrency = toToken(intermediateToken)
    return (
      <BridgeRouteRow>
        {/* Row 1: Swap leg — srcToken → intermediateToken, rendered same as same-chain pool routes */}
        {leg1Routes && leg1Routes.length > 0 ? (
          leg1Routes.map((entry, i) => (
            <RouteContainerRow key={i}>
              <CurrencyLogo currency={currencyIn} size={20} />
              <Route entry={entry} />
              <CurrencyLogo currency={intermediateCurrency} size={20} />
            </RouteContainerRow>
          ))
        ) : (
          <BridgeLegRow left={currencyIn} right={intermediateCurrency} />
        )}
        {/* Row 2: Bridge leg — intermediateToken → destToken */}
        <BridgeLegRow
          left={intermediateCurrency}
          right={currencyOut}
          bridgeProtocol={bridgeProtocol}
          bridgeFeePercent={bridgeFeePercent}
        />
      </BridgeRouteRow>
    )
  }

  // BRIDGE_ONLY (default): single row
  return (
    <BridgeRouteRow>
      <BridgeLegRow
        left={currencyIn}
        right={currencyOut}
        bridgeProtocol={bridgeProtocol}
        bridgeFeePercent={bridgeFeePercent}
      />
    </BridgeRouteRow>
  )
}


// ── Main export ───────────────────────────────────────────────────────────────

export default function RoutingDiagram({
  currencyIn,
  currencyOut,
  routes,
  crossChainRoute,
  leg1Routes,
  leg2Routes,
  bridgeProtocol,
  bridgeFeePercent,
}: {
  currencyIn: Currency
  currencyOut: Currency
  routes: RoutingDiagramEntry[]
  crossChainRoute?: CrossChainRoute
  /** Leg1 pool routes for SWAP_BRIDGE / SWAP_BRIDGE_SWAP swap step */
  leg1Routes?: RoutingDiagramEntry[]
  /** Leg2 pool routes for BRIDGE_SWAP / SWAP_BRIDGE_SWAP final swap step */
  leg2Routes?: RoutingDiagramEntry[]
  /** Bridge adapter used for cross-chain transfer — determines which logo to show */
  bridgeProtocol?: string
  /** Relayer fee % for the bridge leg — shown under the bridge icon */
  bridgeFeePercent?: Percent
}) {
  // Cross-chain: render bridge route diagram
  if (crossChainRoute) {
    return (
      <Wrapper>
        <BridgeRoute
          currencyIn={currencyIn}
          currencyOut={currencyOut}
          route={crossChainRoute}
          leg1Routes={leg1Routes}
          leg2Routes={leg2Routes}
          bridgeProtocol={bridgeProtocol}
          bridgeFeePercent={bridgeFeePercent}
        />
      </Wrapper>
    )
  }


  // Same-chain: render normal pool routes
  return (
    <Wrapper>
      {routes.map((entry, index) => (
        <RouteContainerRow key={index}>
          <CurrencyLogo currency={currencyIn} size={20} />
          <Route entry={entry} />
          <CurrencyLogo currency={currencyOut} size={20} />
        </RouteContainerRow>
      ))}
    </Wrapper>
  )
}

function Route({ entry: { percent, path, protocol } }: { entry: RoutingDiagramEntry }) {
  return (
    <RouteRow>
      <DottedLine>
        <DotColor />
      </DottedLine>
      <OpaqueBadge>
        {protocol === Protocol.MIXED ? (
          <MixedProtocolBadge>
            <BadgeText>V3 + V2</BadgeText>
          </MixedProtocolBadge>
        ) : (
          <ProtocolBadge>
            <BadgeText color="neutral1">{protocol.toUpperCase()}</BadgeText>
          </ProtocolBadge>
        )}
        <BadgeText style={{ minWidth: 'auto' }}>{percent.toSignificant(2)}%</BadgeText>
      </OpaqueBadge>
      <AutoRow gap="1px" width="100%" style={{ justifyContent: 'space-evenly', zIndex: 2 }}>
        {path.map(([currency0, currency1, feeAmount], index) => (
          <Pool key={index} currency0={currency0} currency1={currency1} feeAmount={feeAmount} />
        ))}
      </AutoRow>
    </RouteRow>
  )
}
