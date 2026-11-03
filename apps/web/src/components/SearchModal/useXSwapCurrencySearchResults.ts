import { Currency } from '@uniswap/sdk-core'
import { CurrencyListRow, CurrencyListSectionTitle } from 'components/SearchModal/CurrencyList'
import { useTokenBalances } from 'hooks/useTokenBalances'
import { t } from 'i18n'
import { useMemo } from 'react'
import { useSwapAndLimitContext } from 'state/swap/hooks'
import { XSwapTokenEntry, useXSwapTokenCurrencies } from 'state/xswap/hooks'
import {
  XSwapDestinationStatus,
  XSwapReachability,
  getXSwapDestinationStatus,
  isSameXSwapToken,
} from 'state/xswap/utils'
import { InterfaceChainId } from 'uniswap/src/types/chains'
import { currencyKey } from 'utils/currencyKey'

interface XSwapCurrencySearchParams {
  /** Chain to list; defaults to the swap form's chain. */
  chainId?: number
  searchQuery?: string
  otherSelectedCurrency?: Currency | null
  /** Output side: tokens the input can reach (`GET /v1/routes`). Undefined lists every token. */
  reachability?: XSwapReachability
  enabled?: boolean
}

function matchesQuery(entry: XSwapTokenEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) {
    return true
  }
  const { token, currency } = entry
  return (
    token.address.toLowerCase() === q ||
    token.symbol.toLowerCase().includes(q) ||
    Boolean(currency.name?.toLowerCase().includes(q))
  )
}

/**
 * Token selector rows for the swap form, sourced from `GET /v1/tokens` instead of the token lists: a token the API
 * does not list is not shown, a token with `available: false` is greyed out, and the token already picked on the
 * other side cannot be picked again. With `reachability`, a token the input cannot reach is not shown and one only
 * quote-only routes reach is tagged "Quote only".
 */
export function useXSwapCurrencySearchResults({
  chainId: chainIdParam,
  searchQuery,
  otherSelectedCurrency,
  reachability,
  enabled = true,
}: XSwapCurrencySearchParams): {
  allCurrencyRows: CurrencyListRow[]
  loading: boolean
} {
  const { chainId: swapChainId } = useSwapAndLimitContext()
  const chainId = (chainIdParam ?? swapChainId) as InterfaceChainId | undefined
  const { entries, loading } = useXSwapTokenCurrencies(chainId, { enabled })
  const { balanceMap } = useTokenBalances()

  const allCurrencyRows = useMemo(() => {
    const usdValue = (currency: Currency) => balanceMap[currencyKey(currency)]?.usdValue ?? 0
    const status = (entry: XSwapTokenEntry): XSwapDestinationStatus =>
      reachability ? getXSwapDestinationStatus(reachability, entry.currency) : 'executable'
    const sorted = entries
      .filter((entry) => status(entry) !== 'unreachable' && matchesQuery(entry, searchQuery ?? ''))
      .map((entry) => ({ ...entry, quoteOnly: status(entry) === 'quote-only' }))
      .sort((a, b) => {
        // Available tokens first, then executable before quote-only, then by balance, then by symbol.
        if (a.token.available !== b.token.available) {
          return a.token.available ? -1 : 1
        }
        if (a.quoteOnly !== b.quoteOnly) {
          return a.quoteOnly ? 1 : -1
        }
        const byBalance = usdValue(b.currency) - usdValue(a.currency)
        return byBalance !== 0 ? byBalance : a.token.symbol.localeCompare(b.token.symbol)
      })

    if (sorted.length === 0) {
      return []
    }

    return [
      new CurrencyListSectionTitle(searchQuery ? t('common.searchResults') : t('xswap.tokenSelector.title')),
      ...sorted.map(({ token, currency, quoteOnly }) => {
        const isOtherSide = isSameXSwapToken(currency, otherSelectedCurrency)
        return new CurrencyListRow(currency, {
          disabled: !token.available || isOtherSide,
          tooltip: !token.available
            ? t('xswap.tokenSelector.unavailable')
            : isOtherSide
              ? t('xswap.tokenSelector.alreadySelected')
              : quoteOnly
                ? t('xswap.tokenSelector.quoteOnlyTooltip')
                : undefined,
          showAddress: !!searchQuery,
          tag: quoteOnly && token.available ? t('xswap.tokenSelector.quoteOnly') : undefined,
        })
      }),
    ]
  }, [balanceMap, entries, otherSelectedCurrency, reachability, searchQuery])

  return { allCurrencyRows, loading }
}
