import {
  NATIVE_SENTINEL, PRIORITY_STABLECOINS, STABLECOIN_SYMBOLS,
  NON_SWAPPABLE_DEST_OFT_SYMBOLS,
  isOftToStablecoinPair,
} from './constants'


import { fetchAcrossDestTokens } from './bridge/across'

import type { AcrossToken, CrossChainRoute, IntermediateToken } from './types'

export interface RouteTokenInput {
  chainId: number
  address: string
  symbol: string
  decimals: number
}

function addrEq(a?: string, b?: string): boolean {
  return a?.toLowerCase() === b?.toLowerCase()
}

function isStablecoin(token: { symbol?: string }): boolean {
  return STABLECOIN_SYMBOLS.has(token.symbol?.toLowerCase() ?? '')
}

function isNativeToken(token: { address?: string }): boolean {
  return addrEq(token.address, NATIVE_SENTINEL)
}

// USDTX/USDCX have no on-chain liquidity pool, so they can never be the token swapped
// into/out of on the dest chain (BRIDGE_SWAP's post-bridge swap leg, or SWAP_BRIDGE_SWAP's
// second swap leg).
function isNonSwappableDestOft(token: { symbol?: string }): boolean {
  return NON_SWAPPABLE_DEST_OFT_SYMBOLS.has(token.symbol?.toLowerCase() ?? '')
}


function toIntermediateToken(t: AcrossToken): IntermediateToken {
  return {
    address: t.address,
    symbol: t.symbol,
    decimals: t.decimals,
    chainId: t.chainId,
  }
}

export async function findCrossChainRoute(
  sellToken: RouteTokenInput,
  buyToken: RouteTokenInput,
): Promise<CrossChainRoute> {
  if (sellToken.chainId === buyToken.chainId) {
    return { routeCase: 'SWAP_ONLY', steps: ['swap'] }
  }

  const sellDests = await fetchAcrossDestTokens(sellToken.chainId, sellToken.address)

  const buyDests = await fetchAcrossDestTokens(buyToken.chainId, buyToken.address)

  function tryBridgeOnly(): CrossChainRoute | null {
    if (!sellDests) return null
    const direct = sellDests.find((t) => t.chainId === buyToken.chainId && addrEq(t.address, buyToken.address))
    if (!direct) return null
    // OFT -> its own underlying stablecoin (e.g. USDTX -> USDT) is a burn-to-origin bridge,
    // not a plain send - XChainSender needs the unwrapToOrigin flag to redeem on arrival.
    const unwrapToOrigin = isOftToStablecoinPair(sellToken, buyToken) || undefined
    return { routeCase: 'BRIDGE_ONLY', steps: ['bridge'], unwrapToOrigin }
  }

  function tryBridgeSwap(): CrossChainRoute | null {
    // Exclude USDTX/USDCX: the post-bridge swap leg requires liquidity that these OFTs lack.
    const dstCandidatesFromSell = sellDests
      ? sellDests.filter((t) => t.chainId === buyToken.chainId && !isNonSwappableDestOft(t))
      : []
    if (dstCandidatesFromSell.length === 0) return null


    const orderedCandidates: AcrossToken[] = []
    const ref = sellToken.symbol?.toLowerCase()

    const has = (t: AcrossToken) => orderedCandidates.some((c) => addrEq(c.address, t.address))
    orderedCandidates.push(...dstCandidatesFromSell.filter((t) => isStablecoin(t) && t.symbol?.toLowerCase() === ref && !has(t)))
    orderedCandidates.push(...dstCandidatesFromSell.filter((t) => !isStablecoin(t) && t.symbol?.toLowerCase() === ref && !has(t)))
    const priorityList = PRIORITY_STABLECOINS[buyToken.chainId] ?? []
    for (const p of priorityList) {
      const found = dstCandidatesFromSell.find((t) => addrEq(t.address, p.address))
      if (found && !has(found)) orderedCandidates.push(found)
    }
    orderedCandidates.push(...dstCandidatesFromSell.filter((t) => isStablecoin(t) && !has(t)))
    orderedCandidates.push(...dstCandidatesFromSell.filter((t) => isNativeToken(t) && !has(t)))
    orderedCandidates.push(...dstCandidatesFromSell.filter((t) => !has(t)))

    if (orderedCandidates.length === 0) return null
    const validCandidates = orderedCandidates.map(toIntermediateToken)
    return {
      routeCase: 'BRIDGE_SWAP',
      steps: ['bridge', 'swap'],
      intermediateToken: validCandidates[0],
      candidateIntermediateTokens: validCandidates,
    }
  }

  async function doSwapBridgeSwap(): Promise<CrossChainRoute | null> {
    const srcCandidates = PRIORITY_STABLECOINS[sellToken.chainId] ?? []
    const pairs: { src: IntermediateToken; dst: IntermediateToken }[] = []

    for (const srcCandidate of srcCandidates) {
      const dests = await fetchAcrossDestTokens(sellToken.chainId, srcCandidate.address)
      if (!dests) continue
      // Exclude USDTX/USDCX: the second swap leg (dest chain) requires liquidity these OFTs lack.
      const destOnDst = dests.filter((t) => t.chainId === buyToken.chainId && !isNonSwappableDestOft(t))
      if (destOnDst.length === 0) continue


      const dstIntermediate =
        destOnDst.find((t) => isStablecoin(t)) ?? destOnDst.find((t) => isNativeToken(t)) ?? destOnDst[0]

      pairs.push({
        src: { ...srcCandidate, chainId: sellToken.chainId },
        dst: toIntermediateToken(dstIntermediate),
      })
    }

    if (pairs.length === 0) return null
    return {
      routeCase: 'SWAP_BRIDGE_SWAP',
      steps: ['swap', 'bridge', 'swap'],
      intermediateTokenSrc: pairs[0].src,
      intermediateTokenDst: pairs[0].dst,
      candidateIntermediateTokenPairs: pairs,
    }
  }

  async function trySwapBridge(): Promise<CrossChainRoute | null> {

    const srcCandidatesFromBuy = buyDests ? buyDests.filter((t) => t.chainId === sellToken.chainId) : []

    const orderedCandidates: AcrossToken[] = []
    const ref = buyToken.symbol?.toLowerCase()

    const has = (t: AcrossToken) => orderedCandidates.some((c) => addrEq(c.address, t.address))
    orderedCandidates.push(...srcCandidatesFromBuy.filter((t) => isStablecoin(t) && t.symbol?.toLowerCase() === ref && !has(t)))
    orderedCandidates.push(...srcCandidatesFromBuy.filter((t) => !isStablecoin(t) && t.symbol?.toLowerCase() === ref && !has(t)))
    const priorityList = PRIORITY_STABLECOINS[sellToken.chainId] ?? []
    for (const p of priorityList) {
      const found = srcCandidatesFromBuy.find((t) => addrEq(t.address, p.address))
      if (found && !has(found)) orderedCandidates.push(found)
    }
    orderedCandidates.push(...srcCandidatesFromBuy.filter((t) => isStablecoin(t) && !has(t)))
    orderedCandidates.push(...srcCandidatesFromBuy.filter((t) => isNativeToken(t) && !has(t)))
    orderedCandidates.push(...srcCandidatesFromBuy.filter((t) => !has(t)))

    const validCandidates: IntermediateToken[] = []
    for (const candidate of orderedCandidates) {
      const dests = await fetchAcrossDestTokens(sellToken.chainId, candidate.address)
      if (!dests) continue
      const canReachBuy = dests.some((t) => t.chainId === buyToken.chainId && addrEq(t.address, buyToken.address))
      if (canReachBuy) validCandidates.push(toIntermediateToken(candidate))
    }

    if (validCandidates.length === 0) return null
    return {
      routeCase: 'SWAP_BRIDGE',
      steps: ['swap', 'bridge'],
      intermediateToken: validCandidates[0],
      candidateIntermediateTokens: validCandidates,
    }
  }

  const bridgeOnly = tryBridgeOnly()
  if (bridgeOnly) return bridgeOnly

  // SWAP_BRIDGE and BRIDGE_SWAP are same-priority-tier — compute both, let SwapForm quote
  // and pick whichever yields the better output (see alternateRoute usage in SwapForm.tsx).
  const swapBridge = await trySwapBridge()
  const bridgeSwap = tryBridgeSwap()

  if (swapBridge && bridgeSwap) return { ...swapBridge, alternateRoute: bridgeSwap }
  if (swapBridge) return swapBridge
  if (bridgeSwap) return bridgeSwap

  const swapBridgeSwap = await doSwapBridgeSwap()
  if (swapBridgeSwap) return swapBridgeSwap

  return { routeCase: 'SWAP_BRIDGE_SWAP', steps: [], error: 'No bridge route found' }
}

