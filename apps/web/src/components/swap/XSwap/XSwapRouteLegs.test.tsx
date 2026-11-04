import { render, screen } from '@testing-library/react'
import { XSwapRouteLegs, xswapLegSummary, xswapRouteName, xswapShowsLegs } from 'components/swap/XSwap/XSwapRouteLegs'
import { XSwapLeg, XSwapToken } from 'state/xswap/types'
import { XSWAP_NATIVE_ADDRESS, xswapTokenKey } from 'state/xswap/utils'
import { ThemeProvider } from 'styled-components'
import { getTheme } from 'theme'

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const CHAINS = [
  { chainId: 11155111, name: 'Sepolia', nativeSymbol: 'ETH', wrappedNative: WETH },
  {
    chainId: 10081,
    name: 'JOC Testnet',
    nativeSymbol: 'JOC',
    wrappedNative: '0x8B85219c0767Ce4FA5ae5944d71aB4a3De27090d',
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    nativeSymbol: 'ETH',
    wrappedNative: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
  },
]

jest.mock('state/xswap/hooks', () => ({
  useXSwapChains: () => ({ chains: CHAINS, chainIds: CHAINS.map((c) => c.chainId), loading: false }),
}))

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const JOCX = '0xB1660F8CDbf2102Ac74C6CD6d7CD6A65E481e5fe'
const USDTX_JOC = '0x382eb09D8cE59968683001947EF04cB34f7A180E'
const USDCX_JOC = '0x367f476c9B5fA1e64F3d7EE19c3E4E2f76D42200'
// Placeholder: only a lookup key here.
const USDT = '0x5555555555555555555555555555555555555555'
const WJOC = '0x8B85219c0767Ce4FA5ae5944d71aB4a3De27090d'

const token = (chainId: number, address: string, symbol: string, decimals: number): XSwapToken => ({
  chainId,
  address,
  symbol,
  decimals,
  class: 'native-side',
  available: true,
})
const tokens = new Map(
  [
    token(11155111, XSWAP_NATIVE_ADDRESS, 'ETH', 18),
    token(11155111, USDC, 'USDC', 6),
    token(11155111, USDT, 'USDT', 6),
    token(421614, JOCX, 'JOCX', 18),
    token(10081, XSWAP_NATIVE_ADDRESS, 'JOC', 18),
    token(10081, USDTX_JOC, 'USDTX', 6),
    token(10081, USDCX_JOC, 'USDCX', 6),
  ].map((t) => [xswapTokenKey(t.chainId, t.address), t]),
)
// As `useXSwapTokenLookup`: listed tokens only; the component resolves the unlisted wrapped native itself.
const lookup = (chainId: number, address: string) => tokens.get(xswapTokenKey(chainId, address))

// ETH on Sepolia → JOCX on Arbitrum Sepolia: swap into USDC, bridge with Across, swap into JOCX.
const COMPOSITE: XSwapLeg[] = [
  {
    type: 'swap',
    chainId: 11155111,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: '1000000000000000000',
    expectedOut: '2500000000',
    minOut: '2487500000',
    venue: 'uniswap-v3',
    path: { tokens: [WETH, USDC], fees: [500] },
  },
  {
    type: 'bridge',
    provider: 'across',
    tokenInChainId: 11155111,
    tokenOutChainId: 421614,
    tokenIn: USDC,
    tokenOut: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    expectedOut: '2499000000',
    minOut: '2499000000',
    nativeFee: '0',
  },
  {
    type: 'swap',
    chainId: 421614,
    tokenIn: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenOut: JOCX,
    amountIn: '2499000000',
    expectedOut: '5000000000000000000000',
    minOut: '4975000000000000000000',
    venue: 'uniswap-v2',
  },
]

describe('xswapLegSummary', () => {
  it('names swaps by venue and the bridge by provider in order', () => {
    expect(xswapLegSummary(COMPOSITE)).toBe('Uniswap v3 → Across → Uniswap v2')
  })

  it('is undefined without legs', () => {
    expect(xswapLegSummary(undefined)).toBeUndefined()
    expect(xswapLegSummary([])).toBeUndefined()
  })
})

describe('xswapRouteName', () => {
  it('names a composite route by its legs', () => {
    expect(xswapRouteName({ provider: 'composite', legs: COMPOSITE })).toBe('Uniswap v3 → Across → Uniswap v2')
  })

  it('names a single-leg route by its provider', () => {
    expect(xswapRouteName({ provider: 'across', legs: [COMPOSITE[1]] })).toBe('Across')
    expect(xswapRouteName({ provider: 'across' })).toBe('Across')
  })
})

describe('xswapShowsLegs', () => {
  it('hides a same-chain swap', () => {
    expect(xswapShowsLegs(undefined)).toBe(false)
    expect(xswapShowsLegs([COMPOSITE[0]])).toBe(false)
  })

  it('shows any route with a bridge or more than one leg', () => {
    expect(xswapShowsLegs([COMPOSITE[1]])).toBe(true)
    expect(xswapShowsLegs([COMPOSITE[0], COMPOSITE[2]])).toBe(true)
    expect(xswapShowsLegs(COMPOSITE)).toBe(true)
  })
})

describe('XSwapRouteLegs', () => {
  it('renders every leg of a composite route in order', () => {
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs legs={COMPOSITE} lookup={lookup} />
      </ThemeProvider>,
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      'xswap-route-leg-swap',
      'xswap-route-leg-bridge',
      'xswap-route-leg-swap',
    ])
    // The wrapped native on the swap path reads as the native token.
    expect(items[0]).toHaveTextContent('ETH → USDC')
    expect(items[0]).toHaveTextContent('Sepolia · Uniswap v3 · 1 ETH → 2500 USDC (min 2487.5 USDC)')
    // The bridge's minimum equals its expected output: no `(min …)`.
    expect(items[1]).toHaveTextContent('Sepolia → Arbitrum Sepolia via Across')
    expect(items[1]).not.toHaveTextContent('min')
    expect(items[2]).toHaveTextContent('→ 5000 JOCX (min 4975 JOCX)')
  })

  it('shows the LayerZero fee of an XGate bridge', () => {
    // JOCX on Arbitrum Sepolia → ETH on Sepolia over XGate: the LayerZero fee is paid in the source chain's native.
    const xgate: XSwapLeg = {
      type: 'bridge',
      provider: 'xgate',
      tokenInChainId: 421614,
      tokenOutChainId: 11155111,
      tokenIn: JOCX,
      tokenOut: XSWAP_NATIVE_ADDRESS,
      expectedOut: '1000000000000000000',
      minOut: '1000000000000000000',
      nativeFee: '120000000000000',
    }
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs legs={[xgate]} lookup={lookup} />
      </ThemeProvider>,
    )
    expect(screen.getByRole('listitem')).toHaveTextContent('LayerZero fee 0.00012 ETH')
  })

  it('shows no native fee when the bridge charges none', () => {
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs legs={COMPOSITE} lookup={lookup} />
      </ThemeProvider>,
    )
    expect(screen.getAllByRole('listitem')[1]).not.toHaveTextContent('fee')
  })

  // USDTX on JOC → JOCX on Arbitrum Sepolia: a swap on JOC changes the family, then XGate bridges JOC as JOCX.
  it('renders the swap before an XGate bridge with its LayerZero fee', () => {
    const legs: XSwapLeg[] = [
      {
        type: 'swap',
        chainId: 10081,
        tokenIn: USDTX_JOC,
        tokenOut: WJOC,
        amountIn: '10000000',
        expectedOut: '200000000000000000000',
        minOut: '199000000000000000000',
        venue: 'uniswap-v2',
        path: { tokens: [USDTX_JOC, WJOC] },
      },
      // The swap ends in WJOC while XGate takes native JOC: the router unwraps between the legs, so both read as JOC.
      {
        type: 'bridge',
        provider: 'xgate',
        tokenInChainId: 10081,
        tokenOutChainId: 421614,
        tokenIn: XSWAP_NATIVE_ADDRESS,
        tokenOut: JOCX,
        expectedOut: '199000000000000000000',
        minOut: '199000000000000000000',
        nativeFee: '2500000000000000',
      },
    ]
    expect(xswapLegSummary(legs)).toBe('Uniswap v2 → X-Gate')
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs legs={legs} lookup={lookup} />
      </ThemeProvider>,
    )
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('USDTX → JOC')
    expect(items[0]).toHaveTextContent('JOC Testnet · Uniswap v2 · 10 USDTX → 200 JOC')
    expect(items[1]).toHaveTextContent('JOC → JOCX')
    expect(items[1]).toHaveTextContent('JOC Testnet → Arbitrum Sepolia via X-Gate')
    expect(items[1]).toHaveTextContent('LayerZero fee 0.0025 JOC')
  })

  // JOCX on Arbitrum Sepolia → USDTX on JOC: XGate bridges JOCX as JOC, then the LayerZero compose swaps it on JOC.
  it('renders the destination swap after an XGate bridge', () => {
    const legs: XSwapLeg[] = [
      {
        type: 'bridge',
        provider: 'xgate',
        tokenInChainId: 421614,
        tokenOutChainId: 10081,
        tokenIn: JOCX,
        tokenOut: XSWAP_NATIVE_ADDRESS,
        expectedOut: '200000000000000000000',
        minOut: '200000000000000000000',
        nativeFee: '1500000000000000',
      },
      {
        type: 'swap',
        chainId: 10081,
        tokenIn: WJOC,
        tokenOut: USDTX_JOC,
        amountIn: '200000000000000000000',
        expectedOut: '10000000',
        minOut: '9950000',
        venue: 'uniswap-v2',
        path: { tokens: [WJOC, USDTX_JOC] },
      },
    ]
    expect(xswapLegSummary(legs)).toBe('X-Gate → Uniswap v2')
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs legs={legs} lookup={lookup} />
      </ThemeProvider>,
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual([
      'xswap-route-leg-bridge',
      'xswap-route-leg-swap',
    ])
    expect(items[0]).toHaveTextContent('JOCX → JOC')
    expect(items[0]).toHaveTextContent('Arbitrum Sepolia → JOC Testnet via X-Gate')
    // The LayerZero fee is paid in the source chain's native token.
    expect(items[0]).toHaveTextContent('LayerZero fee 0.0015 ETH')
    expect(items[1]).toHaveTextContent('JOC → USDTX')
    expect(items[1]).toHaveTextContent('JOC Testnet · Uniswap v2 · 200 JOC → 10 USDTX (min 9.95 USDTX)')
  })

  // Real USDT on Sepolia → USDTX on JOC: XGate locks the real stable, one bridge leg across families.
  it('renders the XGate lock of the real stable', () => {
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs
          legs={[
            {
              type: 'bridge',
              provider: 'xgate',
              tokenInChainId: 11155111,
              tokenOutChainId: 10081,
              tokenIn: USDT,
              tokenOut: USDTX_JOC,
              expectedOut: '10000000',
              minOut: '10000000',
              nativeFee: '2500000000000000',
            },
          ]}
          lookup={lookup}
        />
      </ThemeProvider>,
    )
    const [leg] = screen.getAllByRole('listitem')
    expect(leg).toHaveTextContent('USDT → USDTX')
    expect(leg).toHaveTextContent('Sepolia → JOC Testnet via X-Gate · out 10 USDTX')
    expect(leg).not.toHaveTextContent('(min')
    expect(leg).toHaveTextContent('LayerZero fee 0.0025 ETH')
  })

  // USDCX on JOC → real USDC on Sepolia: XGate burns USDCX for the real stable, one bridge leg across families.
  it('renders the XGate burn to the real stable', () => {
    render(
      <ThemeProvider theme={getTheme(false)}>
        <XSwapRouteLegs
          legs={[
            {
              type: 'bridge',
              provider: 'xgate',
              tokenInChainId: 10081,
              tokenOutChainId: 11155111,
              tokenIn: USDCX_JOC,
              tokenOut: USDC,
              expectedOut: '10000000',
              minOut: '10000000',
              nativeFee: '1000000000000000',
            },
          ]}
          lookup={lookup}
        />
      </ThemeProvider>,
    )
    const [leg] = screen.getAllByRole('listitem')
    expect(leg).toHaveTextContent('USDCX → USDC')
    expect(leg).toHaveTextContent('JOC Testnet → Sepolia via X-Gate · out 10 USDC')
    expect(leg).not.toHaveTextContent('(min')
    expect(leg).toHaveTextContent('LayerZero fee 0.001 JOC')
  })
})
