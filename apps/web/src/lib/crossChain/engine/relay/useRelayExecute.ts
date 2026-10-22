import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import { useAccount } from 'hooks/useAccount'
import type { AggregatorExecution, ExecuteStatus } from 'lib/crossChain/aggregator/types'
import { tokenRef } from 'lib/crossChain/engine/relay/useRelayQuote'
import { buildApprovals } from 'lib/crossChain/engine/relay/allowlist'
import { aggregatorSource } from 'lib/crossChain/engine/relay/source'
import type { Quote } from 'lib/crossChain/engine/relay/types'
import { useCallback, useState } from 'react'
import { useAppDispatch } from 'state/hooks'
import { addTransaction } from 'state/transactions/reducer'
import { TransactionType } from 'state/transactions/types'
import { currencyId } from 'utils/currencyId'
import { erc20Abi, isAddressEqual } from 'viem'
import { useConfig } from 'wagmi'
import { readContract, sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions'

/**
 * Executes an aggregator quote: exact-amount approvals (from on-chain allowance, never the provider's
 * max approval), then the validated deposit tx, then registers the order and records the tx for polling.
 */
export function useRelayExecute(
  quote: Quote | undefined,
  inputCurrency: Currency | null | undefined,
  outputCurrency: Currency | null | undefined,
  inputAmount: CurrencyAmount<Currency> | undefined,
): AggregatorExecution {
  const { chainId } = useAccount()
  const account = useAccount().address
  const wagmiConfig = useConfig()
  const dispatch = useAppDispatch()
  const [status, setStatus] = useState<ExecuteStatus>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError] = useState<Error | undefined>()

  const reset = useCallback(() => {
    setStatus('idle')
    setTxHash(undefined)
    setError(undefined)
  }, [])

  const execute = useCallback(async (): Promise<`0x${string}` | undefined> => {
    setStatus('pending')
    setError(undefined)
    try {
      if (!quote || !account || !inputCurrency || !outputCurrency || !inputAmount) {
        throw new Error('Missing quote, wait for a new quote')
      }
      if (!isAddressEqual(quote.user, account)) {throw new Error('Quote was built for another account, wait for a new quote')}
      if (Date.now() > quote.expiresAt) {throw new Error('Quote expired, wait for a new quote')}
      if (quote.inputAmount.toString() !== inputAmount.quotient.toString()) {throw new Error('Amount changed, wait for a new quote')}
      const src = inputCurrency.chainId
      const deposit = quote.txs.find((t) => t.kind === 'deposit')
      if (!deposit || deposit.chainId !== src) {throw new Error('Deposit tx is not on the source chain')}

      if (chainId !== src) {await switchChain(wagmiConfig, { chainId: src })}

      const srcRef = { chainId: src, token: tokenRef(inputCurrency), amount: quote.inputAmount }
      if (srcRef.token !== 'native') {
        const allowance = await readContract(wagmiConfig, {
          address: srcRef.token,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, deposit.to],
          chainId: src,
        })
        for (const tx of buildApprovals(srcRef, deposit.to, allowance)) {
          const hash = await sendTransaction(wagmiConfig, { to: tx.to, data: tx.data, chainId: src })
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: src })
          if (receipt.status !== 'success') {throw new Error('Token approval failed')}
        }
      }

      const hash = await sendTransaction(wagmiConfig, {
        to: deposit.to,
        data: deposit.data,
        value: deposit.value,
        chainId: src,
      })
      // Best-effort: the deposit is already sent, a registration failure must not hide it.
      const orderId = await aggregatorSource.registerOrder(quote, hash).catch(() => hash)

      dispatch(
        addTransaction({
          hash,
          from: account,
          chainId: src,
          info: {
            type: TransactionType.CROSS_CHAIN_SWAP,
            inputCurrencyId: currencyId(inputCurrency),
            outputCurrencyId: currencyId(outputCurrency),
            inputCurrencyAmountRaw: quote.inputAmount.toString(),
            expectedOutputCurrencyAmountRaw: quote.expectedOutput.toString(),
            srcChainId: src,
            dstChainId: outputCurrency.chainId,
            bridgeProtocol: quote.provider,
            aggregatorOrderId: orderId,
          },
        }),
      )
      setTxHash(hash)
      setStatus('success')
      return hash
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setStatus('error')
      throw e
    }
  }, [quote, account, chainId, inputCurrency, outputCurrency, inputAmount, wagmiConfig, dispatch])

  return { execute, status, txHash, error, reset }
}
