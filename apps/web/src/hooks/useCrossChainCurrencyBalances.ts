import { Interface } from '@ethersproject/abi'
import { StaticJsonRpcProvider } from '@ethersproject/providers'
import { Currency, CurrencyAmount, Token } from '@uniswap/sdk-core'
import { useEffect, useMemo, useState } from 'react'
import { UNIVERSE_CHAIN_INFO } from 'uniswap/src/constants/chains'
import { InterfaceChainId } from 'uniswap/src/types/chains'

const ERC20_BALANCE_OF_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
]

const ERC20_INTERFACE = new Interface(ERC20_BALANCE_OF_ABI)

/** Cache providers per chainId to avoid re-creating on every render */
const _providerCache: Partial<Record<number, StaticJsonRpcProvider>> = {}

function getProviderForChain(chainId: number): StaticJsonRpcProvider | null {
  if (_providerCache[chainId]) return _providerCache[chainId]!
  const info = UNIVERSE_CHAIN_INFO[chainId as InterfaceChainId]
  const rpcUrl = info?.rpcUrls?.appOnly?.http?.[0] ?? info?.rpcUrls?.default?.http?.[0]
  if (!rpcUrl) return null
  const provider = new StaticJsonRpcProvider(rpcUrl, { chainId, name: info.interfaceName ?? String(chainId) })
  _providerCache[chainId] = provider
  return provider
}

/**
 * Fetches balances for currencies using the RPC of each currency's own chainId.
 * Use this when the wallet is connected to a different chain than the token's chain (cross-chain).
 */
export function useCrossChainCurrencyBalances(
  account?: string,
  currencies?: (Currency | undefined)[],
): (CurrencyAmount<Currency> | undefined)[] {
  const [balances, setBalances] = useState<(CurrencyAmount<Currency> | undefined)[]>([])

  const stableCurrencies = useMemo(() => currencies ?? [], [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(currencies?.map((c) => (c ? `${c.chainId}:${c.isToken ? c.address : 'native'}` : 'undefined'))),
  ])

  useEffect(() => {
    if (!account || stableCurrencies.length === 0) {
      setBalances([])
      return
    }

    let cancelled = false

    async function fetchAll() {
      const results = await Promise.all(
        stableCurrencies.map(async (currency) => {
          if (!currency || !account) return undefined
          const provider = getProviderForChain(currency.chainId)
          if (!provider) return undefined

          try {
            if (currency.isNative) {
              const raw = await provider.getBalance(account)
              return CurrencyAmount.fromRawAmount(currency, raw.toString())
            } else if (currency.isToken) {
              const token = currency as Token
              const data = ERC20_INTERFACE.encodeFunctionData('balanceOf', [account])
              const result = await provider.call({ to: token.address, data })
              const [balance] = ERC20_INTERFACE.decodeFunctionResult('balanceOf', result)
              return CurrencyAmount.fromRawAmount(token, balance.toString())
            }
          } catch {
            return undefined
          }
          return undefined
        }),
      )
      if (!cancelled) setBalances(results)
    }

    fetchAll()
    return () => {
      cancelled = true
    }
  }, [account, stableCurrencies])

  return balances.length === stableCurrencies.length ? balances : stableCurrencies.map(() => undefined)
}
