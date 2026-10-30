import { skipToken } from '@reduxjs/toolkit/query/react'
import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import useDebounce from 'hooks/useDebounce'
import JSBI from 'jsbi'
import type { BridgeQuote } from 'lib/crossChain/aggregator/types'
import { BRIDGE_PROVIDERS } from 'lib/crossChain/engine/registry'
import { toBridgeAddress } from 'lib/crossChain/commandBuilders'
import useNativeCurrency from 'lib/hooks/useNativeCurrency'
import { useMemo } from 'react'
import { useGetBridgeQuoteQuery } from 'state/routing/bridgeQuoteSlice'

const DUMMY_RECIPIENT = '0x0000000000000000000000000000000000dEaD'

function computeFeePercent(inputAmount: CurrencyAmount<Currency>, outputAmount: CurrencyAmount<Currency>): Percent {
  if (JSBI.EQ(inputAmount.quotient, JSBI.BigInt(0))) {return new Percent(0)}
  const feeRaw = JSBI.subtract(inputAmount.quotient, outputAmount.quotient)
  return new Percent(feeRaw, inputAmount.quotient)
}

export interface UseBridgeQuoteResult {
  quote?: BridgeQuote
  loading: boolean
  /** True when the Across `/suggested-fees` call failed (quote unavailable). */
  error: boolean
  /** Human-readable reason for the failure (from the thrown error), for display to the user. */
  errorMessage?: string
}

/**
 * Quotes bridge output via RTK Query (state/routing/bridgeQuoteSlice) — caches by args,
 * dedupes concurrent callers, auto-evicts after keepUnusedDataFor (10s unused).
 * Provider picked by findBridgeProvider; args debounced 500ms (matches useDebouncedTrade pattern).
 */
export function useBridgeQuote(
  inputCurrency: Currency | null | undefined,
  outputCurrency: Currency | null | undefined,
  inputAmount: CurrencyAmount<Currency> | undefined,
  unwrapToOrigin?: boolean,
): UseBridgeQuoteResult {
  const { address: account } = useAccount()
  const srcNativeCurrency = useNativeCurrency(inputCurrency?.chainId)

  const provider = useMemo(
    // No throw: Relay pairs have no XChainSender provider — just skip the quote.
    () => (inputCurrency && outputCurrency ? BRIDGE_PROVIDERS.find((p) => p.supports(inputCurrency, outputCurrency)) : undefined),
    [inputCurrency, outputCurrency],
  )

  const args = useMemo(
    () =>
      provider && inputCurrency && outputCurrency && inputAmount
        ? {
            providerId: provider.id,
            inputToken: toBridgeAddress(inputCurrency),
            outputToken: toBridgeAddress(outputCurrency),
            srcChainId: inputCurrency.chainId,
            dstChainId: outputCurrency.chainId,
            amount: inputAmount.quotient.toString(),
            recipient: account ?? DUMMY_RECIPIENT,
            unwrapToOrigin,
          }
        : skipToken,
    [provider, inputCurrency, outputCurrency, inputAmount, account, unwrapToOrigin],
  )
  const debouncedArgs = useDebounce(args, 500)
  const { data, isFetching, isError, error } = useGetBridgeQuoteQuery(debouncedArgs)

  return useMemo((): UseBridgeQuoteResult => {
    if (!provider || !inputCurrency || !outputCurrency || !inputAmount) {
      return { quote: undefined, loading: false, error: false, errorMessage: undefined }
    }

    if (isError) {
      const errData = error as { error?: string } | undefined
      return {
        quote: undefined,
        loading: isFetching,
        error: true,
        errorMessage: errData?.error ?? 'Bridge quote unavailable',
      }
    }

    if (!data) {
      return { quote: undefined, loading: isFetching, error: false, errorMessage: undefined }
    }

    const outputAmount = CurrencyAmount.fromRawAmount(outputCurrency, data.outputAmount)
    const bridgeFeeRaw = JSBI.subtract(inputAmount.quotient, outputAmount.quotient)
    const quote: BridgeQuote = {
      inputCurrency,
      outputCurrency,
      inputAmount,
      outputAmount,
      bridgeProvider: provider,
      feePercent: computeFeePercent(inputAmount, outputAmount),
      nativeFeeAmount:
        data.nativeFee && srcNativeCurrency ? CurrencyAmount.fromRawAmount(srcNativeCurrency, data.nativeFee) : undefined,
      bridgeFeeAmount: JSBI.greaterThan(bridgeFeeRaw, JSBI.BigInt(0))
        ? CurrencyAmount.fromRawAmount(inputAmount.currency, bridgeFeeRaw)
        : undefined,
    }
    return { quote, loading: isFetching, error: false, errorMessage: undefined }
  }, [provider, inputCurrency, outputCurrency, inputAmount, srcNativeCurrency, data, isFetching, isError, error])
}
