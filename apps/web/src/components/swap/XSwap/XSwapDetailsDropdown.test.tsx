import { MockedProvider } from '@apollo/client/testing'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Token } from '@uniswap/sdk-core'
import { XSwapDetailsDropdown } from 'components/swap/XSwap/XSwapDetailsDropdown'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import store from 'state'
import { XSwapLeg, XSwapQuote, XSwapToken } from 'state/xswap/types'
import { xswapTokenKey } from 'state/xswap/utils'
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
const USDC_ARB = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'

const token = (chainId: number, address: string, symbol: string, decimals: number): XSwapToken => ({
  chainId,
  address,
  symbol,
  decimals,
  class: 'native-side',
  available: true,
})
const tokens = new Map(
  [token(11155111, USDC, 'USDC', 6), token(421614, USDC_ARB, 'USDC', 6)].map((t) => [
    xswapTokenKey(t.chainId, t.address),
    t,
  ]),
)
const lookup = (chainId: number, address: string) => tokens.get(xswapTokenKey(chainId, address))

const INPUT = new Token(11155111, USDC, 6, 'USDC')
const OUTPUT = new Token(421614, USDC_ARB, 6, 'USDC')

const SWAP: XSwapLeg = {
  type: 'swap',
  chainId: 11155111,
  tokenIn: USDC,
  tokenOut: WETH,
  amountIn: '10000000',
  expectedOut: '4000000000000000',
  minOut: '3980000000000000',
  venue: 'uniswap-v3',
}
const BRIDGE: XSwapLeg = {
  type: 'bridge',
  provider: 'across',
  tokenInChainId: 11155111,
  tokenOutChainId: 421614,
  tokenIn: USDC,
  tokenOut: USDC_ARB,
  expectedOut: '9990000',
  minOut: '9990000',
  nativeFee: '0',
}
const DEST_SWAP = (venue: 'uniswap-v2' | 'uniswap-v3'): XSwapLeg => ({
  type: 'swap',
  chainId: 421614,
  tokenIn: USDC_ARB,
  tokenOut: USDC_ARB,
  amountIn: '9990000',
  expectedOut: '9980000',
  minOut: '9930000',
  venue,
})

const quote = (quoteId: string, provider: string, legs: XSwapLeg[]): XSwapQuote => ({
  quoteId,
  provider,
  routing: 'CLASSIC' as XSwapQuote['routing'],
  routeClass: 'composite' as XSwapQuote['routeClass'],
  tokenIn: { chainId: 11155111, address: USDC },
  tokenOut: { chainId: 421614, address: USDC_ARB },
  inputAmount: '10000000',
  outputAmount: '9980000',
  minOutputAmount: '9930000',
  priceImpactBps: 10,
  fees: { lp: '0', relayer: '0', gas: '0', app: '0' },
  etaSec: 120,
  expiresAt: Date.now() + 60_000,
  executable: true,
  destSwap: legs.length > 2,
  legs,
  txs: [],
  score: 1,
})

function renderDropdown(routes: XSwapQuote[], selected = routes[0]) {
  render(
    <Provider store={store}>
      <MemoryRouter>
        <MockedProvider showWarnings={false}>
          <ThemeProvider theme={getTheme(false)}>
            <XSwapDetailsDropdown
              routes={routes}
              selected={selected}
              bestQuoteId={routes[0].quoteId}
              inputCurrency={INPUT}
              outputCurrency={OUTPUT}
              lookup={lookup}
              loading={false}
              syncing={false}
              onSelectRoute={jest.fn()}
            />
          </ThemeProvider>
        </MockedProvider>
      </MemoryRouter>
    </Provider>,
  )
  fireEvent.click(screen.getByTestId('xswap-details-header-row'))
}

describe('XSwapDetailsDropdown', () => {
  it('hides the legs of a same-chain swap', () => {
    renderDropdown([quote('q1', 'uniswap', [SWAP])])
    expect(screen.queryByTestId('xswap-route-legs')).not.toBeInTheDocument()
  })

  it('shows the legs of a route with a bridge', () => {
    renderDropdown([quote('q1', 'across', [BRIDGE])])
    expect(screen.getByTestId('xswap-route-legs')).toBeInTheDocument()
  })

  it('names composite routes by their legs, in the order routing row and the route list alike', () => {
    renderDropdown([
      quote('q1', 'composite', [SWAP, BRIDGE, DEST_SWAP('uniswap-v3')]),
      quote('q2', 'composite', [SWAP, BRIDGE, DEST_SWAP('uniswap-v2')]),
      quote('q3', 'across', [BRIDGE]),
    ])
    expect(screen.getByTestId('xswap-route-legs')).toBeInTheDocument()

    const routes = within(screen.getByTestId('xswap-routes'))
    const names = routes.getAllByRole('button').map((button) => button.textContent)
    expect(names[0]).toContain('Uniswap v3 → Across → Uniswap v3')
    expect(names[1]).toContain('Uniswap v3 → Across → Uniswap v2')
    expect(names[2]).toMatch(/^Across ·/)

    // The selected route reads the same in the order routing row.
    expect(screen.getByText('Uniswap v3 → Across → Uniswap v3')).toBeInTheDocument()
  })
})
