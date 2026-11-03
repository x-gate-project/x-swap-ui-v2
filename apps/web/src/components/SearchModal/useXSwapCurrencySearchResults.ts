import { Currency } from '@uniswap/sdk-core'
import { CurrencyListRow, CurrencyListSectionTitle } from 'components/SearchModal/CurrencyList'
import { useTokenBalances } from 'hooks/useTokenBalances'
import { t } from 'i18n'
import { useMemo } from 'react'
import { useSwapAndLimitContext } from 'state/swap/hooks'
import { XSwapTokenEntry, useXSwapTokenCurrencies } from 'state/xswap/hooks'
import { isSameXSwapToken } from 'state/xswap/utils'
import { InterfaceChainId } from 'uniswap/src/types/chains'
import { currencyKey } from 'utils/currencyKey'

interface XSwapCurrencySearchParams {
  /** Chain to list; defaults to the swap form's chain. */
  chainId?: number
  searchQuery?: string
  otherSelectedCurrency?: Currency | null
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
 * other side cannot be picked again.
 */
export function useXSwapCurrencySearchResults({
  chainId: chainIdParam,
  searchQuery,
  otherSelectedCurrency,
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
    const sorted = entries
      .filter((entry) => matchesQuery(entry, searchQuery ?? ''))
      .sort((a, b) => {
        // Available tokens first, then by balance, then by symbol.
        if (a.token.available !== b.token.available) {
          return a.token.available ? -1 : 1
        }
        const byBalance = usdValue(b.currency) - usdValue(a.currency)
        return byBalance !== 0 ? byBalance : a.token.symbol.localeCompare(b.token.symbol)
      })

    if (sorted.length === 0) {
      return []
    }

    return [
      new CurrencyListSectionTitle(searchQuery ? t('common.searchResults') : t('xswap.tokenSelector.title')),
      ...sorted.map(({ token, currency }) => {
        const isOtherSide = isSameXSwapToken(currency, otherSelectedCurrency)
        return new CurrencyListRow(currency, {
          disabled: !token.available || isOtherSide,
          tooltip: !token.available
            ? t('xswap.tokenSelector.unavailable')
            : isOtherSide
              ? t('xswap.tokenSelector.alreadySelected')
              : undefined,
          showAddress: !!searchQuery,
        })
      }),
    ]
  }, [balanceMap, entries, otherSelectedCurrency, searchQuery])

  return { allCurrencyRows, loading }
}
