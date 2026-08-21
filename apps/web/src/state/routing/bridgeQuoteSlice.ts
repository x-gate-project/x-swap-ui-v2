import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import { wagmiConfig } from 'components/Web3Provider/wagmi'
import { fetchAcrossSuggestedFees } from 'lib/crossChain/bridge/across'
import { quoteLzFee } from 'lib/crossChain/bridge/layerZero'
import ms from 'ms'

// RTK Query args must be serializable — bigint fields passed as strings, re-widened in queryFn.
export interface GetAcrossSuggestedFeesArgs {
  inputToken: string
  outputToken: string
  originChainId: number
  destinationChainId: number
  amount: string
}

export interface AcrossSuggestedFeesResult {
  outputAmount: string
  quoteTimestamp: number
  fillDeadline: number
  exclusiveRelayer: `0x${string}`
  exclusivityDeadline: number
}

export interface GetLzFeeArgs {
  jocxAddress: string
  recipient: string
  dstChainId: string
  srcChainId: number
  unwrapToOrigin?: boolean
}

export const bridgeQuoteApi = createApi({
  reducerPath: 'bridgeQuoteApi',
  baseQuery: fetchBaseQuery(),
  endpoints: (build) => ({
    getAcrossSuggestedFees: build.query<AcrossSuggestedFeesResult, GetAcrossSuggestedFeesArgs>({
      async queryFn({ inputToken, outputToken, originChainId, destinationChainId, amount }) {
        try {
          const quote = await fetchAcrossSuggestedFees(
            inputToken,
            outputToken,
            originChainId,
            destinationChainId,
            BigInt(amount),
          )
          return { data: { ...quote, outputAmount: quote.outputAmount.toString() } }
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
    getLzFee: build.query<string, GetLzFeeArgs>({
      async queryFn({ jocxAddress, recipient, dstChainId, srcChainId, unwrapToOrigin }) {
        try {
          const fee = await quoteLzFee(
            jocxAddress,
            recipient,
            BigInt(dstChainId),
            srcChainId,
            wagmiConfig,
            unwrapToOrigin,
          )
          return { data: fee.toString() }
        } catch (error) {
          return {
            error: { status: 'CUSTOM_ERROR' as const, error: error instanceof Error ? error.message : 'LZ fee quote unavailable' },
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

export const { useGetAcrossSuggestedFeesQuery, useGetLzFeeQuery } = bridgeQuoteApi
export const useGetAcrossSuggestedFeesQueryState = bridgeQuoteApi.endpoints.getAcrossSuggestedFees.useQueryState
export const useGetLzFeeQueryState = bridgeQuoteApi.endpoints.getLzFee.useQueryState
