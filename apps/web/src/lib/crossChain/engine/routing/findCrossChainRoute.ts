import { NON_SWAPPABLE_DEST_OFT_SYMBOLS, PRIORITY_STABLECOINS, isOftToStablecoinPair } from 'lib/crossChain/constants'
import { getDestTokens } from 'lib/crossChain/engine/registry'
import {
  addrEq,
  isNativeToken,
  isStablecoin,
  rankIntermediateTokens,
} from 'lib/crossChain/engine/routing/tokenPriority'
import type { BridgeToken, CrossChainRoute, IntermediateToken } from 'lib/crossChain/types'

export interface RouteTokenInput {
  chainId: number
  address: string
  symbol: string
  decimals: number
}

// USDTX/USDCX have no on-chain liquidity pool, so they can never be the token swapped
// into/out of on the dest chain (BRIDGE_SWAP's post-bridge swap leg, or SWAP_BRIDGE_SWAP's
// second swap leg).
function isNonSwappableDestOft(token: { symbol?: string }): boolean {
  return NON_SWAPPABLE_DEST_OFT_SYMBOLS.has(token.symbol?.toLowerCase() ?? '')
}


function toIntermediateToken(t: BridgeToken): IntermediateToken {
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

  const sellDests = await getDestTokens(sellToken.chainId, sellToken.address)

  const buyDests = await getDestTokens(buyToken.chainId, buyToken.address)

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

    const validCandidates = rankIntermediateTokens(dstCandidatesFromSell, sellToken.symbol, buyToken.chainId)
      .map(toIntermediateToken)
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
      const dests = await getDestTokens(sellToken.chainId, srcCandidate.address)
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

    const orderedCandidates = rankIntermediateTokens(srcCandidatesFromBuy, buyToken.symbol, sellToken.chainId)

    const validCandidates: IntermediateToken[] = []
    for (const candidate of orderedCandidates) {
      const dests = await getDestTokens(sellToken.chainId, candidate.address)
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

