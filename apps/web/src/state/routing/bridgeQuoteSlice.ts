import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { wagmiConfig } from 'components/Web3Provider/wagmi'
import type { BridgeProviderId } from 'lib/crossChain/bridge'
import { getBridgeProvider } from 'lib/crossChain/engine/registry'
import ms from 'ms'

// RTK Query args must be serializable — bigint fields passed as strings, re-widened in queryFn.
interface GetBridgeQuoteArgs {
  providerId: BridgeProviderId
  inputToken: string
  outputToken: string
  srcChainId: number
  dstChainId: number
  amount: string
  recipient: string
  unwrapToOrigin?: boolean
}

interface BridgeQuoteData {
  outputAmount: string
  nativeFee?: string
}

export const bridgeQuoteApi = createApi({
  reducerPath: 'bridgeQuoteApi',
  baseQuery: fetchBaseQuery(),
  endpoints: (build) => ({
    getBridgeQuote: build.query<BridgeQuoteData, GetBridgeQuoteArgs>({
      async queryFn({ providerId, amount, ...rest }) {
        try {
          const { outputAmount, nativeFee } = await getBridgeProvider(providerId).getQuote({
            ...rest,
            amount: BigInt(amount),
            wagmiConfig,
          })
          return { data: { outputAmount: outputAmount.toString(), nativeFee: nativeFee?.toString() } }
        } catch (error) {
          return {
            error: { status: 'CUSTOM_ERROR' as const, error: error instanceof Error ? error.message : 'Bridge quote unavailable' },
          }
        }
      },
      keepUnusedDataFor: ms(`10s`),
      extraOptions: {
        maxRetries: 0,
      },
    }),
  }),
})

export const { useGetBridgeQuoteQuery } = bridgeQuoteApi
