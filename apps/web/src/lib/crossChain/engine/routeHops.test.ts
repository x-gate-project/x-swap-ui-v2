import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import type { BridgeQuote, CrossChainLeg } from 'lib/crossChain/aggregator/types'
import { directRouteHops, toRouteHops } from 'lib/crossChain/engine/routeHops'
import type { InterfaceTrade } from 'state/routing/types'

const SELL = new Token(1, '0x0000000000000000000000000000000000000001', 18, 'SELL')
const MID_SRC = new Token(1, '0x0000000000000000000000000000000000000002', 6, 'MIDS')
const MID_DST = new Token(10, '0x0000000000000000000000000000000000000003', 6, 'MIDD')
const BUY = new Token(10, '0x0000000000000000000000000000000000000004', 18, 'BUY')
const LZ = { name: 'LayerZero', logoUrl: '/lz.png' }

const swap = (a: Token, b: Token): CrossChainLeg<InterfaceTrade> => ({ loading: false, inputCurrency: a, outputCurrency: b })
const bridge = (a: Token, b: Token): CrossChainLeg<BridgeQuote> => ({
  loading: false,
  inputCurrency: a,
  outputCurrency: b,
  quote: {
    inputCurrency: a,
    outputCurrency: b,
    inputAmount: CurrencyAmount.fromRawAmount(a, 1),
    outputAmount: CurrencyAmount.fromRawAmount(b, 1),
    bridgeProvider: LZ,
    feePercent: new Percent(1, 100),
  },
})
const shape = (hops: ReturnType<typeof toRouteHops>) => hops.map((h) => `${h.kind}:${h.tokenIn.symbol}>${h.tokenOut.symbol}`)

describe('toRouteHops', () => {
  it('BRIDGE_ONLY', () => {
    const hops = toRouteHops(undefined, bridge(SELL, BUY))
    expect(shape(hops)).toEqual(['bridge:SELL>BUY'])
    expect(hops[0]).toMatchObject({ provider: LZ, feePercent: new Percent(1, 100) })
  })
  it('A: swap -> bridge', () => {
    expect(shape(toRouteHops(swap(SELL, MID_SRC), bridge(MID_SRC, BUY)))).toEqual(['swap:SELL>MIDS', 'bridge:MIDS>BUY'])
  })
  it('B: bridge -> swap', () => {
    expect(shape(toRouteHops(undefined, bridge(SELL, MID_DST), swap(MID_DST, BUY)))).toEqual(['bridge:SELL>MIDD', 'swap:MIDD>BUY'])
  })
  it('C: swap -> bridge -> swap, no pools until quoted', () => {
    const hops = toRouteHops(swap(SELL, MID_SRC), bridge(MID_SRC, MID_DST), swap(MID_DST, BUY))
    expect(shape(hops)).toEqual(['swap:SELL>MIDS', 'bridge:MIDS>MIDD', 'swap:MIDD>BUY'])
    expect(hops[0].pools).toBeUndefined()
  })
})

describe('directRouteHops', () => {
  it('no steps: single bridge hop between the user tokens', () => {
    expect(shape(directRouteHops(undefined, SELL, BUY))).toEqual(['bridge:SELL>BUY'])
  })
  it('steps: ends keep user currencies, middle tokens come from the provider', () => {
    const t = (x: Token) => ({ chainId: x.chainId, address: x.address, symbol: x.symbol!, decimals: x.decimals })
    const hops = directRouteHops(
      [
        { kind: 'swap', tokenIn: t(SELL), tokenOut: t(MID_SRC) },
        { kind: 'bridge', tokenIn: t(MID_SRC), tokenOut: t(BUY) },
      ],
      SELL,
      BUY,
    )
    expect(shape(hops)).toEqual(['swap:SELL>MIDS', 'bridge:MIDS>BUY'])
    expect(hops[0].tokenIn).toBe(SELL)
    expect(hops[1].tokenOut).toBe(BUY)
  })
})
