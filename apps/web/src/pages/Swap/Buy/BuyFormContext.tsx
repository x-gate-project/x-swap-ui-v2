import { buildCurrencyInfo } from 'constants/routing'
import { nativeOnChain } from 'constants/tokens'
import { useUSDTokenUpdater } from 'hooks/useUSDTokenUpdater'
import { useAlchemyPaySupportedTokens, useMeldFiatCurrencyInfo } from 'pages/Swap/Buy/hooks'
import { Dispatch, PropsWithChildren, SetStateAction, createContext, useContext, useMemo, useState } from 'react'
import {
  useFiatOnRampAggregatorCountryListQuery,
} from 'uniswap/src/features/fiatOnRamp/api'
import {
  FORCountry,
  FORQuoteResponse,
  FORSupportedCountriesResponse,
  FiatCurrencyInfo,
  FiatOnRampCurrency,
} from 'uniswap/src/features/fiatOnRamp/types'
import { UniverseChainId } from 'uniswap/src/types/chains'

class BuyFormError extends Error {
  constructor(public readonly message: string) {
    super(message)
  }
}

type BuyFormState = {
  readonly inputAmount: string
  readonly quoteCurrency: FiatOnRampCurrency
  readonly selectedCountry?: FORCountry
  readonly countryModalOpen: boolean
  readonly currencyModalOpen: boolean
  readonly providerModalOpen: boolean
}

type BuyInfo = {
  readonly meldSupportedFiatCurrency?: FiatCurrencyInfo
  readonly notAvailableInThisRegion: boolean
  readonly countryOptionsResult?: FORSupportedCountriesResponse
  readonly supportedTokens?: FiatOnRampCurrency[]
  readonly amountOut?: string
  readonly quotes?: FORQuoteResponse
  readonly fetchingQuotes: boolean
  readonly error?: BuyFormError
}

type BuyFormContextType = {
  buyFormState: BuyFormState
  setBuyFormState: Dispatch<SetStateAction<BuyFormState>>
  derivedBuyFormInfo: BuyInfo
}

export const ethCurrencyInfo = buildCurrencyInfo(nativeOnChain(UniverseChainId.Mainnet))
export const jocCurrencyInfo = {
  ...buildCurrencyInfo(nativeOnChain(UniverseChainId.JocMainnet)),
  logoUrl: 'https://static.alchemypay.org/alchemypay/crypto-images/JOC.png'
}
const DEFAULT_BUY_FORM_STATE: BuyFormState = {
  inputAmount: '',
  quoteCurrency: {
    currencyInfo: jocCurrencyInfo,
    meldCurrencyCode: 'JOC',
  },
  selectedCountry: undefined,
  countryModalOpen: false,
  currencyModalOpen: false,
  providerModalOpen: false,
}

export const BuyFormContext = createContext<BuyFormContextType>({
  buyFormState: DEFAULT_BUY_FORM_STATE,
  setBuyFormState: () => undefined,
  derivedBuyFormInfo: {
    meldSupportedFiatCurrency: undefined,
    notAvailableInThisRegion: false,
    countryOptionsResult: undefined,
    supportedTokens: [],
    amountOut: undefined,
    quotes: undefined,
    fetchingQuotes: false,
    error: undefined,
  },
})

export function useBuyFormContext() {
  return useContext(BuyFormContext)
}

function useDerivedBuyFormInfo(state: BuyFormState): BuyInfo {
  const amountOut = useUSDTokenUpdater(
    true /* inputInFiat */,
    state.inputAmount,
    state.quoteCurrency?.currencyInfo?.currency,
  )

  const { meldSupportedFiatCurrency, notAvailableInThisRegion } = useMeldFiatCurrencyInfo(state.selectedCountry)
  const { data: countryOptionsResult } = useFiatOnRampAggregatorCountryListQuery()
  const supportedTokens = useAlchemyPaySupportedTokens()

  const quotes: FORQuoteResponse = useMemo(() => {
    return {
    quotes: [
      {
        countryCode: 'US',
        destinationAmount: 0,
        destinationCurrencyCode: state.quoteCurrency.meldCurrencyCode ?? 'ETH',
        serviceProvider: 'ALCHEMYPAY',
        serviceProviderDetails: {
          logos: {
            darkLogo: 'https://images-serviceprovider.meld.io/ALCHEMYPAY/short_logo_light.png',
            lightLogo: 'https://images-serviceprovider.meld.io/ALCHEMYPAY/short_logo_light.png',
          },
          name: 'AlchemyPay',
          paymentMethods: ['Debit Card', 'Apple Pay', 'Google Pay'],
          serviceProvider: 'ALCHEMYPAY',
          url: 'https://alchemypay.org/',
        },
        sourceAmount: parseFloat(state.inputAmount) || 0,
        sourceCurrencyCode: 'USD',
        totalFee: 0,
      },
    ],
      message: null,
      error: null,
    }
  }, [state.inputAmount, state.quoteCurrency.meldCurrencyCode])

  return useMemo(
    () => ({
      amountOut,
      notAvailableInThisRegion,
      meldSupportedFiatCurrency,
      supportedTokens,
      countryOptionsResult,
      quotes: quotes,
      fetchingQuotes: false,
      error: undefined,
    }),
    [
      amountOut,
      countryOptionsResult,
      meldSupportedFiatCurrency,
      notAvailableInThisRegion,
      supportedTokens,
    ],
  )
}

export function BuyFormContextProvider({ children }: PropsWithChildren) {
  const [buyFormState, setBuyFormState] = useState<BuyFormState>({ ...DEFAULT_BUY_FORM_STATE })
  const derivedBuyFormInfo = useDerivedBuyFormInfo(buyFormState)

  const value = useMemo(
    () => ({
      buyFormState,
      setBuyFormState,
      derivedBuyFormInfo,
    }),
    [buyFormState, derivedBuyFormInfo],
  )

  return <BuyFormContext.Provider value={value}>{children}</BuyFormContext.Provider>
}
