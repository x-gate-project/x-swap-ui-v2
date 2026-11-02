import {
  Badge,
  Label,
  Muted,
  Row,
  formatXSwapTokenAmount,
  useNow,
  useXSwapChainName,
  useXSwapNativeSymbol,
} from 'components/swap/XSwap/shared'
import { t } from 'i18n'
import { XSwapTokenLookup } from 'state/xswap/hooks'
import { XSwapLeg, XSwapQuote } from 'state/xswap/types'
import { formatXSwapEta, formatXSwapUnits } from 'state/xswap/utils'
import styled from 'styled-components'

const RouteButton = styled.button<{ $selected: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  padding: 12px;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  border: 1px solid ${({ theme, $selected }) => ($selected ? theme.accent1 : theme.surface3)};
  background: ${({ theme, $selected }) => ($selected ? theme.surface2 : theme.surface1)};
  color: ${({ theme }) => theme.neutral1};

  &:disabled {
    cursor: default;
  }
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Details = styled.dl`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 12px;
  line-height: 16px;

  dt {
    color: ${({ theme }) => theme.neutral2};
  }
  dd {
    margin: 0;
    text-align: right;
    color: ${({ theme }) => theme.neutral1};
    overflow-wrap: anywhere;
  }
`

const Legs = styled.ol`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 16px;
  color: ${({ theme }) => theme.neutral1};
`

const PROVIDER_NAMES: Record<string, string> = {
  across: 'Across',
  relay: 'Relay',
  xgate: 'X-Gate',
  xswap: 'X-Swap',
  uniswap: 'Uniswap',
}

export function xswapProviderName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? provider
}

/** `best` first, then the other candidates (the API ranks them best first and may repeat `best` among them). */
export function xswapRoutes(best: XSwapQuote, candidates: XSwapQuote[]): XSwapQuote[] {
  return [best, ...candidates.filter((q) => q.quoteId !== best.quoteId)]
}

type FormatAmount = (chainId: number, address: string, amount: string) => string

function useFormatAmount(lookup: XSwapTokenLookup): FormatAmount {
  const nativeSymbol = useXSwapNativeSymbol()
  return (chainId, address, amount) => formatXSwapTokenAmount(lookup, nativeSymbol, chainId, address, amount)
}

function LegRow({ leg, formatAmount }: { leg: XSwapLeg; formatAmount: FormatAmount }) {
  const chainName = useXSwapChainName()
  if (leg.type === 'swap') {
    return (
      <li>
        {t('xswap.route.leg.swap', {
          amountIn: formatAmount(leg.chainId, leg.tokenIn, leg.amountIn),
          amountOut: formatAmount(leg.chainId, leg.tokenOut, leg.expectedOut),
          chain: chainName(leg.chainId),
        })}
        <br />
        <Muted>
          {t('xswap.route.leg.min', { amount: formatAmount(leg.chainId, leg.tokenOut, leg.minOut) })} · {leg.venue}
        </Muted>
      </li>
    )
  }
  return (
    <li>
      {t('xswap.route.leg.bridge', {
        from: chainName(leg.tokenInChainId),
        to: chainName(leg.tokenOutChainId),
        amountOut: formatAmount(leg.tokenOutChainId, leg.tokenOut, leg.expectedOut),
        provider: xswapProviderName(leg.provider),
      })}
      <br />
      <Muted>{t('xswap.route.leg.min', { amount: formatAmount(leg.tokenOutChainId, leg.tokenOut, leg.minOut) })}</Muted>
    </li>
  )
}

/**
 * The selected route in full: expected and minimum output, fees, ETA, expiry and its legs. Bridge fees (`lp`, `relayer`,
 * `app`) are in the bridge leg's input token; `gas` is the source chain's native token, paid on top of the input
 * (e.g. X-Gate's LayerZero fee).
 */
function RouteDetails({ quote, lookup, now }: { quote: XSwapQuote; lookup: XSwapTokenLookup; now: number }) {
  const formatAmount = useFormatAmount(lookup)
  const nativeSymbol = useXSwapNativeSymbol()
  const bridge = quote.legs?.find((leg): leg is Extract<XSwapLeg, { type: 'bridge' }> => leg.type === 'bridge')
  const feeToken = bridge ? lookup(bridge.tokenInChainId, bridge.tokenIn) : undefined
  const formatFee = (amount: string) =>
    feeToken ? `${formatXSwapUnits(amount, feeToken.decimals)} ${feeToken.symbol}` : amount
  const bridgeFees = (['lp', 'relayer', 'app'] as const).filter((key) => quote.fees[key] !== '0')
  const secondsLeft = Math.max(0, Math.floor((quote.expiresAt - now) / 1000))
  const { tokenOut } = quote

  return (
    <>
      <Details>
        <dt>{t('xswap.route.expectedOut')}</dt>
        <dd>{formatAmount(tokenOut.chainId, tokenOut.address, quote.outputAmount)}</dd>
        <dt>{t('xswap.route.minOut')}</dt>
        <dd>{formatAmount(tokenOut.chainId, tokenOut.address, quote.minOutputAmount)}</dd>
        {bridgeFees.map((key) => (
          <FeeRow key={key} label={feeLabel(key)} value={formatFee(quote.fees[key])} />
        ))}
        {quote.fees.gas !== '0' && (
          <FeeRow
            label={t('xswap.route.fee.gas')}
            value={`${formatXSwapUnits(quote.fees.gas, 18)} ${nativeSymbol(quote.tokenIn.chainId)}`}
          />
        )}
        <dt>{t('xswap.route.eta')}</dt>
        <dd>{formatXSwapEta(quote.etaSec)}</dd>
        <dt>{t('xswap.route.expires')}</dt>
        <dd>{secondsLeft > 0 ? t('xswap.route.expiresIn', { seconds: secondsLeft }) : t('xswap.route.expired')}</dd>
        {quote.fallbackToken && (
          <>
            <dt>{t('xswap.route.fallback')}</dt>
            <dd>{lookup(tokenOut.chainId, quote.fallbackToken)?.symbol ?? quote.fallbackToken}</dd>
          </>
        )}
      </Details>
      {quote.legs && quote.legs.length > 0 && (
        <Legs data-testid="xswap-route-legs">
          {quote.legs.map((leg, i) => (
            <LegRow key={i} leg={leg} formatAmount={formatAmount} />
          ))}
        </Legs>
      )}
    </>
  )
}

function feeLabel(key: 'lp' | 'relayer' | 'app'): string {
  switch (key) {
    case 'lp':
      return t('xswap.route.fee.lp')
    case 'relayer':
      return t('xswap.route.fee.relayer')
    case 'app':
      return t('xswap.route.fee.app')
  }
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

/** Every route the API returned; the selected one (default `best`) shows its details. */
export function XSwapQuoteRoutes({
  routes,
  bestQuoteId,
  selectedQuoteId,
  onSelect,
  lookup,
  disabled,
}: {
  routes: XSwapQuote[]
  bestQuoteId: string
  selectedQuoteId: string
  onSelect: (quote: XSwapQuote) => void
  lookup: XSwapTokenLookup
  disabled?: boolean
}) {
  const now = useNow()
  const formatAmount = useFormatAmount(lookup)
  return (
    <List data-testid="xswap-routes">
      {routes.map((quote) => {
        const selected = quote.quoteId === selectedQuoteId
        return (
          <RouteButton
            key={quote.quoteId}
            type="button"
            $selected={selected}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(quote)}
            data-testid={`xswap-route-${quote.provider}`}
          >
            <Row>
              <Row style={{ justifyContent: 'flex-start' }}>
                <Label>{xswapProviderName(quote.provider)}</Label>
                {quote.quoteId === bestQuoteId && <Badge $tone="accent">{t('xswap.route.best')}</Badge>}
                {!quote.executable && <Badge>{t('xswap.route.quoteOnly')}</Badge>}
              </Row>
              <Muted>{formatXSwapEta(quote.etaSec)}</Muted>
            </Row>
            <Label>{formatAmount(quote.tokenOut.chainId, quote.tokenOut.address, quote.outputAmount)}</Label>
            {selected && <RouteDetails quote={quote} lookup={lookup} now={now} />}
          </RouteButton>
        )
      })}
    </List>
  )
}
