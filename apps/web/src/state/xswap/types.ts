// Public shapes of the x-swap API (xswap-router-worker `apps/api`, see docs/api.md and examples/web/src/api/types.ts).
// The repos never import each other; keep these in sync by hand.

/** Token address on the wire; the zero address is the chain's native token. */
export type XSwapTokenRef = string

/** `GET /v1/chains`: chains enabled in API config. */
export type XSwapChain = {
  chainId: number
  name: string
  nativeSymbol: string
  wrappedNative: string
}

/** `GET /v1/tokens?chainId=`. `available` is per token, not per pair: two available tokens can still be `no_route`. */
export type XSwapToken = {
  chainId: number
  address: XSwapTokenRef
  symbol: string
  decimals: number
  class: string
  available: boolean
}

/** Every route class the API classifies a pair into. Each one is switched on or off in API config. */
type XSwapRouteClass =
  | 'local'
  | 'evm-native'
  | 'composite'
  | 'joc-same-family'
  | 'joc-cross-family'
  | 'joc-eth-stable-in'
  | 'joc-eth-stable-out'

/** A known route class, or one added to the API later; the UI treats every class other than `local` alike. */
// eslint-disable-next-line @typescript-eslint/ban-types -- `string & {}` keeps literal autocompletion
type XSwapRouteClassName = XSwapRouteClass | (string & {})

type XSwapRouting = 'SWAP' | 'WRAP' | 'UNWRAP' | 'BRIDGE' | 'BRIDGE_SWAP'

type XSwapTxKind = 'approve' | 'approve-reset' | 'permit2-approve' | 'deposit'

type XSwapTx = {
  chainId: number
  kind: XSwapTxKind
  to: string
  data: string
  value: string
  gasLimit?: string
}

type XSwapShape = 'bridge' | 'swap-bridge' | 'bridge-swap' | 'swap-bridge-swap' | 'swap'

/** One leg of a quoted route, in execution order. */
type XSwapLeg =
  | {
      type: 'swap'
      chainId: number
      tokenIn: string
      tokenOut: string
      amountIn: string
      expectedOut: string
      minOut: string
      venue: 'uniswap-v3' | 'uniswap-v2' | 'uniswap'
      path?: { tokens: string[]; fees?: number[] }
    }
  | {
      type: 'bridge'
      provider: string
      tokenInChainId: number
      tokenOutChainId: number
      tokenIn: XSwapTokenRef
      tokenOut: XSwapTokenRef
      expectedOut: string
      minOut: string
      nativeFee: string
    }

/** Permit2 `PermitSingle` as `eth_signTypedData_v4` input. */
type XSwapPermitTypedData = {
  domain: { name: string; chainId: number; verifyingContract: string }
  types: Record<string, { name: string; type: string }[]>
  primaryType: 'PermitSingle'
  message: {
    details: { token: string; amount: string; expiration: number; nonce: number }
    spender: string
    sigDeadline: string
  }
}

type XSwapQuote = {
  quoteId: string
  provider: string
  routing: XSwapRouting
  routeClass: XSwapRouteClassName
  tokenIn: { chainId: number; address: XSwapTokenRef }
  tokenOut: { chainId: number; address: XSwapTokenRef }
  inputAmount: string
  outputAmount: string
  minOutputAmount: string
  priceImpactBps: number
  fees: { lp: string; relayer: string; gas: string; app: string }
  etaSec: number
  /** Unix ms. */
  expiresAt: number
  /** false: priced only (contracts not deployed on a chain yet), `txs` is empty. */
  executable: boolean
  fallbackToken?: string
  destSwap: boolean
  shape?: XSwapShape
  legs?: XSwapLeg[]
  txs: XSwapTx[]
  permit?: XSwapPermitTypedData
  score: number
}

type XSwapRejection = { provider: string; reason: string }

/** `POST /v1/quote` body. Amounts are base units as decimal strings; only EXACT_INPUT is supported. */
export type XSwapQuoteRequest = {
  tokenIn: XSwapTokenRef
  tokenInChainId: number
  tokenOut: XSwapTokenRef
  tokenOutChainId: number
  amount: string
  swapper: string
  slippageBps?: number
}

/** `POST /v1/quote` response: candidates ranked best first. */
export type XSwapQuoteResponse = {
  requestId: string
  routeClass: XSwapRouteClassName
  best: XSwapQuote
  candidates: XSwapQuote[]
  rejected: XSwapRejection[]
}

/** Error envelope every API error is returned in. */
export type XSwapErrorBody = {
  code: string
  message?: string
  requestId?: string
  details?: Record<string, unknown>
}
