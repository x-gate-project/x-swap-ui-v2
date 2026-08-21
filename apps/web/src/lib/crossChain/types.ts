export type RouteCase =
  | 'SWAP_ONLY'
  | 'BRIDGE_ONLY'
  | 'BRIDGE_SWAP'
  | 'SWAP_BRIDGE'
  | 'SWAP_BRIDGE_SWAP'
  | 'CONVERT_BRIDGE'

export interface IntermediateToken {
  address: string
  symbol: string
  decimals: number
  chainId: number
}

export interface CrossChainRoute {
  routeCase: RouteCase
  steps: ('swap' | 'bridge')[]
  intermediateToken?: IntermediateToken
  candidateIntermediateTokens?: IntermediateToken[]
  intermediateTokenSrc?: IntermediateToken

  intermediateTokenDst?: IntermediateToken
  unwrapToOrigin?: boolean
  error?: string

  /** Alternate route at the same priority tier (SWAP_BRIDGE <-> BRIDGE_SWAP), quoted in
   * parallel by SwapForm to pick whichever yields the better output. Only ever one level
   * deep — the alternate itself never carries its own alternateRoute. */
  alternateRoute?: CrossChainRoute
  /** SWAP_BRIDGE_SWAP: ordered (src, dst) intermediate-token pairs for sequential fallback,
   * mirroring candidateIntermediateTokens but for the 3-hop case (two intermediates). */
  candidateIntermediateTokenPairs?: { src: IntermediateToken; dst: IntermediateToken }[]
}



/** Token descriptor derived from Across `GET /available-routes` (chainId-based, no chainKey needed) */
export interface AcrossToken {
  chainId: number
  address: string
  symbol: string
  decimals: number
}
