import { xswapProviderName } from 'components/swap/XSwap/XSwapQuoteRoutes'
import {
  Badge,
  Card,
  Label,
  Muted,
  Row,
  TxLink,
  formatXSwapTokenAmount,
  useXSwapChainName,
  useXSwapNativeSymbol,
} from 'components/swap/XSwap/shared'
import { t } from 'i18n'
import { X } from 'react-feather'
import { isXSwapOrderTerminal, useXSwapOrder, useXSwapTokenLookup } from 'state/xswap/hooks'
import { XSwapOrder, XSwapOrderStatus } from 'state/xswap/types'
import styled, { useTheme } from 'styled-components'

const Timeline = styled.ol`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Dot = styled.span<{ $state: 'done' | 'active' | 'error' | 'pending' }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ theme, $state }) =>
    $state === 'done'
      ? theme.success
      : $state === 'error'
        ? theme.critical
        : $state === 'active'
          ? theme.accent1
          : theme.surface3};
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
    overflow-wrap: anywhere;
  }
`

const CloseButton = styled.button`
  display: flex;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
`

function xswapOrderStatusLabel(status: XSwapOrderStatus): string {
  switch (status) {
    case 'SUBMITTED':
      return t('xswap.order.status.submitted')
    case 'DEPOSITED':
      return t('xswap.order.status.deposited')
    case 'FILLED':
      return t('xswap.order.status.filled')
    case 'FILLED_FALLBACK':
      return t('xswap.order.status.filledFallback')
    case 'FAILED_ORIGIN':
      return t('xswap.order.status.failedOrigin')
    case 'EXPIRED':
      return t('xswap.order.status.expired')
    case 'REFUNDED':
      return t('xswap.order.status.refunded')
  }
}

function xswapOrderStatusTone(order: XSwapOrder): 'success' | 'critical' | 'accent' | 'neutral' {
  if (order.state === 'success') {
    return 'success'
  }
  if (order.state === 'failed' || order.stuck) {
    return 'critical'
  }
  return order.state === 'pending' ? 'accent' : 'neutral'
}

/** The statuses an order goes through to reach its current one. */
function timeline(status: XSwapOrderStatus): XSwapOrderStatus[] {
  switch (status) {
    case 'FAILED_ORIGIN':
      return ['SUBMITTED', 'FAILED_ORIGIN']
    case 'FILLED_FALLBACK':
      return ['SUBMITTED', 'DEPOSITED', 'FILLED_FALLBACK']
    case 'EXPIRED':
    case 'REFUNDED':
      return ['SUBMITTED', 'DEPOSITED', 'EXPIRED', 'REFUNDED']
    default:
      return ['SUBMITTED', 'DEPOSITED', 'FILLED']
  }
}

/** Live status of one order: `GET /v1/orders/:id` every few seconds until it is terminal. */
export function XSwapOrderTracker({ order: initial, onClose }: { order: XSwapOrder; onClose: () => void }) {
  const theme = useTheme()
  const { data } = useXSwapOrder(initial.id, initial)
  const order = data ?? initial
  const terminal = isXSwapOrderTerminal(order)
  const lookup = useXSwapTokenLookup([order.tokenIn.chainId, order.tokenOut.chainId])
  const chainName = useXSwapChainName()
  const nativeSymbol = useXSwapNativeSymbol()
  const out = (amount: string) =>
    formatXSwapTokenAmount(lookup, nativeSymbol, order.tokenOut.chainId, order.tokenOut.address, amount)

  const path = timeline(order.status)
  const at = path.indexOf(order.status)

  return (
    <Card data-testid="xswap-order-tracker">
      <Row>
        <Row style={{ justifyContent: 'flex-start' }}>
          <Label>{t('xswap.order.title')}</Label>
          <Badge $tone={xswapOrderStatusTone(order)}>{xswapOrderStatusLabel(order.status)}</Badge>
          {!terminal && <Muted>{t('xswap.order.live')}</Muted>}
        </Row>
        <CloseButton type="button" onClick={onClose} aria-label={t('common.close')}>
          <X size={18} color={theme.neutral2} />
        </CloseButton>
      </Row>
      <Muted>
        {formatXSwapTokenAmount(
          lookup,
          nativeSymbol,
          order.tokenIn.chainId,
          order.tokenIn.address,
          order.tokenIn.amount,
        )}{' '}
        ({chainName(order.tokenIn.chainId)}) → {lookup(order.tokenOut.chainId, order.tokenOut.address)?.symbol ?? ''} (
        {chainName(order.tokenOut.chainId)}) · {xswapProviderName(order.provider)}
      </Muted>

      {order.stuck && <Muted style={{ color: theme.critical }}>{t('xswap.order.stuck')}</Muted>}

      <Timeline>
        {path.map((status, i) => {
          const state =
            i < at || (i === at && terminal)
              ? order.state === 'failed' && i === at
                ? 'error'
                : 'done'
              : i === at
                ? 'active'
                : 'pending'
          return (
            <li key={status}>
              <Row style={{ justifyContent: 'flex-start' }}>
                <Dot $state={state} />
                <Label style={{ color: state === 'pending' ? theme.neutral3 : undefined }}>
                  {xswapOrderStatusLabel(status)}
                </Label>
              </Row>
            </li>
          )
        })}
      </Timeline>

      <Details>
        <dt>{t('xswap.route.expectedOut')}</dt>
        <dd>{out(order.outputAmount)}</dd>
        <dt>{t('xswap.route.minOut')}</dt>
        <dd>{out(order.minOutputAmount)}</dd>
        {order.actualOutputAmount && (
          <>
            <dt>{t('xswap.order.received')}</dt>
            <dd>
              {order.status === 'FILLED_FALLBACK' && order.fallbackToken
                ? formatXSwapTokenAmount(
                    lookup,
                    nativeSymbol,
                    order.tokenOut.chainId,
                    order.fallbackToken,
                    order.actualOutputAmount,
                  )
                : out(order.actualOutputAmount)}
            </dd>
          </>
        )}
        <dt>{t('xswap.order.originTx')}</dt>
        <dd>
          <TxLink chainId={order.tokenIn.chainId} hash={order.originTxHash} />
        </dd>
        {order.fillTxHash && (
          <>
            <dt>{t('xswap.order.fillTx')}</dt>
            <dd>
              <TxLink chainId={order.tokenOut.chainId} hash={order.fillTxHash} />
            </dd>
          </>
        )}
        {order.refundTxHash && (
          <>
            <dt>{t('xswap.order.refundTx')}</dt>
            <dd>
              <TxLink chainId={order.tokenIn.chainId} hash={order.refundTxHash} />
            </dd>
          </>
        )}
      </Details>
    </Card>
  )
}
