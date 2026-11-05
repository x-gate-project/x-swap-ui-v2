import { CurrencyAmount, Percent, Token } from '@uniswap/sdk-core'
import { DAI, USDC_MAINNET, nativeOnChain } from 'constants/tokens'
import { buildXSwapQuoteRequest } from 'state/xswap/hooks'
import { XSwapQuote, XSwapToken } from 'state/xswap/types'
import {
  XSWAP_NATIVE_ADDRESS,
  buildXSwapReachability,
  formatXSwapEta,
  formatXSwapUnits,
  getXSwapChainMode,
  getXSwapDestinationStatus,
  getXSwapFlow,
  getXSwapOutputChainId,
  isSameXSwapToken,
  layerZeroScanUrl,
  percentToBps,
  pickDefaultXSwapRoute,
  resolveXSwapLegToken,
  shortenXSwapHash,
  toXSwapAddress,
  xswapBridgeNativeFee,
  xswapExplorerTxUrl,
  xswapNativeValue,
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

describe('formatXSwapUnits', () => {
  it('formats base units with at most 6 decimals', () => {
    expect(formatXSwapUnits('1500000', 6)).toBe('1.5')
    expect(formatXSwapUnits('1000000000000000000', 18)).toBe('1')
    expect(formatXSwapUnits('1234567891', 9)).toBe('1.234567')
    expect(formatXSwapUnits('0', 18)).toBe('0')
    expect(formatXSwapUnits('1', 18, 0)).toBe('<1')
  })

  it('shows dust as <0.000001', () => {
    expect(formatXSwapUnits('1', 18)).toBe('<0.000001')
  })

  it('returns a non-integer as is', () => {
    expect(formatXSwapUnits('abc', 18)).toBe('abc')
  })
})

describe('formatXSwapEta', () => {
  it('formats seconds and minutes', () => {
    expect(formatXSwapEta(45)).toBe('45s')
    expect(formatXSwapEta(90)).toBe('1m 30s')
    expect(formatXSwapEta(120)).toBe('2m')
    expect(formatXSwapEta(119.6)).toBe('2m')
    expect(formatXSwapEta(59.6)).toBe('1m')
  })
})

describe('xswapExplorerTxUrl', () => {
  it('links the tx on the given explorer', () => {
    expect(xswapExplorerTxUrl('0xabc', 'https://sepolia.arbiscan.io')).toBe('https://sepolia.arbiscan.io/tx/0xabc')
    expect(xswapExplorerTxUrl('0xabc', 'https://etherscan.io/')).toBe('https://etherscan.io/tx/0xabc')
  })

  it('returns undefined without an explorer', () => {
    expect(xswapExplorerTxUrl('0xabc')).toBeUndefined()
  })
})

describe('shortenXSwapHash', () => {
  it('keeps both ends', () => {
    expect(shortenXSwapHash('0x1234567890abcdef')).toBe('0x1234…cdef')
    expect(shortenXSwapHash('0x12')).toBe('0x12')
  })
})

describe('xswapTokenToCurrency on a chain the app does not know', () => {
  const token = {
    chainId: 421614,
    address: XSWAP_NATIVE_ADDRESS,
    symbol: 'ETH',
    decimals: 18,
    class: 'native',
    available: true,
  }

  it('wraps native to the API wrappedNative', () => {
    const weth = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'
    const currency = xswapTokenToCurrency(token, weth)
    expect(currency.isNative).toBe(true)
    expect(currency.wrapped.address).toBe(weth)
    expect(xswapTokenToCurrency(token, weth)).toBe(currency)
  })
})

describe('x-swap reachability', () => {
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  const BASE_SEPOLIA = 84532
  const BASE_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
  const input = { chainId: UniverseChainId.Mainnet, address: USDC_MAINNET.address }

  it('marks a token executable when any of its routes is', () => {
    const reachability = buildXSwapReachability(
      [
        { chainId: BASE_SEPOLIA, address: BASE_USDC, routeClass: 'evm-native', executable: false },
        { chainId: BASE_SEPOLIA, address: BASE_USDC.toLowerCase(), routeClass: 'composite', executable: true },
        { chainId: UniverseChainId.Mainnet, address: DAI.address, routeClass: 'local', executable: false },
      ],
      input,
    )
    const baseUsdc = new Token(BASE_SEPOLIA, BASE_USDC, 6, 'USDC')
    expect(getXSwapDestinationStatus(reachability, baseUsdc)).toBe('executable')
    expect(getXSwapDestinationStatus(reachability, DAI)).toBe('quote-only')
    expect(getXSwapDestinationStatus(reachability, ETH)).toBe('unreachable')
    expect([...reachability.chainIds].sort()).toEqual([UniverseChainId.Mainnet, BASE_SEPOLIA].sort())
  })

  it('treats the native currency as the zero address', () => {
    const reachability = buildXSwapReachability(
      [{ chainId: UniverseChainId.Mainnet, address: XSWAP_NATIVE_ADDRESS, routeClass: 'local', executable: true }],
      input,
    )
    expect(getXSwapDestinationStatus(reachability, ETH)).toBe('executable')
  })

  it('keeps the wrap and unwrap the API does not list', () => {
    const fromNative = buildXSwapReachability([], {
      chainId: UniverseChainId.Mainnet,
      address: XSWAP_NATIVE_ADDRESS,
      wrappedNative: WETH,
    })
    expect(getXSwapDestinationStatus(fromNative, new Token(UniverseChainId.Mainnet, WETH, 18, 'WETH'))).toBe(
      'executable',
    )
    expect(fromNative.chainIds.has(UniverseChainId.Mainnet)).toBe(true)

    const fromWrapped = buildXSwapReachability([], {
      chainId: UniverseChainId.Mainnet,
      address: WETH.toLowerCase(),
      wrappedNative: WETH,
    })
    expect(getXSwapDestinationStatus(fromWrapped, ETH)).toBe('executable')

    const fromOther = buildXSwapReachability([], { ...input, wrappedNative: WETH })
    expect(fromOther.tokens.size).toBe(0)
    expect(fromOther.chainIds.size).toBe(0)
  })

  describe('getXSwapOutputChainId', () => {
    const reachability = buildXSwapReachability(
      [{ chainId: BASE_SEPOLIA, address: BASE_USDC, routeClass: 'evm-native', executable: true }],
      input,
    )
    const chainIds = [UniverseChainId.Mainnet, 10081, BASE_SEPOLIA]

    it('keeps the preferred chain while it has a reachable token', () => {
      expect(getXSwapOutputChainId({ preferredChainId: BASE_SEPOLIA, chainIds, reachability })).toBe(BASE_SEPOLIA)
    })

    it('moves to the first chain with a reachable token', () => {
      expect(getXSwapOutputChainId({ preferredChainId: UniverseChainId.Mainnet, chainIds, reachability })).toBe(
        BASE_SEPOLIA,
      )
    })

    it('keeps the preferred chain without reachability or when nothing is reachable', () => {
      expect(getXSwapOutputChainId({ preferredChainId: 10081, chainIds })).toBe(10081)
      expect(
        getXSwapOutputChainId({
          preferredChainId: 10081,
          chainIds,
          reachability: buildXSwapReachability([], input),
        }),
      ).toBe(10081)
    })
  })
})

describe('resolveXSwapLegToken', () => {
  const WETH = '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73'
  const chains = [{ chainId: 421614, name: 'Arbitrum Sepolia', nativeSymbol: 'ETH', wrappedNative: WETH }]
  const native: XSwapToken = {
    chainId: 421614,
    address: XSWAP_NATIVE_ADDRESS,
    symbol: 'ETH',
    decimals: 18,
    class: 'native-side',
    available: true,
  }
  const usdc: XSwapToken = {
    ...native,
    address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    symbol: 'USDC',
    decimals: 6,
  }
  const byKey = (tokens: XSwapToken[]) => {
    const map = new Map(tokens.map((t) => [`${t.chainId}-${t.address.toLowerCase()}`, t]))
    return (chainId: number, address: string) => map.get(`${chainId}-${address.toLowerCase()}`)
  }

  it('finds a listed token, ignoring address case', () => {
    expect(resolveXSwapLegToken(byKey([usdc]), chains, 421614, usdc.address.toUpperCase().replace('0X', '0x'))).toBe(usdc)
  })

  it('resolves an unlisted wrapped native to the native token', () => {
    expect(resolveXSwapLegToken(byKey([native]), chains, 421614, WETH.toLowerCase())).toBe(native)
  })

  it('prefers the listed wrapper over the native token', () => {
    const weth = { ...native, address: WETH, symbol: 'WETH' }
    expect(resolveXSwapLegToken(byKey([native, weth]), chains, 421614, WETH)).toBe(weth)
  })

  it('returns undefined for unknown tokens and chains', () => {
    expect(resolveXSwapLegToken(byKey([native]), chains, 421614, usdc.address)).toBeUndefined()
    expect(resolveXSwapLegToken(byKey([native]), chains, 84532, WETH)).toBeUndefined()
  })
})

describe('pickDefaultXSwapRoute', () => {
  const route = (quoteId: string, executable: boolean) => ({ quoteId, executable }) as XSwapQuote

  it('keeps best when it can be sent', () => {
    expect(pickDefaultXSwapRoute([route('a', true), route('b', true)])?.quoteId).toBe('a')
  })

  it('skips a priced-only best for the first route that can be sent', () => {
    expect(pickDefaultXSwapRoute([route('a', false), route('b', false), route('c', true)])?.quoteId).toBe('c')
  })

  it('falls back to best when no route can be sent', () => {
    expect(pickDefaultXSwapRoute([route('a', false), route('b', false)])?.quoteId).toBe('a')
    expect(pickDefaultXSwapRoute([])).toBeUndefined()
  })
})

describe('xswapNativeValue / xswapBridgeNativeFee', () => {
  // JOCX on Sepolia → JOC on JOC testnet over XGate: an ERC-20 input still sends the LayerZero fee as `msg.value`.
  const quote = {
    txs: [
      { kind: 'approve', value: '0' },
      { kind: 'deposit', value: '120000000000000' },
    ],
    legs: [
      {
        type: 'bridge',
        provider: 'xgate',
        tokenInChainId: 11155111,
        tokenOutChainId: 10081,
        tokenIn: '0xB1660F8CDbf2102Ac74C6CD6d7CD6A65E481e5fe',
        tokenOut: XSWAP_NATIVE_ADDRESS,
        expectedOut: '1000000000000000000',
        minOut: '1000000000000000000',
        nativeFee: '120000000000000',
      },
    ],
  } as unknown as XSwapQuote

  it('sums the native value of every tx', () => {
    expect(xswapNativeValue(quote)).toBe(120000000000000n)
  })

  it('sums the bridge legs native fee', () => {
    expect(xswapBridgeNativeFee(quote)).toBe(120000000000000n)
    expect(xswapBridgeNativeFee({ ...quote, legs: undefined })).toBe(0n)
  })
})

describe('layerZeroScanUrl', () => {
  it('links the message on the testnet site', () => {
    expect(layerZeroScanUrl('0xabc')).toBe('https://testnet.layerzeroscan.com/tx/0xabc')
  })
})
