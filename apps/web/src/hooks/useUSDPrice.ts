import { NetworkStatus } from '@apollo/client'
import { Currency, CurrencyAmount, Price, TradeType, Token } from '@uniswap/sdk-core'
import {
  AVERAGE_L1_BLOCK_TIME,
  SupportedInterfaceChainId,
  chainIdToBackendChain,
  useIsSupportedChainId,
  useSupportedChainId,
} from 'constants/chains'
import { isJoc, nativeOnChain } from 'constants/tokens'
import { PollingInterval } from 'graphql/data/util'
import useIsWindowVisible from 'hooks/useIsWindowVisible'
import useStablecoinPrice from 'hooks/useStablecoinPrice'
import { useMemo } from 'react'
import { ClassicTrade, INTERNAL_ROUTER_PREFERENCE_PRICE, TradeState } from 'state/routing/types'
import { useRoutingAPITrade } from 'state/routing/useRoutingAPITrade'
import { Chain, useTokenSpotPriceQuery } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { getNativeTokenDBAddress } from 'utils/nativeTokens'
import { useGetJocPriceQuery, useGetJocPriceQueryState } from 'state/routing/slice'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { jocMainnet } from 'viem/chains'

// ETH amounts used when calculating spot price for a given currency.
// The amount is large enough to filter low liquidity pairs.
function getEthAmountOut(chainId: SupportedInterfaceChainId): CurrencyAmount<Currency> {
  return CurrencyAmount.fromRawAmount(nativeOnChain(chainId), chainId === UniverseChainId.Mainnet ? 50e18 : 10e18)
}

function useETHPrice(currency?: Currency): {
  data?: Price<Currency, Currency>
  isLoading: boolean
} {
  const chainId = currency?.chainId
  const isSupportedChain = useIsSupportedChainId(chainId)
  const isSupported = isSupportedChain && currency

  const amountOut = isSupported ? getEthAmountOut(chainId) : undefined
  const { trade, state } = useRoutingAPITrade(
    !isSupported /* skip */,
    TradeType.EXACT_OUTPUT,
    amountOut,
    currency,
    INTERNAL_ROUTER_PREFERENCE_PRICE,
  )

  return useMemo(() => {
    if (!isSupported) {
      return { data: undefined, isLoading: false }
    }

    if (currency?.wrapped.equals(nativeOnChain(chainId).wrapped)) {
      return {
        data: new Price(currency, currency, '1', '1'),
        isLoading: false,
      }
    }

    if (!trade || state === TradeState.LOADING) {
      return { data: undefined, isLoading: state === TradeState.LOADING }
    }

    // if initial quoting fails, we may end up with a DutchOrderTrade
    if (trade && trade instanceof ClassicTrade) {
      const { numerator, denominator } = trade.routes[0].midPrice
      const price = new Price(currency, nativeOnChain(chainId), denominator, numerator)
      return { data: price, isLoading: false }
    }

    return { data: undefined, isLoading: false }
  }, [chainId, currency, isSupported, state, trade])
}

export function useUSDPrice(
  currencyAmount?: CurrencyAmount<Currency>,
  prefetchCurrency?: Currency,
): {
  data?: number
  isLoading: boolean
} {
  const currency = currencyAmount?.currency ?? prefetchCurrency
  const chainId = useSupportedChainId(currency?.chainId)
  const chain = chainIdToBackendChain({ chainId })

  // skip all pricing requests if the window is not focused
  const isWindowVisible = useIsWindowVisible()

  const isJocChain = !!chainId && isJoc(chainId)

  // Use ETH-based pricing if available.
  const { data: tokenEthPrice, isLoading: isTokenEthPriceLoading } = useETHPrice(currency)
  const isTokenEthPriced = Boolean(tokenEthPrice || isTokenEthPriceLoading)
  const { data, networkStatus } = useTokenSpotPriceQuery({
    variables: { chain: chain ?? Chain.Ethereum, address: getNativeTokenDBAddress(chain ?? Chain.Ethereum) },
    skip: !isTokenEthPriced || !isWindowVisible || isJocChain,
    pollInterval: PollingInterval.Normal,
    notifyOnNetworkStatusChange: true,
    fetchPolicy: 'cache-first',
  })

  // Use USDC-based pricing for chains not yet supported by backend (for ETH-based pricing).
  const stablecoinPrice = useStablecoinPrice(isTokenEthPriced ? undefined : currency)

  let tokenAddress = ''

  if (currency instanceof Token && chainId === jocMainnet.id) {
    tokenAddress = currency.address
  }

  const jocShouldSkip =
    !chainId || !currency || !currencyAmount || !isWindowVisible || !isJocChain
  const jocArgs = jocShouldSkip
    ? skipToken
    : [{ symbol: currency?.symbol || 'JOC', chainId: chainId!.toString(), tokenAddress }]

  const {
    isError: isJocError,
    data: jocPriceResult,
    error: jocError,
    currentData,
  } = useGetJocPriceQueryState(jocArgs)
  useGetJocPriceQuery(jocArgs, {
    pollingInterval: AVERAGE_L1_BLOCK_TIME,
    refetchOnMountOrArgChange: 2 * 60,
    skip: jocShouldSkip,
  })

  const isJocFetching = currentData !== jocPriceResult || !currentData

  return useMemo(() => {
    if (!currencyAmount) {
      return { data: undefined, isLoading: false }
    }

    if (isJocChain && !jocShouldSkip && !isJocError && !jocError) {
      if (isJocFetching) {
        return { data: undefined, isLoading: true }
      }

      const jocUSDPrice = jocPriceResult?.prices[0]
      if (jocUSDPrice) {
        return { data: parseFloat(currencyAmount.toExact()) * jocUSDPrice, isLoading: false }
      }
    }

    if (stablecoinPrice) {
      return { data: parseFloat(stablecoinPrice.quote(currencyAmount).toSignificant()), isLoading: false }
    }

    const ethUSDPrice = data?.token?.project?.markets?.[0]?.price?.value
    if (ethUSDPrice && tokenEthPrice) {
      return { data: parseFloat(tokenEthPrice.quote(currencyAmount).toExact()) * ethUSDPrice, isLoading: false }
    }

    return { data: undefined, isLoading: isTokenEthPriceLoading || networkStatus === NetworkStatus.loading }
  }, [
    currencyAmount,
    isJocChain,
    jocShouldSkip,
    isJocError,
    jocError,
    isJocFetching,
    jocPriceResult?.prices  ,
    data?.token?.project?.markets,
    tokenEthPrice,
    isTokenEthPriceLoading,
    networkStatus,
    stablecoinPrice,
  ])
}
