import { Currency, Percent, Token } from '@uniswap/sdk-core'
import { nativeOnChain } from 'constants/tokens'
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

export function currencyXSwapKey(currency: Currency): string {
  return xswapTokenKey(currency.chainId, toXSwapAddress(currency))
}

/** True when both sides are the same token on the same chain; the API never quotes such a pair. */
export function isSameXSwapToken(a?: Currency | null, b?: Currency | null): boolean {
  return Boolean(a && b && currencyXSwapKey(a) === currencyXSwapKey(b))
}

/** API token to an SDK currency; the zero address becomes the chain's native currency. */
export function xswapTokenToCurrency(token: XSwapToken): Currency {
  if (isXSwapNativeAddress(token.address)) {
    return nativeOnChain(token.chainId)
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
