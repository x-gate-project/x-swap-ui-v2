import { buildApprovals, validateDeposit } from 'lib/crossChain/engine/relay/allowlist'
import { mapRelayStatus, normalizeRelay, type RelayQuoteResponse } from 'lib/crossChain/engine/relay/relay'
import { directSource } from 'lib/crossChain/engine/relay'
import type { SwapRequest } from 'lib/crossChain/engine/relay/types'
import { isRelayPair, trackerFor } from 'lib/crossChain/engine/pickRail'
import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, maxUint256 } from 'viem'
import { UniverseChainId } from 'uniswap/src/types/chains'

// Shapes recorded from live POST /quote (Relay), 2026-10-13, ARB USDC -> BASE USDC.
const USER = '0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D'
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const RELAY_DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31'
const EVIL = '0x000000000000000000000000000000000000bEEF'

const req: SwapRequest = {
  user: USER,
  src: { chainId: UniverseChainId.ArbitrumOne, token: ARB_USDC, amount: 1_000_000n },
  dst: { chainId: UniverseChainId.Base, token: BASE_USDC },
}
const approveData = (spender: string, amount = maxUint256) =>
  encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender as `0x${string}`, amount] })

const relay = (depositTo = RELAY_DEPOSITORY, spender = RELAY_DEPOSITORY): RelayQuoteResponse => ({
  steps: [
    { id: 'approve', kind: 'transaction', items: [{ data: { chainId: 42161, to: ARB_USDC, data: approveData(spender, 1n) } }] },
    { id: 'deposit', kind: 'transaction', requestId: '0x1791', items: [{ data: { chainId: 42161, to: depositTo, data: '0xe8017952', value: '0' } }] },
  ],
  details: { currencyIn: { amount: '1000000' }, currencyOut: { amount: '978911', minimumAmount: '938874' }, timeEstimate: 2 },
})

describe('relay rail', () => {
  it('normalizes Relay: requestId as quote id, single deposit', () => {
    const q = normalizeRelay(req, relay())
    expect(q).toMatchObject({ provider: 'relay', quoteId: '0x1791', minOutput: 938874n, expectedOutput: 978911n })
    expect(q.txs.map((t) => t.kind)).toEqual(['deposit'])
  })

  // Steps recorded from live APIs 2026-10-13, ARB WETH -> BASE USDC (trimmed to the fields we read).
  const WETH = { chainId: 42161, address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18 }
  const BASE_USDC_T = { chainId: 8453, address: BASE_USDC, symbol: 'USDC', decimals: 6 }

  it('maps Relay details.route: pass-through legs are not swaps', () => {
    const ETH = { chainId: 42161, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 }
    const r = relay()
    r.details.route = {
      origin: { inputCurrency: { currency: WETH }, outputCurrency: { currency: ETH } },
      destination: { inputCurrency: { currency: BASE_USDC_T }, outputCurrency: { currency: { ...BASE_USDC_T, address: BASE_USDC.toLowerCase() } } },
    }
    expect(normalizeRelay(req, r).route).toEqual([
      { kind: 'swap', tokenIn: WETH, tokenOut: ETH },
      { kind: 'bridge', tokenIn: ETH, tokenOut: BASE_USDC_T },
    ])
  })

  it('rejects unknown deposit target', () => {
    expect(() => normalizeRelay(req, relay(EVIL, EVIL))).toThrow('rejected')
  })

  it('rejects approval spender != deposit target', () => {
    expect(() => normalizeRelay(req, relay(RELAY_DEPOSITORY, EVIL))).toThrow('rejected')
  })

  it('rejects wrong chain, changed amount, unexpected msg.value', () => {
    const d = { chainId: 42161, kind: 'deposit' as const, to: RELAY_DEPOSITORY as `0x${string}`, data: '0x' as const, value: 0n }
    expect(() => validateDeposit('relay', req, { ...d, chainId: 8453 }, [], 1_000_000n)).toThrow('rejected')
    expect(() => validateDeposit('relay', req, d, [], 999_999n)).toThrow('rejected')
    expect(() => validateDeposit('relay', req, { ...d, value: 1n }, [], 1_000_000n)).toThrow('rejected')
  })

  it('builds exact approvals, never unlimited, USDT reset first', () => {
    expect(buildApprovals(req.src, RELAY_DEPOSITORY, 1_000_000n)).toEqual([])
    const [a] = buildApprovals(req.src, RELAY_DEPOSITORY, 0n)
    expect(decodeFunctionData({ abi: erc20Abi, data: a.data }).args).toEqual([getAddress(RELAY_DEPOSITORY), 1_000_000n])

    const usdt = { chainId: UniverseChainId.Mainnet, token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const, amount: 5n }
    expect(buildApprovals(usdt, RELAY_DEPOSITORY, 1n).map((t) => t.kind)).toEqual(['approve-reset', 'approve'])
    expect(buildApprovals(usdt, RELAY_DEPOSITORY, 0n).map((t) => t.kind)).toEqual(['approve'])
  })

  it('maps Relay status', () => {
    expect(mapRelayStatus('success')).toBe('FILLED')
    expect(mapRelayStatus('refund')).toBe('REFUNDED')
    expect(mapRelayStatus('pending')).toBe('DEPOSITED')
    expect(mapRelayStatus('???')).toBeUndefined()
  })

  it('getQuotes returns the validated Relay quote', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(relay()) })) as unknown as typeof fetch
    const quotes = await directSource.getQuotes(req, new AbortController().signal)
    expect(quotes.map((q) => q.provider)).toEqual(['relay'])
  })

  it('isRelayPair: JOC/OFT go to LayerZero, AcrossAdapter chains to Across, rest to Relay', () => {
    const arb = { chainId: UniverseChainId.ArbitrumOne, symbol: 'USDC' }
    const base = { chainId: UniverseChainId.Base, symbol: 'USDC' }
    expect(isRelayPair(arb, base)).toBe(true)
    expect(isRelayPair(arb, { chainId: UniverseChainId.JocMainnet, symbol: 'USDC' })).toBe(false)
    expect(isRelayPair(arb, { ...base, symbol: 'USDTX' })).toBe(false)
    expect(isRelayPair(arb, { ...arb })).toBe(false)
    expect(isRelayPair({ chainId: UniverseChainId.Avalanche_Fuji, symbol: 'USDC' }, base)).toBe(false)
    const sep = { chainId: UniverseChainId.Sepolia, symbol: 'USDC' }
    expect(isRelayPair(sep, { chainId: UniverseChainId.Base_Sepolia, symbol: 'USDC' })).toBe(false) // AcrossAdapter on both
  })

  it('trackerFor: relay by order id (tx hash fallback); across/lz/unset go to XChainSender providers', async () => {
    const spy = jest.spyOn(directSource, 'getOrderStatus').mockResolvedValue('FILLED')
    const tracker = trackerFor({ bridgeProtocol: 'relay' }, '0xabc')
    await expect(tracker.getStatus({ hash: '0xabc', srcChainId: 1 })).resolves.toBe('filled')
    expect(spy).toHaveBeenCalledWith({ provider: 'relay', id: '0xabc', srcChainId: 1 })
    trackerFor({ bridgeProtocol: 'relay', aggregatorOrderId: 'r1' }, '0xabc').getStatus({ hash: '0xabc', srcChainId: 1 })
    expect(spy).toHaveBeenLastCalledWith({ provider: 'relay', id: 'r1', srcChainId: 1 })
    expect(trackerFor({ bridgeProtocol: 'across' }, '0xabc').name).toBe('Across')
    expect(trackerFor({}, '0xabc').name).toBe(trackerFor({ bridgeProtocol: 'lz' }, '0xabc').name)
    spy.mockRestore()
  })
})

