import { Currency } from '@uniswap/sdk-core'
import { NATIVE_CHAIN_ID, isJoc, nativeOnChain } from 'constants/tokens'
import { TokenStandard } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { skipToken } from '@reduxjs/toolkit/query/react'
import { SearchToken } from 'graphql/data/SearchTokens'
import { useGetJocPriceQuery } from 'state/routing/slice'
import { USDCX_JOC_MAINNET, USDCX_JOC_TESTNET, USDTX_JOC_MAINNET, USDTX_JOC_TESTNET } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { useMemo } from 'react'

export function useJocTokensToSearchTokens(inputs: { address: string; chain: UniverseChainId.JocMainnet | UniverseChainId.JocTestnet | 'JOC' | 'JOCT' }[]): { data: SearchToken[]; isLoading: boolean } {
  let chainId = useMemo(() => {
    if (inputs.length === 0) return undefined
    const firstInput = inputs[0]
    if(typeof firstInput.chain === 'string') {
      return firstInput.chain === 'JOC' ? UniverseChainId.JocMainnet : firstInput.chain === 'JOCT' ? UniverseChainId.JocTestnet : undefined
    }
    return firstInput.chain
  }, [inputs])

  const priceArgs = useMemo(() => {
    if (!chainId || !isJoc(chainId) || inputs.length === 0) {
      return skipToken
    }

    // TypeScript now knows chainId is defined and is a JOC chain
    const validChainId = chainId

    return inputs
      .map((input) => {
        const isNative = input.address === NATIVE_CHAIN_ID || !input.address
        let symbol = 'JOC'
        let address = ''

        if (!isNative && input.address) {
          if (
            input.address.toLowerCase() === USDTX_JOC_MAINNET.address.toLowerCase() ||
            input.address.toLowerCase() === USDTX_JOC_TESTNET.address.toLowerCase()
          ) {
            symbol = 'USDTX'
            address = input.address
          } else if (
            input.address.toLowerCase() === USDCX_JOC_MAINNET.address.toLowerCase() ||
            input.address.toLowerCase() === USDCX_JOC_TESTNET.address.toLowerCase()
          ) {
            symbol = 'USDCX'
            address = input.address
          } else {
            symbol = 'UNKNOWN'
            address = input.address
          }
        }
        return { symbol, chainId: validChainId.toString(), tokenAddress: address }
      })
      .filter((arg) => arg.symbol !== 'UNKNOWN' || arg.tokenAddress)
  }, [inputs, chainId])

  const { data: pricesData, isLoading: pricesLoading } = useGetJocPriceQuery(priceArgs)

  const tokens = useMemo(() => {
    if (!chainId || !isJoc(chainId)) {
      return []
    }

    // TypeScript now knows chainId is defined and is a JOC chain
    const validChainId = chainId

    const prices = pricesData?.prices ?? []

    return inputs
      .map((input, index) => {
        let currency: Currency
        let address = undefined
        let symbol = 'JOC'
        let name = 'JOC'
        let decimals = 18
        let isNative = false

        isNative = input.address === NATIVE_CHAIN_ID || !input.address
        currency = nativeOnChain(validChainId)

        if (!isNative && input.address) {
          if (
            input.address.toLowerCase() === USDTX_JOC_MAINNET.address.toLowerCase() ||
            input.address.toLowerCase() === USDTX_JOC_TESTNET.address.toLowerCase()
          ) {
            currency = validChainId === UniverseChainId.JocTestnet ? USDTX_JOC_TESTNET : USDTX_JOC_MAINNET
            address = currency.isToken ? currency.address : ''
            symbol = currency.symbol ?? 'USDTX'
            name = currency.name ?? 'USDTX'
            decimals = currency.decimals
          } else if (
            input.address.toLowerCase() === USDCX_JOC_MAINNET.address.toLowerCase() ||
            input.address.toLowerCase() === USDCX_JOC_TESTNET.address.toLowerCase()
          ) {
            currency = validChainId === UniverseChainId.JocTestnet ? USDCX_JOC_TESTNET : USDCX_JOC_MAINNET
            address = currency.isToken ? currency.address : ''
            symbol = currency.symbol ?? 'USDCX'
            name = currency.name ?? 'USDCX'
            decimals = currency.decimals
          } else {
            address = input.address
            symbol = 'UNKNOWN'
            name = 'Unknown Token'
          }
        }

        const chain = validChainId === UniverseChainId.JocTestnet ? 'JOCT' : 'JOC'
        const price = prices[index] ?? 0

        return {
          __typename: 'Token' as const,
          id: `${validChainId}-${address ?? NATIVE_CHAIN_ID}`,
          chain: chain as any,
          address: address,
          symbol: symbol,
          decimals: decimals,
          name: name,
          standard: isNative ? TokenStandard.Native : TokenStandard.Erc20,
          market: price > 0
            ? {
                __typename: 'TokenMarket' as const,
                id: `${validChainId}-${address ?? NATIVE_CHAIN_ID}-market`,
                price: {
                  __typename: 'Amount' as const,
                  id: `${validChainId}-${address ?? NATIVE_CHAIN_ID}-price`,
                  value: price,
                  currency: undefined,
                },
              }
            : undefined,
          project: {
            __typename: 'TokenProject' as const,
            id: `${validChainId}-${address}`,
          },
        } as SearchToken
      })
      .filter((token): token is SearchToken => token !== null)
  }, [inputs, chainId, pricesData?.prices])

  return { data: tokens, isLoading: pricesLoading }
}
