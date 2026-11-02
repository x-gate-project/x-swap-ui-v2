import { InterfaceEventName, InterfaceModalName } from '@uniswap/analytics-events'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import Column from 'components/Column'
import { ChainSelector } from 'components/NavBar/ChainSelector'
import Row, { RowBetween } from 'components/Row'
import CommonBases from 'components/SearchModal/CommonBases'
import CurrencyList, { CurrencyRow, formatAnalyticsEventProperties } from 'components/SearchModal/CurrencyList'
import { PaddedColumn, SearchInput, Separator } from 'components/SearchModal/styled'
import { useCurrencySearchResults } from 'components/SearchModal/useCurrencySearchResults'
import { useXSwapCurrencySearchResults } from 'components/SearchModal/useXSwapCurrencySearchResults'
import useDebounce from 'hooks/useDebounce'
import { useOnClickOutside } from 'hooks/useOnClickOutside'
import useSelectChain from 'hooks/useSelectChain'
import useToggle from 'hooks/useToggle'
import { useTokenBalances } from 'hooks/useTokenBalances'
import { Trans, t } from 'i18n'
import useNativeCurrency from 'lib/hooks/useNativeCurrency'
import tryParseCurrencyAmount from 'lib/utils/tryParseCurrencyAmount'
import { ChangeEvent, KeyboardEvent, RefObject, useCallback, useEffect, useRef, useState } from 'react'
import AutoSizer from 'react-virtualized-auto-sizer'
import { FixedSizeList } from 'react-window'
import { Text } from 'rebass'
import { useSwapAndLimitContext } from 'state/swap/hooks'
import { isXSwapApiEnabled } from 'state/xswap/client'
import { useXSwapChains } from 'state/xswap/hooks'
import styled, { useTheme } from 'styled-components'
import { CloseIcon, ThemedText } from 'theme/components'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { isAddress } from 'utilities/src/addresses'
import { currencyKey } from 'utils/currencyKey'

const ContentWrapper = styled(Column)`
  background-color: ${({ theme }) => theme.surface1};
  width: 100%;
  overflow: hidden;
  flex: 1 1;
  position: relative;
  border-radius: 20px;
`

const ChainSelectorWrapper = styled.div`
  background-color: ${({ theme }) => theme.surface2};
  border-radius: 12px;
`

export interface CurrencySearchFilters {
  showCommonBases?: boolean
  disableNonToken?: boolean
  onlyShowCurrenciesWithBalance?: boolean
  /** Source tokens and chains from the x-swap API (swap form only); ignored when the API is not configured. */
  xswapApiTokens?: boolean
}

const DEFAULT_CURRENCY_SEARCH_FILTERS: CurrencySearchFilters = {
  showCommonBases: true,
  disableNonToken: false,
  onlyShowCurrenciesWithBalance: false,
  xswapApiTokens: false,
}

interface CurrencySearchProps {
  isOpen: boolean
  onDismiss: () => void
  selectedCurrency?: Currency | null
  onCurrencySelect: (currency: Currency, hasWarning?: boolean) => void
  otherSelectedCurrency?: Currency | null
  showCurrencyAmount?: boolean
  filters?: CurrencySearchFilters
}

export function CurrencySearch({
  selectedCurrency,
  onCurrencySelect,
  otherSelectedCurrency,
  showCurrencyAmount,
  onDismiss,
  isOpen,
  filters,
}: CurrencySearchProps) {
  const { showCommonBases: showCommonBasesFilter, xswapApiTokens: xswapApiTokensFilter } = {
    ...DEFAULT_CURRENCY_SEARCH_FILTERS,
    ...filters,
  }
  const xswapApiTokens = Boolean(xswapApiTokensFilter) && isXSwapApiEnabled()
  // Common bases come from local config and may not be listed by the API.
  const showCommonBases = showCommonBasesFilter && !xswapApiTokens
  const { chainId } = useSwapAndLimitContext()

  const theme = useTheme()

  // refs for fixed size lists
  const fixedList = useRef<FixedSizeList>()

  const [searchQuery, setSearchQuery] = useState<string>('')
  const debouncedQuery = useDebounce(searchQuery, 200)
  const isAddressSearch = isAddress(debouncedQuery)

  const legacySearchResults = useCurrencySearchResults({
    searchQuery: debouncedQuery,
    filters,
    selectedCurrency,
    otherSelectedCurrency,
    skip: xswapApiTokens,
  })
  const xswapSearchResults = useXSwapCurrencySearchResults({
    searchQuery: debouncedQuery,
    otherSelectedCurrency,
    enabled: xswapApiTokens,
  })
  const { chainIds: xswapChainIds } = useXSwapChains({ enabled: xswapApiTokens })
  const xswapChainUnavailable = xswapApiTokens && !!chainId && !!xswapChainIds && !xswapChainIds.includes(chainId)

  // The API list is searched by symbol and address already; a pasted address is not imported.
  const searchCurrency = xswapApiTokens ? undefined : legacySearchResults.searchCurrency
  const { allCurrencyRows, loading: currencySearchResultsLoading } = xswapApiTokens
    ? xswapSearchResults
    : legacySearchResults

  const { balanceMap } = useTokenBalances()

  const native = useNativeCurrency(chainId)

  const selectChain = useSelectChain()
  const handleCurrencySelect = useCallback(
    async (currency: Currency, hasWarning?: boolean) => {
      if (currency.chainId !== chainId) {
        const result = await selectChain(currency.chainId)
        if (!result) {
          // failed to switch chains, don't select the currency
          return
        }
      }
      onCurrencySelect(currency, hasWarning)
      if (!hasWarning) {
        onDismiss()
      }
    },
    [chainId, onCurrencySelect, onDismiss, selectChain],
  )

  // clear the input on open
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
    }
  }, [isOpen])

  // manage focus on modal show
  const inputRef = useRef<HTMLInputElement>()
  const handleInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value
    const checksummedInput = isAddress(input)
    setSearchQuery(checksummedInput || input)
    fixedList.current?.scrollTo(0)
  }, [])

  // Allows the user to select a currency by pressing Enter if it's the only currency in the list.
  const handleEnter = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const currencyResults = allCurrencyRows.filter(
          (currencyRow) => !!currencyRow.currency && !currencyRow.options?.disabled,
        )
        const s = debouncedQuery.toLowerCase().trim()
        // With the API list, native is only selectable through its (possibly disabled) row.
        if (!xswapApiTokens && s === native?.symbol?.toLowerCase()) {
          handleCurrencySelect(native)
        } else if (currencyResults.length > 0) {
          if (
            currencyResults[0]?.currency &&
            (currencyResults[0].currency.symbol?.toLowerCase() === debouncedQuery.trim().toLowerCase() ||
              currencyResults.length === 1)
          ) {
            handleCurrencySelect(currencyResults[0].currency)
          }
        }
      }
    },
    [allCurrencyRows, debouncedQuery, native, handleCurrencySelect, xswapApiTokens],
  )

  // menu ui
  const [open, toggle] = useToggle(false)
  const node = useRef<HTMLDivElement>()
  useOnClickOutside(node, open ? toggle : undefined)

  return (
    <ContentWrapper>
      <Trace
        logImpression
        eventOnTrigger={InterfaceEventName.TOKEN_SELECTOR_OPENED}
        modal={InterfaceModalName.TOKEN_SELECTOR}
      >
        <PaddedColumn gap="16px">
          <RowBetween>
            <Text fontWeight={535} fontSize={16}>
              <Trans i18nKey="common.selectToken.label" />
            </Text>
            <CloseIcon onClick={onDismiss} />
          </RowBetween>
          <Row gap="4px">
            <SearchInput
              type="text"
              id="token-search-input"
              data-testid="token-search-input"
              placeholder={t`Search name or paste address`}
              autoComplete="off"
              value={searchQuery}
              ref={inputRef as RefObject<HTMLInputElement>}
              onChange={handleInput}
              onKeyDown={handleEnter}
            />
            <ChainSelectorWrapper>
              <ChainSelector allowedChainIds={xswapApiTokens ? xswapChainIds : undefined} />
            </ChainSelectorWrapper>
          </Row>
          {showCommonBases && (
            <CommonBases
              chainId={chainId}
              onSelect={handleCurrencySelect}
              selectedCurrency={selectedCurrency}
              searchQuery={searchQuery}
              isAddressSearch={isAddressSearch}
            />
          )}
        </PaddedColumn>
        <Separator />
        {searchCurrency ? (
          <Column style={{ padding: '20px 0', height: '100%' }}>
            <CurrencyRow
              currency={searchCurrency}
              isSelected={Boolean(searchCurrency && selectedCurrency && selectedCurrency.equals(searchCurrency))}
              onSelect={(hasWarning: boolean) => searchCurrency && handleCurrencySelect(searchCurrency, hasWarning)}
              otherSelected={Boolean(
                searchCurrency && otherSelectedCurrency && otherSelectedCurrency.equals(searchCurrency),
              )}
              showCurrencyAmount={showCurrencyAmount}
              eventProperties={formatAnalyticsEventProperties(
                searchCurrency,
                0,
                [searchCurrency],
                searchQuery,
                isAddressSearch,
              )}
              balance={
                tryParseCurrencyAmount(String(balanceMap[currencyKey(searchCurrency)]?.balance ?? 0), searchCurrency) ??
                CurrencyAmount.fromRawAmount(searchCurrency, 0)
              }
            />
          </Column>
        ) : allCurrencyRows.some((currencyRow) => !!currencyRow.currency) || currencySearchResultsLoading ? (
          <div style={{ flex: '1' }}>
            <AutoSizer disableWidth>
              {({ height }: { height: number }) => (
                <CurrencyList
                  height={height}
                  currencies={allCurrencyRows}
                  onCurrencySelect={handleCurrencySelect}
                  otherCurrency={otherSelectedCurrency}
                  selectedCurrency={selectedCurrency}
                  fixedListRef={fixedList}
                  showCurrencyAmount={showCurrencyAmount}
                  isLoading={currencySearchResultsLoading}
                  searchQuery={searchQuery}
                  isAddressSearch={isAddressSearch}
                  balances={balanceMap}
                />
              )}
            </AutoSizer>
          </div>
        ) : (
          <Column style={{ padding: '20px', height: '100%' }}>
            <ThemedText.DeprecatedMain color={theme.neutral3} textAlign="center" mb="20px">
              {xswapChainUnavailable ? (
                <Trans i18nKey="xswap.tokenSelector.chainUnavailable" />
              ) : (
                <Trans i18nKey="common.noResults" />
              )}
            </ThemedText.DeprecatedMain>
          </Column>
        )}
      </Trace>
    </ContentWrapper>
  )
}
