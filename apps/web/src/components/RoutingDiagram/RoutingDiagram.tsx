import { Protocol } from '@uniswap/router-sdk'
import { Currency, Percent } from '@uniswap/sdk-core'

import { FeeAmount } from '@uniswap/v3-sdk'
import { ReactComponent as DotLine } from 'assets/svg/dot_line.svg'
import Badge from 'components/Badge'
import { DoubleCurrencyLogo } from 'components/DoubleLogo'
import CurrencyLogo from 'components/Logo/CurrencyLogo'
import Row, { AutoRow } from 'components/Row'
import { MouseoverTooltip, TooltipSize } from 'components/Tooltip'
import { BIPS_BASE } from 'constants/misc'
import { Trans } from 'i18n'
import type { BridgeDisplay } from 'lib/crossChain/bridge'
import { BRIDGE_DISPLAYS } from 'lib/crossChain/aggregator'
import type { RouteHop } from 'lib/crossChain/aggregator/types'
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

/** Bridge leg: reuses the same icon-row layout, showing the bridge adapter's logo (or a text badge fallback). */
function BridgeLegRow({
  left,
  right,
  bridgeProvider,
  bridgeFeePercent,
}: {
  left: Currency
  right: Currency
  bridgeProvider?: BridgeDisplay
  /** Relayer fee % for this bridge leg — shown under the icon */
  bridgeFeePercent?: Percent
}) {
  const name = bridgeProvider?.name
  const feeLabel = bridgeFeePercent && !bridgeFeePercent.equalTo(0) ? `${bridgeFeePercent.toSignificant(2)}%` : undefined
  const tooltipText = name && feeLabel ? `${name} — ${feeLabel}` : name ?? 'Bridge protocol pending'

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
                {bridgeProvider ? (
                  <BridgeProtocolIcon src={bridgeProvider.logoUrl} alt={name} />
                ) : (
                  <SplitProtocolIcon>
                    {/* ponytail: split icon has 2 halves - shows the first 2 providers only. */}
                    {BRIDGE_DISPLAYS.map((p, i) => (
                      <SplitIconHalf key={p.name} side={i === 0 ? 'left' : 'right'} src={p.logoUrl} alt="" />
                    ))}
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



function BridgeRoute({ hops }: { hops: RouteHop[] }) {
  return (
    <BridgeRouteRow>
      {hops.map((hop, i) =>
        hop.kind === 'swap' && hop.pools?.length ? (
          hop.pools.map((entry, j) => (
            <RouteContainerRow key={`${i}-${j}`}>
              <CurrencyLogo currency={hop.tokenIn} size={20} />
              <Route entry={entry} />
              <CurrencyLogo currency={hop.tokenOut} size={20} />
            </RouteContainerRow>
          ))
        ) : (
          <BridgeLegRow
            key={i}
            left={hop.tokenIn}
            right={hop.tokenOut}
            bridgeProvider={hop.provider}
            bridgeFeePercent={hop.feePercent}
          />
        ),
      )}
    </BridgeRouteRow>
  )
}


// ── Main export ───────────────────────────────────────────────────────────────

export default function RoutingDiagram({
  currencyIn,
  currencyOut,
  routes,
  crossChainHops,
}: {
  currencyIn: Currency
  currencyOut: Currency
  routes: RoutingDiagramEntry[]
  /** Cross-chain: ordered hops from the aggregator quote; replaces `routes`. */
  crossChainHops?: RouteHop[]
}) {
  if (crossChainHops) {
    return (
      <Wrapper>
        <BridgeRoute hops={crossChainHops} />
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
