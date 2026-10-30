import { getAddress, zeroAddress, type Address, type Hex } from 'viem'
import { ACROSS_TESTNET_CHAIN_IDS } from 'lib/crossChain/constants'
import { validateDeposit } from 'lib/crossChain/engine/relay/allowlist'
import {
  ProviderError,
  type OrderStatus,
  type Quote,
  type RouteStep,
  type RouteToken,
  type SwapRequest,
  type TokenRef,
  type TxRequest,
} from 'lib/crossChain/engine/relay/types'

// Relay returns no quote expiry; cap it.
const MAX_QUOTE_AGE_MS = 30_000

// ponytail: Across's testnet chain set doubles as Relay's (allowlist gates the rest).
const base = (chainId: number) =>
  ACROSS_TESTNET_CHAIN_IDS.has(chainId) ? 'https://api.testnets.relay.link' : 'https://api.relay.link'
const toRelayToken = (t: TokenRef): Address => (t === 'native' ? zeroAddress : t)

type RelayTxData = { chainId: number; to: string; data: string; value?: string }
type RelayAmount = { currency: RouteToken }
type RelayLeg = { inputCurrency: RelayAmount; outputCurrency: RelayAmount }
export interface RelayQuoteResponse {
  requestId?: string
  steps: { id: string; kind: string; requestId?: string; items: { data: RelayTxData }[] }[]
  details: {
    currencyIn: { amount: string }
    currencyOut: { amount: string; minimumAmount: string }
    timeEstimate?: number
    route?: { origin?: RelayLeg; destination?: RelayLeg }
  }
  fees?: { relayer?: { amount: string; currency: { address: string; chainId: number } } }
}

const pick = ({ chainId, address, symbol, decimals }: RouteToken): RouteToken => ({ chainId, address, symbol, decimals })
const sameToken = (a: RouteToken, b: RouteToken) => a.chainId === b.chainId && a.address.toLowerCase() === b.address.toLowerCase()

/** origin/destination legs whose in == out are pass-throughs, not swaps. */
function relayRoute(route: RelayQuoteResponse['details']['route']): RouteStep[] | undefined {
  const o = route?.origin
  const d = route?.destination
  if (!o || !d) {return undefined}
  const swap = (l: RelayLeg): RouteStep[] =>
    sameToken(l.inputCurrency.currency, l.outputCurrency.currency)
      ? []
      : [{ kind: 'swap', tokenIn: pick(l.inputCurrency.currency), tokenOut: pick(l.outputCurrency.currency) }]
  return [
    ...swap(o),
    { kind: 'bridge', tokenIn: pick(o.outputCurrency.currency), tokenOut: pick(d.inputCurrency.currency) },
    ...swap(d),
  ]
}

/** Approve steps feed the validator (spender check) and are then dropped; exactly one deposit tx is allowed. */
export function normalizeRelay(req: SwapRequest, r: RelayQuoteResponse, now = Date.now()): Quote {
  if (r.steps.some((s) => s.kind !== 'transaction')) {throw new ProviderError('rejected', 'non-transaction step')}
  const approvals = r.steps.filter((s) => s.id === 'approve').flatMap((s) => s.items.map((i) => i.data))
  const deposits = r.steps.filter((s) => s.id !== 'approve').flatMap((s) => s.items.map((i) => i.data))
  if (deposits.length !== 1) {throw new ProviderError('rejected', `${deposits.length} deposit txs`)}
  const d = deposits[0]
  const deposit: TxRequest = {
    chainId: d.chainId,
    kind: 'deposit',
    to: getAddress(d.to),
    data: d.data as Hex,
    value: BigInt(d.value ?? '0'),
  }
  const inputAmount = BigInt(r.details.currencyIn.amount)
  validateDeposit('relay', req, deposit, approvals, inputAmount)
  const requestId = r.requestId ?? r.steps.find((s) => s.requestId)?.requestId
  if (!requestId) {throw new ProviderError('upstream_error', 'missing requestId')}
  const fee = r.fees?.relayer
  const feeInInput =
    fee && req.src.token !== 'native' && fee.currency.chainId === req.src.chainId &&
    fee.currency.address.toLowerCase() === req.src.token.toLowerCase()
  return {
    provider: 'relay',
    user: req.user,
    quoteId: requestId,
    expiresAt: now + MAX_QUOTE_AGE_MS,
    inputAmount,
    expectedOutput: BigInt(r.details.currencyOut.amount),
    minOutput: BigInt(r.details.currencyOut.minimumAmount),
    feeAmount: feeInInput && BigInt(fee.amount) > 0n ? BigInt(fee.amount) : 0n,
    etaSec: r.details.timeEstimate ?? 0,
    txs: [deposit],
    route: relayRoute(r.details.route),
  }
}

/** POST /quote, public endpoint (no API key in FE; 50 req/min limit). */
export async function quoteRelay(req: SwapRequest, signal: AbortSignal): Promise<Quote> {
  const res = await fetch(`${base(req.src.chainId)}/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      user: req.user,
      recipient: req.user,
      refundTo: req.user,
      originChainId: req.src.chainId,
      destinationChainId: req.dst.chainId,
      originCurrency: toRelayToken(req.src.token),
      destinationCurrency: toRelayToken(req.dst.token),
      amount: req.src.amount.toString(),
      tradeType: 'EXACT_INPUT',
      ...(req.slippageBps !== undefined ? { slippageTolerance: String(req.slippageBps) } : {}),
    }),
  })
  const text = await res.text()
  if (res.status === 429) {throw new ProviderError('rate_limited', text)}
  if (!res.ok) {throw new ProviderError(res.status < 500 ? 'no_route' : 'upstream_error', text)}
  return normalizeRelay(req, JSON.parse(text))
}

export function mapRelayStatus(status: string): OrderStatus | undefined {
  switch (status) {
    case 'waiting':
      return 'SUBMITTED'
    case 'depositing':
    case 'pending':
    case 'submitted':
    case 'delayed':
      return 'DEPOSITED'
    case 'success':
      return 'FILLED'
    case 'refund':
      return 'REFUNDED'
    // Relay refunds failed fills: stay non-terminal until 'refund' (or the 2h poll timeout).
    case 'failure':
      return 'EXPIRED'
    default:
      return undefined
  }
}

/** Relay order id = quote requestId. */
export async function relayOrderStatus(srcChainId: number, requestId: string): Promise<OrderStatus | undefined> {
  const res = await fetch(`${base(srcChainId)}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`)
  if (res.status === 404) {return undefined}
  if (!res.ok) {throw new ProviderError('upstream_error', `http ${res.status}`)}
  return mapRelayStatus((await res.json()).status)
}
