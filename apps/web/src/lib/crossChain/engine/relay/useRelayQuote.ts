import { useQuery } from '@tanstack/react-query'
import { Currency, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import type { BridgeQuote } from 'lib/crossChain/aggregator/types'
import type { UseBridgeQuoteResult } from 'lib/crossChain/engine/useBridgeQuote'
import useDebounce from 'hooks/useDebounce'
import { aggregatorSource, PROVIDER_DISPLAY } from 'lib/crossChain/engine/relay/source'
import { ProviderError, type TokenRef } from 'lib/crossChain/engine/relay/types'
import { useMemo } from 'react'
import { useUserSlippageTolerance } from 'state/user/hooks'
import { SlippageTolerance } from 'state/user/types'
import type { Address } from 'viem'

/** Quote-only depositor while no wallet is connected; execute refuses quotes not built for the signer. */
const QUOTE_ONLY_USER: Address = '0x000000000000000000000000000000000000dEaD'
const REFRESH_BEFORE_EXPIRY_MS = 5_000

const ERROR_TEXT: Partial<Record<ProviderError['code'], string>> = {
  amount_too_low: 'amount too low',
  amount_too_high: 'amount too high',
  rate_limited: 'too many requests, retry shortly',
  rejected: 'route failed safety checks',
  timeout: 'provider timed out',
}

export const tokenRef = (c: Currency): TokenRef => (c.isNative ? 'native' : (c.address as Address))

/** Best Relay quote as a BridgeQuote (raw quote in `directQuote`). 500ms debounce, re-quotes before expiry. */
export function useRelayQuote(
  inputCurrency: Currency | null | undefined,
  outputCurrency: Currency | null | undefined,
  inputAmount: CurrencyAmount<Currency> | undefined,
  enabled: boolean,
): UseBridgeQuoteResult {
  const accountAddress = useAccount().address
  const [slippage] = useUserSlippageTolerance()
  // Auto = provider default slippage.
  const slippageBps =
    slippage === SlippageTolerance.Auto ? undefined : Math.round(Number(slippage.toFixed(4)) * 100)

  // Serializable (no bigint): doubles as the react-query key.
  const args = useMemo(
    () =>
      enabled && inputCurrency && outputCurrency && inputAmount?.greaterThan(0)
        ? {
            user: (accountAddress ?? QUOTE_ONLY_USER) as Address,
            srcChainId: inputCurrency.chainId,
            srcToken: tokenRef(inputCurrency),
            dstChainId: outputCurrency.chainId,
            dstToken: tokenRef(outputCurrency),
            amount: inputAmount.quotient.toString(),
            slippageBps,
          }
        : undefined,
    [enabled, inputCurrency, outputCurrency, inputAmount, accountAddress, slippageBps],
  )
  const debounced = useDebounce(args, 500)

  const { data, error, isFetching } = useQuery({
    queryKey: ['aggregatorQuote', debounced],
    enabled: !!debounced,
    retry: false,
    gcTime: 10_000,
    queryFn: ({ signal }) =>
      aggregatorSource.getQuotes(
        {
          user: debounced!.user,
          src: { chainId: debounced!.srcChainId, token: debounced!.srcToken, amount: BigInt(debounced!.amount) },
          dst: { chainId: debounced!.dstChainId, token: debounced!.dstToken },
          slippageBps: debounced!.slippageBps,
        },
        signal,
      ),
    refetchInterval: (q) => {
      const best = q.state.data?.[0]
      return best ? Math.max(REFRESH_BEFORE_EXPIRY_MS, best.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS) : false
    },
  })

  return useMemo((): UseBridgeQuoteResult => {
    if (!args || !inputCurrency || !outputCurrency) {return { loading: false, error: false }}
    if (args !== debounced) {return { loading: true, error: false }}
    if (error) {
      const reason = error instanceof ProviderError ? ERROR_TEXT[error.code] ?? 'no route found' : 'no route found'
      return { loading: isFetching, error: true, errorMessage: reason }
    }
    const best = data?.[0]
    if (!best) {return { loading: isFetching, error: false }}
    const fee = best.feeAmount > 0n ? best.feeAmount.toString() : undefined
    const quote: BridgeQuote = {
      inputCurrency,
      outputCurrency,
      inputAmount: CurrencyAmount.fromRawAmount(inputCurrency, best.inputAmount.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(outputCurrency, best.expectedOutput.toString()),
      bridgeProvider: PROVIDER_DISPLAY[best.provider],
      feePercent: fee ? new Percent(fee, best.inputAmount.toString()) : new Percent(0),
      bridgeFeeAmount: fee ? CurrencyAmount.fromRawAmount(inputCurrency, fee) : undefined,
      directQuote: best,
    }
    return { quote, loading: isFetching, error: false }
  }, [args, debounced, inputCurrency, outputCurrency, data, error, isFetching])
}
