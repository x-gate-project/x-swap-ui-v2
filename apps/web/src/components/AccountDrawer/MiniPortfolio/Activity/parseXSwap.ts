import { Activity, ActivityMap } from 'components/AccountDrawer/MiniPortfolio/Activity/types'
import { formatXSwapTokenAmount, useXSwapChainName, useXSwapNativeSymbol } from 'components/swap/XSwap/shared'
import { t } from 'i18n'
import { useMemo } from 'react'
import { useXSwapChains, useXSwapOrderHistory, useXSwapTokenLookup } from 'state/xswap/hooks'
import { XSwapOrder } from 'state/xswap/types'
import { xswapTokenToCurrency } from 'state/xswap/utils'
import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { InterfaceChainId } from 'uniswap/src/types/chains'

function orderStatus(order: XSwapOrder): TransactionStatus {
  switch (order.state) {
    case 'pending':
      return TransactionStatus.Pending
    case 'success':
      return TransactionStatus.Confirmed
    default:
      // `failed` and `refunded`: the swap did not happen.
      return TransactionStatus.Failed
  }
}

const ORDER_TITLES: Record<'local' | 'crossChain', Record<XSwapOrder['state'], () => string>> = {
  local: {
    pending: () => t('xswap.activity.local.pending'),
    success: () => t('xswap.activity.local.success'),
    failed: () => t('xswap.activity.local.failed'),
    // A same-chain swap is one tx, so nothing is held to refund; show it as failed if the API ever says so.
    refunded: () => t('xswap.activity.local.failed'),
  },
  crossChain: {
    pending: () => t('xswap.activity.pending'),
    success: () => t('xswap.activity.success'),
    failed: () => t('xswap.activity.failed'),
    refunded: () => t('xswap.activity.refunded'),
  },
}

function orderTitle(order: XSwapOrder): string {
  return ORDER_TITLES[order.routeClass === 'local' ? 'local' : 'crossChain'][order.state]()
}

/**
 * The wallet's x-swap orders (`GET /v1/orders?wallet=`), cross-chain and same-chain, as activities, keyed by their
 * origin (deposit) tx hash so they replace the plain tx row of the same deposit.
 */
export function useXSwapActivities(account: string): { activities: ActivityMap; loading: boolean } {
  const history = useXSwapOrderHistory(account)
  const orders = useMemo(() => history.data?.pages.flatMap((page) => page.orders) ?? [], [history.data])
  const chainIds = useMemo(() => orders.flatMap((o) => [o.tokenIn.chainId, o.tokenOut.chainId]), [orders])
  const lookup = useXSwapTokenLookup(chainIds)
  const { chains } = useXSwapChains()
  const chainName = useXSwapChainName()
  const nativeSymbol = useXSwapNativeSymbol()

  const activities = useMemo(() => {
    const wrappedNative = (chainId: number) => chains.find((c) => c.chainId === chainId)?.wrappedNative
    const currency = (chainId: number, address: string) => {
      const token = lookup(chainId, address)
      return token ? xswapTokenToCurrency(token, wrappedNative(chainId)) : undefined
    }
    return orders.reduce<ActivityMap>((map, order) => {
      const { tokenIn, tokenOut } = order
      const outAddress =
        order.status === 'FILLED_FALLBACK' && order.fallbackToken ? order.fallbackToken : tokenOut.address
      const amountIn = formatXSwapTokenAmount(lookup, nativeSymbol, tokenIn.chainId, tokenIn.address, tokenIn.amount)
      const amountOut = formatXSwapTokenAmount(
        lookup,
        nativeSymbol,
        tokenOut.chainId,
        outAddress,
        order.actualOutputAmount ?? order.outputAmount,
      )
      map[order.originTxHash] = {
        hash: order.originTxHash,
        chainId: tokenIn.chainId as InterfaceChainId,
        status: orderStatus(order),
        timestamp: Math.floor(Date.parse(order.createdAt) / 1000),
        title: orderTitle(order),
        descriptor:
          order.routeClass === 'local'
            ? t('xswap.activity.local.descriptor', { amountIn, amountOut, chain: chainName(tokenIn.chainId) })
            : t('xswap.activity.descriptor', {
                amountIn,
                chainIn: chainName(tokenIn.chainId),
                amountOut,
                chainOut: chainName(tokenOut.chainId),
              }),
        currencies: [currency(tokenIn.chainId, tokenIn.address), currency(tokenOut.chainId, tokenOut.address)],
        from: order.swapper,
        xswapOrder: order,
      } satisfies Activity
      return map
    }, {})
  }, [chainName, chains, lookup, nativeSymbol, orders])

  return { activities, loading: history.isLoading }
}
