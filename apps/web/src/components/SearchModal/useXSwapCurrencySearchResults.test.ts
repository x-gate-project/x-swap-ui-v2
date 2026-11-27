import { renderHook } from '@testing-library/react'
import { Token } from '@uniswap/sdk-core'
import { CurrencyListRow } from 'components/SearchModal/CurrencyList'
import { useXSwapCurrencySearchResults } from 'components/SearchModal/useXSwapCurrencySearchResults'
import { XSwapTokenEntry, useXSwapTokenCurrencies } from 'state/xswap/hooks'
import { XSwapToken } from 'state/xswap/types'

jest.mock('state/xswap/hooks', () => ({ useXSwapTokenCurrencies: jest.fn() }))
jest.mock('state/swap/hooks', () => ({ useSwapAndLimitContext: () => ({ chainId: 11155111 }) }))
jest.mock('hooks/useTokenBalances', () => ({ useTokenBalances: () => ({ balanceMap: {} }) }))

const SEPOLIA = 11155111
const CIRCLE_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const STARGATE_USDC = '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590'

const apiToken = (address: string, name?: string): XSwapToken => ({
  chainId: SEPOLIA,
  address,
  symbol: 'USDC',
  ...(name && { name }),
  decimals: 6,
  class: 'native-side',
  available: true,
})

describe('useXSwapCurrencySearchResults token names', () => {
  // Both come from the local token lists: the rows reuse those instances, which the whole app shares.
  const circle = new Token(SEPOLIA, CIRCLE_USDC, 6, 'USDC', 'USDC')
  const stargate = new Token(SEPOLIA, STARGATE_USDC, 6, 'USDC', 'USDC')
  const entries: XSwapTokenEntry[] = [
    { token: apiToken(CIRCLE_USDC), currency: circle },
    { token: apiToken(STARGATE_USDC, 'Stargate USDC (testnet)'), currency: stargate },
  ]

  beforeEach(() => {
    ;(useXSwapTokenCurrencies as jest.Mock).mockReturnValue({ entries, loading: false })
  })

  const rowOf = (rows: CurrencyListRow[], address: string) =>
    rows.find((row) => row.currency?.isToken && row.currency.address === address)

  it('labels a row with the api name and keeps the shared list instance as it is', () => {
    const { result } = renderHook(() => useXSwapCurrencySearchResults({}))
    const row = rowOf(result.current.allCurrencyRows, STARGATE_USDC)

    expect(row?.options?.name).toBe('Stargate USDC (testnet)')
    expect(row?.currency).toBe(stargate)
    expect(stargate.name).toBe('USDC')
  })

  it('leaves the row name to the currency when the api omits it', () => {
    const { result } = renderHook(() => useXSwapCurrencySearchResults({}))
    const row = rowOf(result.current.allCurrencyRows, CIRCLE_USDC)

    expect(row?.options?.name).toBeUndefined()
    expect(row?.currency).toBe(circle)
  })

  it('matches the api name in the search', () => {
    const { result } = renderHook(() => useXSwapCurrencySearchResults({ searchQuery: 'stargate' }))

    expect(rowOf(result.current.allCurrencyRows, STARGATE_USDC)).toBeDefined()
    expect(rowOf(result.current.allCurrencyRows, CIRCLE_USDC)).toBeUndefined()
  })
})
