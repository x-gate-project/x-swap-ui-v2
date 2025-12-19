import { NATIVE_CHAIN_ID, isJoc, nativeOnChain } from 'constants/tokens'
import { SearchToken } from 'graphql/data/SearchTokens'
import { supportedChainIdFromGQLChain } from 'graphql/data/util'
import { useAtom } from 'jotai'
import { atomWithStorage, useAtomValue } from 'jotai/utils'
import { GenieCollection } from 'nft/types'
import { useCallback, useMemo } from 'react'
import {
  Chain,
  NftCollection,
  useRecentlySearchedAssetsQuery,
} from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { logger } from 'utilities/src/logger/logger'
import { getNativeTokenDBAddress } from 'utils/nativeTokens'
import { useJocTokensToSearchTokens } from '../../../hooks/useJocTokensToSearchTokens'

type RecentlySearchedAsset = {
  isNft?: boolean
  address: string
  chain: Chain
}

// Temporary measure used until backend supports addressing by "NATIVE"
const NATIVE_QUERY_ADDRESS_INPUT = null as unknown as string
function getQueryAddress(chain: Chain) {
  return getNativeTokenDBAddress(chain) ?? NATIVE_QUERY_ADDRESS_INPUT
}
function getNativeQueryAddress(chain: Chain) {
  return `NATIVE-${chain}`
}

const recentlySearchedAssetsAtom = atomWithStorage<RecentlySearchedAsset[]>('recentlySearchedAssets', [])

export function useAddRecentlySearchedAsset() {
  const [searchHistory, updateSearchHistory] = useAtom(recentlySearchedAssetsAtom)

  return useCallback(
    (asset: RecentlySearchedAsset) => {
      // Removes the new asset if it was already in the array
      const newHistory = searchHistory.filter(
        (oldAsset) => !(oldAsset.address === asset.address && oldAsset.chain === asset.chain),
      )
      newHistory.unshift(asset)
      updateSearchHistory(newHistory)
    },
    [searchHistory, updateSearchHistory],
  )
}

export function useRecentlySearchedAssets() {
  const history = useAtomValue(recentlySearchedAssetsAtom)
  const shortenedHistory = useMemo(() => history.slice(0, 4), [history])

  const hasJocAssets = useMemo(
    () =>
      shortenedHistory.some(
        (asset) =>
          asset.chain === ('JOC' as any) ||
          asset.chain === ('JOCT' as any) ||
          (asset.chain && supportedChainIdFromGQLChain(asset.chain) && isJoc(supportedChainIdFromGQLChain(asset.chain)!))
      ),
    [shortenedHistory],
  )

  const nonJocHistory = useMemo(
    () =>
      shortenedHistory.filter(
        (asset) =>
          asset.chain !== ('JOC' as any) &&
          asset.chain !== ('JOCT' as any) &&
          (!asset.chain || !supportedChainIdFromGQLChain(asset.chain) || !isJoc(supportedChainIdFromGQLChain(asset.chain)!))
      ),
    [shortenedHistory],
  )

  const { data: queryData, loading: queryLoading } = useRecentlySearchedAssetsQuery({
    variables: {
      collectionAddresses: nonJocHistory.filter((asset) => asset.isNft).map((asset) => asset.address),
      contracts: nonJocHistory
        .filter((asset) => !asset.isNft)
        .map((token) => ({
          address: token.address === NATIVE_CHAIN_ID ? getQueryAddress(token.chain) : token.address,
          chain: token.chain,
        })),
    },
    skip: hasJocAssets && nonJocHistory.length === 0,
  })

  const jocAssets = useMemo(
    () =>
      shortenedHistory.filter(
        (asset) => asset.chain === ('JOC' as any) || asset.chain === ('JOCT' as any)
      ),
    [shortenedHistory],
  )

  const jocTokenInputs = useMemo(
    () =>
      jocAssets.map((asset) => ({
        address: asset.address,
        chain: asset.chain as any,
      })),
    [jocAssets],
  )

  const { data: jocTokens, isLoading: jocTokensLoading } = useJocTokensToSearchTokens(jocTokenInputs)

  const loading = useMemo(() => queryLoading || jocTokensLoading, [queryLoading, jocTokensLoading])

  const data = useMemo(() => {
    if (shortenedHistory.length === 0) {
      return []
    }

    // Collects both tokens and collections in a map, so they can later be returned in original order
    const resultsMap: { [key: string]: GenieCollection | SearchToken } = {}

    if (queryData) {
      const queryCollections = queryData?.nftCollections?.edges.map((edge) => edge.node as NonNullable<NftCollection>)
      const collections = queryCollections?.map(
        (queryCollection): GenieCollection => {
          return {
            address: queryCollection.nftContracts?.[0]?.address ?? '',
            isVerified: queryCollection?.isVerified,
            name: queryCollection?.name,
            stats: {
              floor_price: queryCollection?.markets?.[0]?.floorPrice?.value,
              total_supply: queryCollection?.numAssets,
            },
            imageUrl: queryCollection?.image?.url ?? '',
          }
        },
        [queryCollections],
      )
      collections?.forEach((collection) => (resultsMap[collection.address] = collection))
      queryData.tokens?.filter(Boolean).forEach((token) => {
        if (token) {
          resultsMap[token.address ?? getNativeQueryAddress(token.chain)] = token
        }
      })
    }

    const resultData: (SearchToken | GenieCollection)[] = []
    shortenedHistory.forEach((asset) => {
      const isJocChain = asset.chain === ('JOC' as any) || asset.chain === ('JOCT' as any)

      if (isJocChain) {
        const jocToken = jocTokens.find(
          (token) =>
            (asset.address === NATIVE_CHAIN_ID || !asset.address
              ? token.address === undefined
              : token.address?.toLowerCase() === asset.address.toLowerCase()) &&
            token.chain === asset.chain
        )
        if (jocToken) {
          resultData.push(jocToken)
        }
        return
      }

      if (!queryData) {
        return
      }

      if (asset.address === NATIVE_CHAIN_ID) {
        // Handles special case where wMATIC data needs to be used for MATIC
        const chain = supportedChainIdFromGQLChain(asset.chain)
        if (!chain) {
          logger.error(new Error('Invalid chain retrieved from Search Token/Collection Query'), {
            tags: {
              file: 'RecentlySearchedAssets',
              function: 'useRecentlySearchedAssets',
            },
            extra: { asset },
          })
          return
        }
        const native = nativeOnChain(chain)
        const queryAddress = getQueryAddress(asset.chain)?.toLowerCase() ?? getNativeQueryAddress(asset.chain)
        const result = resultsMap[queryAddress]
        if (result) {
          resultData.push({ ...result, address: NATIVE_CHAIN_ID, ...native })
        }
      } else {
        const result = resultsMap[asset.address]
        if (result) {
          resultData.push(result)
        }
      }
    })
    return resultData
  }, [queryData, shortenedHistory, jocTokens])

  return { data, loading }
}
