import { SupportedInterfaceChainId, chainIdToBackendChain } from 'constants/chains'
import { isJoc, NATIVE_CHAIN_ID, nativeOnChain } from 'constants/tokens'
import { unwrapToken } from 'graphql/data/util'
import { useMemo } from 'react'
import { useTrendingTokensQuery } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { USDCX_JOC_MAINNET, USDCX_JOC_TESTNET, USDTX_JOC_MAINNET, USDTX_JOC_TESTNET } from 'uniswap/src/constants/tokens'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { useJocTokensToSearchTokens } from 'hooks/useJocTokensToSearchTokens'

export default function useTrendingTokens(chainId?: SupportedInterfaceChainId) {
  const isJocChain = chainId && isJoc(chainId)

  const jocNative = useMemo(() => chainId && isJocChain ? nativeOnChain(chainId) : null, [chainId, isJocChain])
  const jocUsdtx = useMemo(
    () => (chainId === UniverseChainId.JocTestnet ? USDTX_JOC_TESTNET : chainId === UniverseChainId.JocMainnet ? USDTX_JOC_MAINNET : null),
    [chainId],
  )
  const jocUsdcx = useMemo(
    () => (chainId === UniverseChainId.JocTestnet ? USDCX_JOC_TESTNET : chainId === UniverseChainId.JocMainnet ? USDCX_JOC_MAINNET : null),
    [chainId],
  )

  const jocTokenInputs = useMemo(
    () =>
      isJocChain && chainId && jocNative && jocUsdtx && jocUsdcx
        ? [
            { address: NATIVE_CHAIN_ID, chain: jocNative.chainId as any },
            { address: jocUsdtx.address, chain: jocUsdtx.chainId as any },
            { address: jocUsdcx.address, chain: jocUsdcx.chainId as any },
          ]
        : [],
    [isJocChain, chainId, jocNative, jocUsdtx, jocUsdcx],
  )
  const { data: jocTokens, isLoading: jocPricesLoading } = useJocTokensToSearchTokens(jocTokenInputs)

  const chain = chainIdToBackendChain({ chainId, withFallback: true })
  const { data, loading } = useTrendingTokensQuery({ variables: { chain }, skip: isJocChain })

  return useMemo(() => {
    if (isJocChain && chainId) {
      return {
        data: jocTokens,
        loading: jocPricesLoading,
      }
    }

    return {
      data: data?.topTokens?.map((token) => unwrapToken(chainId ?? 1, token)),
      loading,
    }
  }, [isJocChain, chainId, jocTokens, jocPricesLoading, data?.topTokens, loading])
}
