import { NATIVE_SENTINEL, PRIORITY_STABLECOINS, STABLECOIN_SYMBOLS } from 'lib/crossChain/constants'

export function addrEq(a?: string, b?: string): boolean {
  return a?.toLowerCase() === b?.toLowerCase()
}

export function isStablecoin(token: { symbol?: string }): boolean {
  return STABLECOIN_SYMBOLS.has(token.symbol?.toLowerCase() ?? '')
}

export function isNativeToken(token: { address?: string }): boolean {
  return addrEq(token.address, NATIVE_SENTINEL)
}

/**
 * Orders intermediate-token candidates on `chainId` (CoW `tokenPriority` equivalent), deduped by address:
 * 1. stablecoin with same symbol as `refSymbol`  2. other token with same symbol
 * 3. PRIORITY_STABLECOINS[chainId] in list order  4. other stablecoins  5. native  6. rest (input order).
 */
export function rankIntermediateTokens<T extends { address: string; symbol?: string }>(
  candidates: T[],
  refSymbol: string | undefined,
  chainId: number,
): T[] {
  const ref = refSymbol?.toLowerCase()
  const sameSymbol = (t: T) => t.symbol?.toLowerCase() === ref
  const priority = (PRIORITY_STABLECOINS[chainId] ?? []).flatMap((p) => candidates.filter((t) => addrEq(t.address, p.address)))
  const ordered = [
    ...candidates.filter((t) => isStablecoin(t) && sameSymbol(t)),
    ...candidates.filter((t) => !isStablecoin(t) && sameSymbol(t)),
    ...priority,
    ...candidates.filter(isStablecoin),
    ...candidates.filter(isNativeToken),
    ...candidates,
  ]
  return ordered.filter((t, i) => ordered.findIndex((c) => addrEq(c.address, t.address)) === i)
}
