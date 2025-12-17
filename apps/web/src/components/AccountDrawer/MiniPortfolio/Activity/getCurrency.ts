import { Currency } from '@uniswap/sdk-core'
import { SupportedInterfaceChainId, chainIdToBackendChain } from 'constants/chains'
import { COMMON_BASES } from 'constants/routing'
import { X_SWAP_LIST } from 'constants/lists'
import { NATIVE_CHAIN_ID, nativeOnChain } from 'constants/tokens'
import { apolloClient } from 'graphql/data/apollo/client'
import { gqlTokenToCurrencyInfo } from 'graphql/data/types'
import { tokensToChainTokenMap } from 'lib/hooks/useTokenList/utils'
import store from 'state/index'
import {
  SimpleTokenDocument,
  SimpleTokenQuery,
  Token,
} from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { isSameAddress } from 'utilities/src/addresses'

export async function getCurrency(
  currencyId: string,
  chainId: SupportedInterfaceChainId,
): Promise<Currency | undefined> {
  const isNative =
    currencyId === NATIVE_CHAIN_ID || currencyId?.toLowerCase() === 'native' || currencyId?.toLowerCase() === 'eth'
  if (isNative) {
    return nativeOnChain(chainId)
  }
  const commonBase = chainId
    ? COMMON_BASES[chainId]?.find((base) => base.currency.isToken && isSameAddress(base.currency.address, currencyId))
    : undefined
  if (commonBase) {
    return commonBase.currency
  }

  const { data } = await apolloClient.query<SimpleTokenQuery>({
    query: SimpleTokenDocument,
    variables: {
      address: currencyId,
      chain: chainIdToBackendChain({ chainId }),
    },
  })

  if(gqlTokenToCurrencyInfo(data?.token as Token)?.currency) {
    return gqlTokenToCurrencyInfo(data?.token as Token)?.currency
  }

  const state = store.getState()
    const tokenList = state.lists.byUrl[X_SWAP_LIST]?.current

    if (tokenList) {
      const tokenMap = tokensToChainTokenMap(tokenList)
      const chainTokens = tokenMap[chainId]

      if (chainTokens) {
        const currencyIdLower = currencyId.toLowerCase()
        const tokenEntry = Object.values(chainTokens).find(
          ({ token }) => isSameAddress(token.address, currencyIdLower)
        )

        if (tokenEntry) {
          return tokenEntry.token
        }
      }
    }
  return undefined
}
