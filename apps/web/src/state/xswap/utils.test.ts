import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import { DAI, USDC_MAINNET, nativeOnChain } from 'constants/tokens'
import { buildXSwapQuoteRequest } from 'state/xswap/hooks'
import {
  XSWAP_NATIVE_ADDRESS,
  getXSwapChainMode,
  getXSwapFlow,
  isSameXSwapToken,
  percentToBps,
  toXSwapAddress,
  xswapTokenToCurrency,
} from 'state/xswap/utils'
import { UniverseChainId } from 'uniswap/src/types/chains'

const SWAPPER = '0x0000000000000000000000000000000000000001'
const ETH = nativeOnChain(UniverseChainId.Mainnet)

describe('toXSwapAddress', () => {
  it('sends the native currency as the zero address', () => {
    expect(toXSwapAddress(ETH)).toBe('0x0000000000000000000000000000000000000000')
  })

  it('sends an ERC-20 as its address', () => {
    expect(toXSwapAddress(USDC_MAINNET)).toBe(USDC_MAINNET.address)
  })
})

describe('xswapTokenToCurrency', () => {
  it('maps the zero address to the chain native currency', () => {
    const currency = xswapTokenToCurrency({
      chainId: UniverseChainId.Mainnet,
      address: XSWAP_NATIVE_ADDRESS,
      symbol: 'ETH',
      decimals: 18,
      class: 'eth',
      available: true,
    })
    expect(currency.isNative).toBe(true)
    expect(currency.equals(ETH)).toBe(true)
  })

  it('maps an ERC-20 to a Token', () => {
    const currency = xswapTokenToCurrency({
      chainId: UniverseChainId.Mainnet,
      address: USDC_MAINNET.address,
      symbol: 'USDC',
      decimals: 6,
      class: 'usdc',
      available: false,
    })
    expect(currency.isToken).toBe(true)
    expect(currency.equals(USDC_MAINNET)).toBe(true)
    expect(currency.decimals).toBe(6)
  })
})

describe('isSameXSwapToken', () => {
  it('is true for the same token on the same chain', () => {
    expect(isSameXSwapToken(USDC_MAINNET, USDC_MAINNET)).toBe(true)
    expect(isSameXSwapToken(ETH, nativeOnChain(UniverseChainId.Mainnet))).toBe(true)
  })

  it('ignores address case', () => {
    const lower = new Token(UniverseChainId.Mainnet, USDC_MAINNET.address.toLowerCase(), 6, 'USDC', 'USDC', true)
    expect(isSameXSwapToken(USDC_MAINNET, lower)).toBe(true)
  })

  it('is false for different tokens or chains', () => {
    expect(isSameXSwapToken(USDC_MAINNET, DAI)).toBe(false)
    expect(isSameXSwapToken(ETH, nativeOnChain(UniverseChainId.Base))).toBe(false)
    const sameAddressOtherChain = new Token(UniverseChainId.Base, USDC_MAINNET.address, 6, 'USDC', 'USDC')
    expect(isSameXSwapToken(USDC_MAINNET, sameAddressOtherChain)).toBe(false)
  })

  it('is false when a side is missing', () => {
    expect(isSameXSwapToken(USDC_MAINNET, undefined)).toBe(false)
    expect(isSameXSwapToken(null, USDC_MAINNET)).toBe(false)
  })
})

describe('getXSwapFlow', () => {
  it('dispatches local to the same-chain flow', () => {
    expect(getXSwapFlow('local')).toBe('same-chain')
  })

  it.each(['evm-native', 'composite', 'joc-same-family', 'joc-cross-family', 'joc-eth-stable-in', 'some-new-class'])(
    'dispatches %s to the cross-chain flow',
    (routeClass) => {
      expect(getXSwapFlow(routeClass)).toBe('cross-chain')
    },
  )
})

describe('percentToBps', () => {
  it('converts a percent to whole basis points', () => {
    expect(percentToBps(new Percent(50, 10_000))).toBe(50)
    expect(percentToBps(new Percent(3, 100))).toBe(300)
  })
})

describe('buildXSwapQuoteRequest', () => {
  const amount = CurrencyAmount.fromRawAmount(ETH, '1000000000000000000')

  it('builds an exact-input request with native as the zero address', () => {
    expect(
      buildXSwapQuoteRequest({
        inputCurrency: ETH,
        outputCurrency: USDC_MAINNET,
        inputAmount: amount,
        swapper: SWAPPER,
        slippage: new Percent(50, 10_000),
      }),
    ).toEqual({
      tokenIn: XSWAP_NATIVE_ADDRESS,
      tokenInChainId: UniverseChainId.Mainnet,
      tokenOut: USDC_MAINNET.address,
      tokenOutChainId: UniverseChainId.Mainnet,
      amount: '1000000000000000000',
      swapper: SWAPPER,
      slippageBps: 50,
    })
  })

  it('leaves slippage to the API when unset', () => {
    const request = buildXSwapQuoteRequest({
      inputCurrency: ETH,
      outputCurrency: USDC_MAINNET,
      inputAmount: amount,
      swapper: SWAPPER,
    })
    expect(request?.slippageBps).toBeUndefined()
  })

  it('does not quote the same token on both sides', () => {
    expect(
      buildXSwapQuoteRequest({ inputCurrency: ETH, outputCurrency: ETH, inputAmount: amount, swapper: SWAPPER }),
    ).toBeUndefined()
  })

  it('does not quote without a swapper, a pair or a positive amount', () => {
    expect(
      buildXSwapQuoteRequest({ inputCurrency: ETH, outputCurrency: USDC_MAINNET, inputAmount: amount }),
    ).toBeUndefined()
    expect(buildXSwapQuoteRequest({ inputCurrency: ETH, inputAmount: amount, swapper: SWAPPER })).toBeUndefined()
    expect(
      buildXSwapQuoteRequest({
        inputCurrency: ETH,
        outputCurrency: USDC_MAINNET,
        inputAmount: CurrencyAmount.fromRawAmount(ETH, 0),
        swapper: SWAPPER,
      }),
    ).toBeUndefined()
  })
})

describe('getXSwapChainMode', () => {
  const chainIds = [UniverseChainId.Sepolia, UniverseChainId.JocTestnet]

  it('uses the API on a chain it enables', () => {
    expect(getXSwapChainMode({ apiEnabled: true, chainId: UniverseChainId.Sepolia, chainIds, loading: false })).toBe(
      'api',
    )
  })

  it('keeps the old flow on a chain the API does not enable', () => {
    expect(getXSwapChainMode({ apiEnabled: true, chainId: UniverseChainId.Mainnet, chainIds, loading: false })).toBe(
      'legacy',
    )
  })

  it('keeps the old flow when the API is off, has no chain list, or there is no chain', () => {
    expect(getXSwapChainMode({ apiEnabled: false, chainId: UniverseChainId.Sepolia, chainIds, loading: false })).toBe(
      'legacy',
    )
    expect(getXSwapChainMode({ apiEnabled: true, chainId: UniverseChainId.Sepolia, loading: false })).toBe('legacy')
    expect(getXSwapChainMode({ apiEnabled: true, chainIds, loading: false })).toBe('legacy')
  })

  it('waits while the chain list loads', () => {
    expect(getXSwapChainMode({ apiEnabled: true, chainId: UniverseChainId.Mainnet, loading: true })).toBe('loading')
  })
})
