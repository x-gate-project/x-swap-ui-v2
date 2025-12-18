import { Token as SDKToken } from '@uniswap/sdk-core'
import { PortfolioLogo } from 'components/AccountDrawer/MiniPortfolio/PortfolioLogo'
import { AssetLogoBaseProps } from 'components/Logo/AssetLogo'
import { NATIVE_CHAIN_ID, nativeOnChain } from 'constants/tokens'
import { Token } from 'graphql'
import { SearchToken } from 'graphql/data/SearchTokens'
import { TokenQueryData } from 'graphql/data/Token'
import { TopToken } from 'graphql/data/TopTokens'
import { gqlToCurrency, supportedChainIdFromGQLChain } from 'graphql/data/util'
import { useMemo } from 'react'
import { TokenStandard } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { UniverseChainId } from 'uniswap/src/types/chains'

export default function QueryTokenLogo(
  props: AssetLogoBaseProps & {
    token?: TopToken | TokenQueryData | SearchToken
  },
) {
  const chainId = useMemo(() => {
    if (!props.token?.chain) {
      return UniverseChainId.Mainnet
    }
    if (props.token.chain === 'JOC' as any) {
      return UniverseChainId.JocMainnet
    }
    if (props.token.chain === 'JOCT' as any) {
      return UniverseChainId.JocTestnet
    }
    return supportedChainIdFromGQLChain(props.token.chain) ?? UniverseChainId.Mainnet
  }, [props.token?.chain])

  const currency = useMemo(() => {
    if (!props.token) {
      return undefined
    }

    const converted = gqlToCurrency(props.token)
    if (converted) {
      return converted
    }

    if (props.token.chain === 'JOC' as any || props.token.chain === 'JOCT' as any) {
      if (props.token.standard === TokenStandard.Native || props.token.address === NATIVE_CHAIN_ID || !props.token.address) {
        return nativeOnChain(chainId)
      } else {
        return new SDKToken(
          chainId,
          props.token.address ?? '',
          props.token.decimals ?? 18,
          props.token.symbol ?? undefined,
          props.token.project?.name ?? props.token.name ?? undefined,
        )
      }
    }

    return undefined
  }, [props.token, chainId])

  const logoUrl = props.token?.project?.logoUrl

  return (
    <PortfolioLogo currencies={useMemo(() => [currency], [currency])} chainId={chainId} images={[logoUrl]} {...props} />
  )
}
