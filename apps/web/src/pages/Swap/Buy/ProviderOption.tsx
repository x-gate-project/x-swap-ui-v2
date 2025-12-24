import { useMemo } from 'react'
import { useGetAlchemyPayBuyUrlQuery } from 'state/routing/slice'
import { ExternalLink } from 'ui/src/components/icons'
import { FORQuoteItem } from 'uniswap/src/features/fiatOnRamp/FORQuoteItem'
import { FORCountry, FORQuote, FORServiceProvider, FiatCurrencyInfo, FiatOnRampCurrency } from 'uniswap/src/features/fiatOnRamp/types'

interface ProviderOptionProps {
  quote: FORQuote
  selectedCountry: FORCountry
  quoteCurrency: FiatOnRampCurrency
  inputAmount: string
  meldSupportedFiatCurrency: FiatCurrencyInfo
  walletAddress: string
  setConnectedProvider: (provider: FORServiceProvider) => void
  setErrorProvider: (provider: FORServiceProvider) => void
}

export function ProviderOption({
  quote,
  quoteCurrency,
  inputAmount,
  walletAddress,
  setConnectedProvider,
  setErrorProvider,
}: ProviderOptionProps) {

  const alchemyPayParams = useMemo(() => {
    return {
      fiat: 'USD',
      fiatAmount: inputAmount,
      tokenAddress: (quoteCurrency.currencyInfo?.currency as any).address,
      crypto: quoteCurrency.currencyInfo?.currency.symbol,
      chainId: quoteCurrency.currencyInfo?.currency.chainId.toString(),
      address: walletAddress,
    }
  }, [inputAmount, quoteCurrency, walletAddress])

  const { data, error } = useGetAlchemyPayBuyUrlQuery(alchemyPayParams)

  return (
    <FORQuoteItem
      key={quote.serviceProvider}
      serviceProvider={quote.serviceProviderDetails}
      hoverIcon={<ExternalLink position="absolute" right="$spacing12" size={20} />}
      onPress={async () => {
        if (data) {
          window.open(data.url, '_blank')
          setConnectedProvider(quote.serviceProviderDetails)
        } else if (error) {
          setErrorProvider(quote.serviceProviderDetails)
        }
      }}
    />
  )
}
