import { render, screen } from '@testing-library/react'
import { XSwapRouteLegs, xswapLegSummary } from 'components/swap/XSwap/XSwapRouteLegs'
import { XSwapLeg, XSwapToken } from 'state/xswap/types'
import { XSWAP_NATIVE_ADDRESS, xswapTokenKey } from 'state/xswap/utils'
import { ThemeProvider } from 'styled-components'
import { getTheme } from 'theme'

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
const CHAINS = [
  { chainId: 11155111, name: 'Sepolia', nativeSymbol: 'ETH', wrappedNative: WETH },
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
    token(421614, JOCX, 'JOCX', 18),
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
  it('names swaps and the bridge provider in order', () => {
    expect(xswapLegSummary(COMPOSITE)).toBe('Swap → Across → Swap')
  })

  it('is undefined without legs', () => {
    expect(xswapLegSummary(undefined)).toBeUndefined()
    expect(xswapLegSummary([])).toBeUndefined()
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
    expect(items[0]).toHaveTextContent('Sepolia · Uniswap v3 · out 2500 USDC (min 2487.5 USDC)')
    expect(items[1]).toHaveTextContent('Sepolia → Arbitrum Sepolia via Across')
    expect(items[2]).toHaveTextContent('out 5000 JOCX (min 4975 JOCX)')
  })
})
