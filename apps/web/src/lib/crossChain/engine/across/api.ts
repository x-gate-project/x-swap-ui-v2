import { ACROSS_API_BASE, ACROSS_TESTNET_CHAIN_IDS } from 'lib/crossChain/constants'
import type { RouteEntry } from 'lib/crossChain/bridge'

export interface AcrossDepositStatus {
  status: 'filled' | 'pending' | 'expired' | 'refunded' | 'slowFillRequested'
  fillTx?: string
  depositTxHash?: string
}

/**
 * GET /deposit/status — official Across endpoint to check if a bridge deposit has been filled
 * on the destination chain. `depositId` comes from the `FundsDeposited` event emitted by the
 * origin SpokePool in the bridge tx receipt — see `extractAcrossDepositId` below.
 */
export async function fetchAcrossDepositStatus(originChainId: number, depositId: string): Promise<AcrossDepositStatus> {
  const base = ACROSS_TESTNET_CHAIN_IDS.has(originChainId) ? ACROSS_API_BASE.testnet : ACROSS_API_BASE.mainnet
  const res = await fetch(`${base}/deposit/status?originChainId=${originChainId}&depositId=${depositId}`)
  if (!res.ok) {throw new Error(`Across deposit status failed (${res.status}): ${await res.text()}`)}
  return res.json()
}

interface AcrossQuote {
  outputAmount: bigint
  quoteTimestamp: number
  fillDeadline: number
  exclusiveRelayer: `0x${string}`
  exclusivityDeadline: number
}

/** GET /suggested-fees — see integration-guide-bridge.md §3 Bước B */
export async function fetchAcrossSuggestedFees(
  inputToken: string,
  outputToken: string,
  originChainId: number,
  destinationChainId: number,
  amount: bigint,
): Promise<AcrossQuote> {
  const base = ACROSS_TESTNET_CHAIN_IDS.has(originChainId) ? ACROSS_API_BASE.testnet : ACROSS_API_BASE.mainnet
  const url = `${base}/suggested-fees?inputToken=${inputToken}&outputToken=${outputToken}&originChainId=${originChainId}&destinationChainId=${destinationChainId}&amount=${amount.toString()}`

  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try { message = JSON.parse(text).message ?? text } catch { /* not JSON, use raw text */ }
    throw new Error(message)
  }
  const data = await res.json()

  const outputAmount = BigInt(data.outputAmount ?? '0')
  if (outputAmount === 0n) {
    throw new Error('Across quote outputAmount = 0 — route/token pair not supported')
  }

  return {
    outputAmount,
    quoteTimestamp: Number(data.timestamp ?? data.quoteTimestamp),
    fillDeadline: Number(data.fillDeadline),
    exclusiveRelayer: (data.exclusiveRelayer ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    exclusivityDeadline: Number(data.exclusivityDeadline ?? 0),
  }
}

let _routesCache: RouteEntry[] | null = null

async function fetchRoutesFromBase(base: string): Promise<RouteEntry[]> {
  try {
    const res = await fetch(`${base}/available-routes`)
    if (!res.ok) {return []}
    return await res.json()
  } catch {
    return []
  }
}

/** Fetch + cache Across's supported route list (testnet + mainnet). */
export async function fetchAcrossRoutes(): Promise<RouteEntry[]> {
  if (_routesCache) {return _routesCache}
  const [testnet, mainnet] = await Promise.all([
    fetchRoutesFromBase(ACROSS_API_BASE.testnet),
    fetchRoutesFromBase(ACROSS_API_BASE.mainnet),
  ])
  _routesCache = [...testnet, ...mainnet]
  return _routesCache
}
