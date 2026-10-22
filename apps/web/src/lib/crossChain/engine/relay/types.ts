import type { Address, Hex } from 'viem'

/**
 * Subset of the backend types (cross-chain-swap-research `feature/x-swap-crosschain`:
 * apps/api/src/providers/types.ts + apps/api/src/orders/order.types.ts). Keep names aligned so the
 * backend source can drop in behind `AggregatorSource` without touching hooks/UI.
 */
export const AGGREGATOR_PROVIDERS = ['relay'] as const
export type AggregatorProviderId = (typeof AGGREGATOR_PROVIDERS)[number]

export type TokenRef = Address | 'native'

export type SwapRequest = {
  /** signer, depositor, recipient and refund address (v1: recipient must equal user) */
  user: Address
  src: { chainId: number; token: TokenRef; amount: bigint }
  dst: { chainId: number; token: TokenRef }
  slippageBps?: number
}

export type TxRequest = {
  chainId: number
  kind: 'approve' | 'approve-reset' | 'deposit'
  to: Address
  data: Hex
  value: bigint
}

export type Quote = {
  provider: AggregatorProviderId
  /** Account the txs were built for (depositor/recipient/refund). */
  user: Address
  /** Relay requestId */
  quoteId: string
  /** ms epoch */
  expiresAt: number
  inputAmount: bigint
  expectedOutput: bigint
  minOutput: bigint
  /** Provider fee in input-token units (0 when the provider reports it in another token). */
  feeAmount: bigint
  etaSec: number
  /** Validated deposit tx only. Approvals are rebuilt at execute time with the exact amount. */
  txs: TxRequest[]
  /** Hops the provider takes (swap/bridge). undefined = provider didn't say; show a single bridge hop. */
  route?: RouteStep[]
}

export type RouteToken = { chainId: number; address: string; symbol: string; decimals: number }
export type RouteStep = { kind: 'swap' | 'bridge'; tokenIn: RouteToken; tokenOut: RouteToken }

const ORDER_STATUSES = [
  'SUBMITTED',
  'DEPOSITED',
  'FILLED',
  'FILLED_FALLBACK',
  'FAILED_ORIGIN',
  'EXPIRED',
  'REFUNDED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** Persisted in tx history (`aggregatorOrderId`) to poll an order. Direct: Relay requestId. */
export type OrderRef = { id: string; provider: AggregatorProviderId; srcChainId: number }

type ProviderErrorCode =
  | 'no_route'
  | 'amount_too_low'
  | 'amount_too_high'
  | 'rate_limited'
  | 'upstream_error'
  | 'timeout'
  /** FE validator refused the provider's txs (allowlist, spender, chain, amount). */
  | 'rejected'

/** Raw upstream text stays in `detail` and never reaches the UI. */
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly detail?: string,
  ) {
    super(code)
  }
}
