import { InterfaceEventName, InterfaceModalName } from '@uniswap/analytics-events'
import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import Column from 'components/Column'
import { ChainSelector } from 'components/NavBar/ChainSelector'
import Row, { RowBetween } from 'components/Row'
import CommonBases from 'components/SearchModal/CommonBases'
import CurrencyList, { CurrencyRow, formatAnalyticsEventProperties } from 'components/SearchModal/CurrencyList'
import { PaddedColumn, SearchInput, Separator } from 'components/SearchModal/styled'
import { useCurrencySearchResults } from 'components/SearchModal/useCurrencySearchResults'
import { Field } from 'components/swap/constants'
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
import styled, { useTheme } from 'styled-components'
import { CloseIcon, ThemedText } from 'theme/components'
import Trace from 'uniswap/src/features/telemetry/Trace'
import { InterfaceChainId, UniverseChainId } from 'uniswap/src/types/chains'
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
}

const DEFAULT_CURRENCY_SEARCH_FILTERS: CurrencySearchFilters = {
  showCommonBases: true,
  disableNonToken: false,
  onlyShowCurrenciesWithBalance: false,
}

interface CurrencySearchProps {
  isOpen: boolean
  onDismiss: () => void
  selectedCurrency?: Currency | null
  onCurrencySelect: (currency: Currency, hasWarning?: boolean) => void
  otherSelectedCurrency?: Currency | null
  showCurrencyAmount?: boolean
  filters?: CurrencySearchFilters
  /** Which swap field this search is for. When provided, chain selection is local to this modal
   *  and does not affect the other field — enabling future cross-chain swap support. */
  field?: Field
}

export function CurrencySearch({
  selectedCurrency,
  onCurrencySelect,
  otherSelectedCurrency,
  showCurrencyAmount,
  onDismiss,
  isOpen,
  filters,
  field,
}: CurrencySearchProps) {
  const { showCommonBases } = {
    ...DEFAULT_CURRENCY_SEARCH_FILTERS,
    ...filters,
  }
  const { chainId: contextChainId, inputChainId, outputChainId } = useSwapAndLimitContext()

  // Per-field fallback chain: use the chain already associated with this field's token.
  // This ensures sell-modal opens on sell-token's chain and buy-modal on buy-token's chain,
  // completely independent of the other field and of the global context chainId.
  const fieldChainId =
    field === Field.INPUT ? inputChainId :
    field === Field.OUTPUT ? outputChainId :
    contextChainId

  // Per-field local chain state — independent of the other field's chain.
  // Only active when `field` prop is provided (swap context). Falls back to
  // fieldChainId for non-swap usages (liquidity, NFT, etc.).
  // Init from selectedCurrency's chain so the modal opens on the right network.
  const [localChainId, setLocalChainId] = useState<InterfaceChainId | undefined>(
    selectedCurrency?.chainId ?? fieldChainId,
  )

  // Sync localChainId when modal opens — derive from the already-selected token's chain,
  // so sell-modal defaults to sell-token's chain and buy-modal defaults to buy-token's chain.
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setLocalChainId(selectedCurrency?.chainId ?? fieldChainId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]) // intentionally only re-run on open — fieldChainId/selectedCurrency are captured at open time

  // Use localChainId when field is provided (swap), otherwise fall back to context
  const activeChainId = field !== undefined ? localChainId : contextChainId

  const theme = useTheme()

  // refs for fixed size lists
  const fixedList = useRef<FixedSizeList>()

  const [searchQuery, setSearchQuery] = useState<string>('')
  const debouncedQuery = useDebounce(searchQuery, 200)
  const isAddressSearch = isAddress(debouncedQuery)

  const {
    searchCurrency,
    allCurrencyRows,
    loading: currencySearchResultsLoading,
  } = useCurrencySearchResults({
    searchQuery: debouncedQuery,
    filters,
    selectedCurrency,
    otherSelectedCurrency,
    chainId: activeChainId,
  })

  const { balanceMap } = useTokenBalances()

  const native = useNativeCurrency(activeChainId)

  const selectChain = useSelectChain()
  const handleCurrencySelect = useCallback(
    async (currency: Currency, hasWarning?: boolean) => {
      if (field === undefined && currency.chainId !== contextChainId) {
        // Legacy (non-swap) usage: switch wallet network to match selected token's chain
        const result = await selectChain(currency.chainId)
        if (!result) {
          // failed to switch chains, don't select the currency
          return
        }
      }
      // When field is provided (swap context), skip chain switching — cross-chain tokens are allowed
      onCurrencySelect(currency, hasWarning)
      if (!hasWarning) {
        onDismiss()
      }
    },
    [field, contextChainId, onCurrencySelect, onDismiss, selectChain],
  )

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
        const currencyResults = allCurrencyRows.filter((currencyRow) => !!currencyRow.currency)
        const s = debouncedQuery.toLowerCase().trim()
        if (s === native?.symbol?.toLowerCase()) {
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
    [allCurrencyRows, debouncedQuery, native, handleCurrencySelect],
  )

  // menu ui
  const [open, toggle] = useToggle(false)
  const node = useRef<HTMLDivElement>()
  useOnClickOutside(node, open ? toggle : undefined)

  const handleLocalChainSelect = useCallback((chainId: UniverseChainId | null) => {
    setLocalChainId(chainId ?? undefined)
  }, [])

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
              {field !== undefined ? (
                // Per-field chain selector: local state only, does not affect the other field
                <ChainSelector chainId={activeChainId ?? null} onSelectChain={handleLocalChainSelect} />
              ) : (

                // Global chain selector: updates swap context (legacy / non-swap usage)
                <ChainSelector />
              )}
            </ChainSelectorWrapper>
          </Row>
          {showCommonBases && (
            <CommonBases
              chainId={activeChainId}
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
              <Trans i18nKey="common.noResults" />
            </ThemedText.DeprecatedMain>
          </Column>
        )}
      </Trace>
    </ContentWrapper>
  )
}
