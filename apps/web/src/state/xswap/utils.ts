import { Currency, NativeCurrency, Percent, Token } from '@uniswap/sdk-core'
import { WRAPPED_NATIVE_CURRENCY, nativeOnChain } from 'constants/tokens'
import JSBI from 'jsbi'
import { XSwapToken, XSwapTokenRef } from 'state/xswap/types'
import { zeroAddress } from 'viem'

/** The zero address is the native token on the wire, both ways. */
export const XSWAP_NATIVE_ADDRESS: XSwapTokenRef = zeroAddress

export function isXSwapNativeAddress(address: string): boolean {
  return address.toLowerCase() === XSWAP_NATIVE_ADDRESS
}

/** Address to send to the API for a currency: the zero address for the chain's native currency. */
export function toXSwapAddress(currency: Currency): XSwapTokenRef {
  return currency.isNative ? XSWAP_NATIVE_ADDRESS : currency.address
}

/** Key that is equal for two currencies only when they are the same token on the same chain. */
export function xswapTokenKey(chainId: number, address: string): string {
  return `${chainId}-${address.toLowerCase()}`
}

function currencyXSwapKey(currency: Currency): string {
  return xswapTokenKey(currency.chainId, toXSwapAddress(currency))
}

/** True when both sides are the same token on the same chain; the API never quotes such a pair. */
export function isSameXSwapToken(a?: Currency | null, b?: Currency | null): boolean {
  return Boolean(a && b && currencyXSwapKey(a) === currencyXSwapKey(b))
}

/**
 * Native currency of a chain the app does not know (e.g. a testnet only the API serves). `nativeOnChain` would throw on
 * `.wrapped` there; this one wraps to the API's `wrappedNative`.
 */
class XSwapNativeCurrency extends NativeCurrency {
  private readonly wrappedToken: Token

  constructor(chainId: number, symbol: string, wrappedNative: string) {
    super(chainId, 18, symbol, symbol)
    this.wrappedToken = new Token(chainId, wrappedNative, 18, `W${symbol}`, `Wrapped ${symbol}`)
  }

  get wrapped(): Token {
    return this.wrappedToken
  }

  equals(other: Currency): boolean {
    return other.isNative && other.chainId === this.chainId
  }
}

const xswapNativeCurrencies = new Map<number, XSwapNativeCurrency>()

/** The chain's native currency; `wrappedNative` (from `GET /v1/chains`) covers chains the app has no WETH for. */
function xswapNativeCurrency(chainId: number, symbol: string, wrappedNative?: string): Currency {
  if (WRAPPED_NATIVE_CURRENCY[chainId] || !wrappedNative) {
    return nativeOnChain(chainId)
  }
  let currency = xswapNativeCurrencies.get(chainId)
  if (!currency) {
    currency = new XSwapNativeCurrency(chainId, symbol, wrappedNative)
    xswapNativeCurrencies.set(chainId, currency)
  }
  return currency
}

/** API token to an SDK currency; the zero address becomes the chain's native currency. */
export function xswapTokenToCurrency(token: XSwapToken, wrappedNative?: string): Currency {
  if (isXSwapNativeAddress(token.address)) {
    return xswapNativeCurrency(token.chainId, token.symbol, wrappedNative)
  }
  return new Token(token.chainId, token.address, token.decimals, token.symbol, token.symbol)
}

export type XSwapFlow = 'same-chain' | 'cross-chain'

/**
 * The API classifies every pair; the UI never classifies pairs itself. `local` is a same-chain swap, every other
 * route class (including ones added later) is a cross-chain order.
 */
export function getXSwapFlow(routeClass: string): XSwapFlow {
  return routeClass === 'local' ? 'same-chain' : 'cross-chain'
}

/** Slippage as whole basis points, as the API takes it. */
export function percentToBps(percent: Percent): number {
  return JSBI.toNumber(percent.multiply(10_000).quotient)
}

/**
 * Which flow a chain uses while the API does not cover every chain yet:
 * - `api`: the API enables the chain; tokens and quotes come from it.
 * - `legacy`: the API is off, failed to load its chains, or does not enable the chain; the swap form keeps the token
 *   lists and the client-side router.
 * - `loading`: the chain list is not known yet.
 */
export type XSwapChainMode = 'api' | 'legacy' | 'loading'

export function getXSwapChainMode({
  apiEnabled,
  chainId,
  chainIds,
  loading,
}: {
  apiEnabled: boolean
  chainId?: number
  chainIds?: number[]
  loading: boolean
}): XSwapChainMode {
  if (!apiEnabled || !chainId) {
    return 'legacy'
  }
  if (loading) {
    return 'loading'
  }
  return chainIds?.includes(chainId) ? 'api' : 'legacy'
}

// Explorers of chains the API serves that the app itself does not list.
const XSWAP_EXPLORERS: Record<number, string> = {
  11155111: 'https://sepolia.etherscan.io',
  421614: 'https://sepolia.arbiscan.io',
  84532: 'https://sepolia.basescan.org',
  11155420: 'https://sepolia-optimism.etherscan.io',
  10081: 'https://explorer.testnet.japanopenchain.org',
  81: 'https://explorer.japanopenchain.org',
}

/** Explorer link of a tx on any chain the API serves; undefined when the chain's explorer is unknown. */
export function xswapExplorerTxUrl(chainId: number, hash: string, fallbackExplorer?: string): string | undefined {
  const base = (XSWAP_EXPLORERS[chainId] ?? fallbackExplorer)?.replace(/\/+$/, '')
  return base ? `${base}/tx/${hash}` : undefined
}

/** `0x1234…abcd`. */
export function shortenXSwapHash(hash: string, chars = 4): string {
  return hash.length > chars * 2 + 2 ? `${hash.slice(0, chars + 2)}…${hash.slice(-chars)}` : hash
}

/** Base units to a short human amount: at most `maxDecimals` decimals, trailing zeros dropped. */
export function formatXSwapUnits(amount: string, decimals: number, maxDecimals = 6): string {
  let value: bigint
  try {
    value = BigInt(amount)
  } catch {
    return amount
  }
  const negative = value < 0n
  if (negative) {
    value = -value
  }
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, maxDecimals).replace(/0+$/, '')
  const formatted = fraction ? `${whole}.${fraction}` : whole.toString()
  if (formatted === '0' && value > 0n) {
    return `<0.${'0'.repeat(Math.max(0, maxDecimals - 1))}1`
  }
  return negative ? `-${formatted}` : formatted
}

/** `90` -> `1m 30s`, `45` -> `45s`, `3600` -> `60m`. */
export function formatXSwapEta(etaSec: number): string {
  if (etaSec < 60) {
    return `${Math.max(0, Math.round(etaSec))}s`
  }
  const minutes = Math.floor(etaSec / 60)
  const seconds = Math.round(etaSec % 60)
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}
