import { skipToken } from '@reduxjs/toolkit/query/react'
import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import useDebounce from 'hooks/useDebounce'
import JSBI from 'jsbi'
import { OFT_TOKEN_SYMBOLS } from 'lib/crossChain/constants'
import { toBridgeAddress } from 'lib/crossChain/commandBuilders'
import useNativeCurrency from 'lib/hooks/useNativeCurrency'
import { useMemo } from 'react'
import { useGetAcrossSuggestedFeesQuery, useGetLzFeeQuery } from 'state/routing/bridgeQuoteSlice'

export type BridgeProtocol = 'Across' | 'LayerZero OFT'

const DUMMY_RECIPIENT = '0x0000000000000000000000000000000000dEaD'

export interface BridgeQuote {
  inputCurrency: Currency
  outputCurrency: Currency
  inputAmount: CurrencyAmount<Currency>
  outputAmount: CurrencyAmount<Currency>
  bridgeProtocol: BridgeProtocol
  feePercent: Percent
  nativeFeeAmount?: CurrencyAmount<Currency>
  bridgeFeeAmount?: CurrencyAmount<Currency>
}

function computeFeePercent(inputAmount: CurrencyAmount<Currency>, outputAmount: CurrencyAmount<Currency>): Percent {
  if (JSBI.EQ(inputAmount.quotient, JSBI.BigInt(0))) return new Percent(0)
  const feeRaw = JSBI.subtract(inputAmount.quotient, outputAmount.quotient)
  return new Percent(feeRaw, inputAmount.quotient)
}

export interface UseBridgeQuoteResult {
  quote: BridgeQuote | undefined
  loading: boolean
  /** True when the Across `/suggested-fees` call failed (quote unavailable). */
  error: boolean
  /** Human-readable reason for the failure (from the thrown error), for display to the user. */
  errorMessage?: string
}

/**
 * Quotes bridge output via RTK Query (state/routing/bridgeQuoteSlice) — caches by args,
 * dedupes concurrent callers, auto-evicts after keepUnusedDataFor (10s unused).
 * Across leg debounced 300ms (matches useDebouncedTrade pattern); LZ fee (on-chain read) is not.
 */
export function useBridgeQuote(
  inputCurrency: Currency | null | undefined,
  outputCurrency: Currency | null | undefined,
  inputAmount: CurrencyAmount<Currency> | undefined,
  unwrapToOrigin?: boolean,
): UseBridgeQuoteResult {
  const { address: account } = useAccount()
  const srcNativeCurrency = useNativeCurrency(inputCurrency?.chainId)

  const ready = !!inputCurrency && !!outputCurrency && !!inputAmount
  const isOft =
    ready &&
    (OFT_TOKEN_SYMBOLS.has((inputCurrency!.symbol ?? '').toUpperCase()) ||
      OFT_TOKEN_SYMBOLS.has((outputCurrency!.symbol ?? '').toUpperCase()))

  const oftArgs = useMemo(
    () =>
      ready && isOft && srcNativeCurrency
        ? {
            jocxAddress: toBridgeAddress(inputCurrency!),
            recipient: account ?? DUMMY_RECIPIENT,
            dstChainId: outputCurrency!.chainId.toString(),
            srcChainId: inputCurrency!.chainId,
            unwrapToOrigin,
          }
        : skipToken,
    [ready, isOft, srcNativeCurrency, inputCurrency, outputCurrency, account, unwrapToOrigin],
  )
  const lzFeeQuery = useGetLzFeeQuery(oftArgs)

  const acrossArgs = useMemo(
    () =>
      ready && !isOft
        ? {
            inputToken: toBridgeAddress(inputCurrency!),
            outputToken: toBridgeAddress(outputCurrency!),
            originChainId: inputCurrency!.chainId,
            destinationChainId: outputCurrency!.chainId,
            amount: inputAmount!.quotient.toString(),
          }
        : skipToken,
    [ready, isOft, inputCurrency, outputCurrency, inputAmount],
  )
  const debouncedAcrossArgs = useDebounce(acrossArgs, 500)
  const acrossQuery = useGetAcrossSuggestedFeesQuery(debouncedAcrossArgs)

  return useMemo((): UseBridgeQuoteResult => {
    if (!inputCurrency || !outputCurrency || !inputAmount) {
      return { quote: undefined, loading: false, error: false, errorMessage: undefined }
    }

    if (isOft) {
      const outputAmount = CurrencyAmount.fromRawAmount(outputCurrency, inputAmount.quotient)
      const baseQuote: BridgeQuote = {
        inputCurrency,
        outputCurrency,
        inputAmount,
        outputAmount,
        bridgeProtocol: 'LayerZero OFT',
        feePercent: new Percent(0),
      }
      if (!srcNativeCurrency) {
        return { quote: baseQuote, loading: false, error: false, errorMessage: undefined }
      }
      const quote = lzFeeQuery.data
        ? { ...baseQuote, nativeFeeAmount: CurrencyAmount.fromRawAmount(srcNativeCurrency, lzFeeQuery.data) }
        : baseQuote
      return { quote, loading: lzFeeQuery.isFetching, error: false, errorMessage: undefined }
    }

    if (acrossQuery.isError) {
      const errData = acrossQuery.error as { error?: string } | undefined
      return {
        quote: undefined,
        loading: acrossQuery.isFetching,
        error: true,
        errorMessage: errData?.error ?? 'Bridge quote unavailable',
      }
    }

    if (!acrossQuery.data) {
      return { quote: undefined, loading: acrossQuery.isFetching, error: false, errorMessage: undefined }
    }

    const outputAmount = CurrencyAmount.fromRawAmount(outputCurrency, acrossQuery.data.outputAmount)
    const quote: BridgeQuote = {
      inputCurrency,
      outputCurrency,
      inputAmount,
      outputAmount,
      bridgeProtocol: 'Across',
      feePercent: computeFeePercent(inputAmount, outputAmount),
      bridgeFeeAmount: CurrencyAmount.fromRawAmount(
        inputAmount.currency,
        JSBI.subtract(inputAmount.quotient, outputAmount.quotient),
      ),
    }
    return { quote, loading: acrossQuery.isFetching, error: false, errorMessage: undefined }
  }, [
    inputCurrency,
    outputCurrency,
    inputAmount,
    isOft,
    srcNativeCurrency,
    lzFeeQuery.data,
    lzFeeQuery.isFetching,
    acrossQuery.data,
    acrossQuery.isFetching,
    acrossQuery.isError,
    acrossQuery.error,
  ])
}
