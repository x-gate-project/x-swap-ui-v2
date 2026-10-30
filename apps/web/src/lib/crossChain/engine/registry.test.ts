import { NATIVE_SENTINEL, PRIORITY_STABLECOINS, USDTX, getOftAddress, getOftSymbolByAddress } from 'lib/crossChain/constants'
import { BRIDGE_PROVIDERS, findBridgeProvider, getBridgeProvider, getDestTokens } from 'lib/crossChain/engine/registry'
import { rankIntermediateTokens } from 'lib/crossChain/engine/routing/tokenPriority'
import { waitForBridge, type BridgeProvider, type BridgeStatus } from 'lib/crossChain/bridge'
import { UniverseChainId } from 'uniswap/src/types/chains'

describe('bridge provider registry', () => {
  it('has unique ids', () => {
    expect(new Set(BRIDGE_PROVIDERS.map((p) => p.id)).size).toEqual(BRIDGE_PROVIDERS.length)
  })

  it('getBridgeProvider resolves persisted ids', () => {
    expect(getBridgeProvider('lz').name).toEqual('LayerZero OFT')
    expect(getBridgeProvider('across').name).toEqual('Across')
    expect(getBridgeProvider(undefined).id).toEqual('lz') // legacy tx without bridgeProtocol
    expect(() => getBridgeProvider('relay')).toThrow() // Relay is its own rail, not XChainSender
  })

  it('getOftSymbolByAddress reverses getOftAddress', () => {
    const addr = getOftAddress('USDTX', UniverseChainId.Sepolia)!
    expect(getOftSymbolByAddress(addr.toUpperCase().replace('0X', '0x'), UniverseChainId.Sepolia)).toEqual('USDTX')
    expect(getOftSymbolByAddress('0x0000000000000000000000000000000000000001', UniverseChainId.Sepolia)).toBeUndefined()
  })

  it('routes OFT pairs to LayerZero, everything else to Across', () => {
    const s = UniverseChainId.Sepolia
    const b = UniverseChainId.Base_Sepolia
    expect(findBridgeProvider({ symbol: 'USDTX', chainId: s }, { symbol: 'USDTX', chainId: b }).id).toEqual('lz')
    expect(findBridgeProvider({ symbol: 'usdt', chainId: s }, { symbol: 'JOCX', chainId: b }).id).toEqual('lz')
    expect(findBridgeProvider({ symbol: 'USDC', chainId: s }, { symbol: 'USDC', chainId: b }).id).toEqual('across')
  })

  it('getDestTokens merges providers and survives a failing one', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as jest.Mock
    const dests = await getDestTokens(UniverseChainId.Sepolia, USDTX[UniverseChainId.Sepolia].address)
    expect(dests?.some((t) => t.chainId === UniverseChainId.Base_Sepolia)).toBe(true)
    expect(await getDestTokens(UniverseChainId.Sepolia, '0x000000000000000000000000000000000000dEaD')).toBeNull()
  })
})

describe('waitForBridge', () => {
  const tx = { hash: '0x1', srcChainId: 1 }
  const fake = (...statuses: (BridgeStatus | Error)[]) =>
    ({
      name: 'Fake',
      getStatus: jest.fn(async () => {
        const s = statuses.shift()
        if (s instanceof Error) {throw s}
        return s
      }),
    }) as unknown as BridgeProvider

  // Skip the 5s poll delay.
  beforeEach(() => jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => cb()) as never))
  afterEach(() => jest.restoreAllMocks())

  it('retries pending/errors until filled', async () => {
    const p = fake('pending', new Error('net'), 'filled')
    await expect(waitForBridge(p, tx, new AbortController().signal)).resolves.toBeUndefined()
    expect(p.getStatus).toHaveBeenCalledTimes(3)
  })

  it('rejects on failed and on abort', async () => {
    await expect(waitForBridge(fake('failed'), tx, new AbortController().signal)).rejects.toThrow('Fake bridge failed')
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(waitForBridge(fake('pending'), tx, ctrl.signal)).rejects.toThrow('Aborted')
  })

  it('rejects past deadline', async () => {
    await expect(waitForBridge(fake('pending'), tx, new AbortController().signal, Date.now() - 1)).rejects.toThrow('Timeout')
  })

  it('abort wakes a sleeping poll', async () => {
    jest.restoreAllMocks()
    const ctrl = new AbortController()
    const p = waitForBridge(fake('pending', 'pending'), tx, ctrl.signal)
    await Promise.resolve() // let the first getStatus resolve so the loop is sleeping
    ctrl.abort()
    await expect(p).rejects.toThrow('Aborted')
  })
})

describe('rankIntermediateTokens', () => {
  const chainId = UniverseChainId.Sepolia
  const prio = PRIORITY_STABLECOINS[chainId] ?? []
  const t = (address: string, symbol: string) => ({ address, symbol })

  it('orders same-symbol stable > same-symbol > priority > stable > native > rest, deduped', () => {
    const native = t(NATIVE_SENTINEL.toLowerCase(), 'ETH')
    const other = t('0x00000000000000000000000000000000000000aa', 'FOO')
    const sameSym = t('0x00000000000000000000000000000000000000bb', 'WBTC')
    const stable = t('0x00000000000000000000000000000000000000cc', 'DAI')
    const priority = prio.map((p) => t(p.address, 'PRIO'))
    const input = [other, native, stable, ...priority, sameSym, sameSym]
    expect(rankIntermediateTokens(input, 'wbtc', chainId)).toEqual([sameSym, ...priority, stable, native, other])
  })
})
