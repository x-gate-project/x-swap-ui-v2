import { xswapOrderStatusLabel, xswapOrderStatusTone } from 'components/swap/XSwap/XSwapOrderTracker'
import {
  Badge,
  Card,
  ErrorText,
  Label,
  Muted,
  Row,
  formatXSwapTokenAmount,
  useXSwapChainName,
  useXSwapNativeSymbol,
} from 'components/swap/XSwap/shared'
import { t } from 'i18n'
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'react-feather'
import { useXSwapOrderHistory, useXSwapTokenLookup } from 'state/xswap/hooks'
import { XSwapOrder } from 'state/xswap/types'
import styled, { useTheme } from 'styled-components'

const Header = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
`

const OrderRow = styled.button`
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 12px;
  background: none;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.surface2};
  }
`

const LoadMore = styled.button`
  padding: 8px;
  border: none;
  background: none;
  color: ${({ theme }) => theme.accent1};
  font-size: 14px;
  cursor: pointer;
`

/** The wallet's cross-chain orders (`GET /v1/orders?wallet=`), newest first; a row opens its tracker. */
export function XSwapOrderHistory({ wallet, onOpen }: { wallet: string; onOpen: (order: XSwapOrder) => void }) {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const history = useXSwapOrderHistory(wallet)
  const orders = useMemo(() => history.data?.pages.flatMap((page) => page.orders) ?? [], [history.data])
  const chainIds = useMemo(() => orders.flatMap((o) => [o.tokenIn.chainId, o.tokenOut.chainId]), [orders])
  const lookup = useXSwapTokenLookup(chainIds)
  const chainName = useXSwapChainName()
  const nativeSymbol = useXSwapNativeSymbol()

  if (!history.isLoading && orders.length === 0 && !history.error) {
    return null
  }

  return (
    <Card data-testid="xswap-order-history">
      <Header type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Label>{t('xswap.history.title')}</Label>
        {open ? <ChevronUp size={18} color={theme.neutral2} /> : <ChevronDown size={18} color={theme.neutral2} />}
      </Header>
      {open && (
        <>
          {history.error && <ErrorText>{t('xswap.history.error')}</ErrorText>}
          {orders.map((order) => (
            <OrderRow key={order.id} type="button" onClick={() => onOpen(order)}>
              <Row>
                <Label>
                  {formatXSwapTokenAmount(
                    lookup,
                    nativeSymbol,
                    order.tokenIn.chainId,
                    order.tokenIn.address,
                    order.tokenIn.amount,
                  )}{' '}
                  → {lookup(order.tokenOut.chainId, order.tokenOut.address)?.symbol ?? '?'}
                </Label>
                <Badge $tone={xswapOrderStatusTone(order)}>{xswapOrderStatusLabel(order.status)}</Badge>
              </Row>
              <Muted>
                {chainName(order.tokenIn.chainId)} → {chainName(order.tokenOut.chainId)} ·{' '}
                {new Date(order.createdAt).toLocaleString()}
              </Muted>
            </OrderRow>
          ))}
          {history.hasNextPage && (
            <LoadMore type="button" onClick={() => history.fetchNextPage()} disabled={history.isFetchingNextPage}>
              {t('xswap.history.loadMore')}
            </LoadMore>
          )}
        </>
      )}
    </Card>
  )
}
