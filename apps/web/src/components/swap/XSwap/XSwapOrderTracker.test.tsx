import { render, screen } from '@testing-library/react'
import { XSwapOrderTracker } from 'components/swap/XSwap/XSwapOrderTracker'
import { XSwapOrder, XSwapToken } from 'state/xswap/types'
import { XSWAP_NATIVE_ADDRESS, xswapTokenKey } from 'state/xswap/utils'
import { ThemeProvider } from 'styled-components'
import { getTheme } from 'theme'

const CHAINS = [
  {
    chainId: 10081,
    name: 'JOC Testnet',
    nativeSymbol: 'JOC',
    wrappedNative: '0x8B85219c0767Ce4FA5ae5944d71aB4a3De27090d',
    explorerUrl: 'https://explorer.testnet.japanopenchain.org',
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    nativeSymbol: 'ETH',
    wrappedNative: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
]

const JOCX = '0xB1660F8CDbf2102Ac74C6CD6d7CD6A65E481e5fe'
const USDTX_JOC = '0x382eb09D8cE59968683001947EF04cB34f7A180E'

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
    token(421614, JOCX, 'JOCX', 18),
    token(10081, XSWAP_NATIVE_ADDRESS, 'JOC', 18),
    token(10081, USDTX_JOC, 'USDTX', 6),
  ].map((t) => [xswapTokenKey(t.chainId, t.address), t]),
)

jest.mock('state/xswap/hooks', () => ({
  ...jest.requireActual('state/xswap/hooks'),
  useXSwapChains: () => ({ chains: CHAINS, chainIds: CHAINS.map((c) => c.chainId), loading: false }),
  useXSwapOrder: () => ({ data: undefined }),
  useXSwapTokenLookup: () => (chainId: number, address: string) => tokens.get(xswapTokenKey(chainId, address)),
}))

const FILL_TX = `0x${'1'.repeat(64)}`
const COMPOSE_TX = `0x${'2'.repeat(64)}`

// JOCX on Arbitrum Sepolia → USDTX on JOC: XGate delivers JOC, then the LayerZero compose swaps it into USDTX.
const ORDER: XSwapOrder = {
  id: 'order-1',
  quoteId: 'quote-1',
  provider: 'xgate',
  routeClass: 'joc-cross-family',
  swapper: '0x0000000000000000000000000000000000000001',
  tokenIn: { chainId: 421614, address: JOCX, amount: '200000000000000000000' },
  tokenOut: { chainId: 10081, address: USDTX_JOC },
  outputAmount: '10000000',
  minOutputAmount: '9950000',
  actualOutputAmount: '10000000',
  status: 'FILLED',
  state: 'success',
  stuck: false,
  verified: true,
  originTxHash: `0x${'0'.repeat(64)}`,
  fillTxHash: FILL_TX,
  composeTxHash: COMPOSE_TX,
  lzGuid: `0x${'3'.repeat(64)}`,
  fillDeadline: null,
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:01:00Z',
}

const renderTracker = (order: XSwapOrder) =>
  render(
    <ThemeProvider theme={getTheme(false)}>
      <XSwapOrderTracker order={order} onClose={jest.fn()} />
    </ThemeProvider>,
  )

describe('XSwapOrderTracker', () => {
  it('links the destination swap tx on the destination chain', () => {
    renderTracker(ORDER)
    expect(screen.getByText('Destination swap tx')).toBeInTheDocument()
    const link = screen.getByText('0x222222…222222').closest('a')
    expect(link).toHaveAttribute('href', `https://explorer.testnet.japanopenchain.org/tx/${COMPOSE_TX}`)
  })

  it('hides the destination swap tx when the route has no compose', () => {
    renderTracker({ ...ORDER, composeTxHash: undefined })
    expect(screen.queryByText('Destination swap tx')).not.toBeInTheDocument()
  })
})
