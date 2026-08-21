import { decodeEventLog, parseAbiItem } from 'viem'
import { ACROSS_API_BASE, ACROSS_TESTNET_CHAIN_IDS, JOCX, JOCX_ADAPTER_JOC_ADDRESS, NATIVE_SENTINEL, STABLECOIN_SYMBOLS, USDCX, USDTX } from '../constants'
import { AcrossToken } from '../types'
import { UniverseChainId } from 'uniswap/src/types/chains'
import { USDC_SEPOLIA, USDT_SEPOLIA } from 'uniswap/src/constants/tokens'
import { WRAPPED_NATIVE_CURRENCY } from 'constants/tokens'

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
  if (!res.ok) throw new Error(`Across deposit status failed (${res.status}): ${await res.text()}`)
  return res.json()
}

export interface AcrossQuote {
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

/**
 * Extract Across `depositId` from a bridge tx receipt's logs.
 * SpokePool emits `FundsDeposited` on the origin chain when AcrossAdapter.bridge() is called —
 * see integration-guide-bridge.md §1 (architecture) and §Bước G (theo dõi).
 */
const FUNDS_DEPOSITED_EVENT = parseAbiItem(
  'event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)',
)

// Accepts both ethers.js and viem Log shapes — only `data`/`topics` are needed to decode.
export function extractAcrossDepositId(
  logs: readonly { data: string; topics: readonly string[] }[],
): string | undefined {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: [FUNDS_DEPOSITED_EVENT],
        data: log.data as `0x${string}`,
        topics: log.topics as [] | [`0x${string}`, ...`0x${string}`[]],
      })

      if (decoded.eventName === 'FundsDeposited') {
        return (decoded.args as { depositId: bigint }).depositId.toString()
      }
    } catch {
      // not a FundsDeposited log — skip
    }
  }
  return undefined
}

/** Raw entry from Across `GET /available-routes` */
interface AcrossRouteEntry {
  originChainId: number
  originToken: string
  originTokenSymbol?: string
  destinationChainId: number
  destinationToken: string
  destinationTokenSymbol?: string
}

let _routesCache: AcrossRouteEntry[] | null = null

async function fetchRoutesFromBase(base: string): Promise<AcrossRouteEntry[]> {
  try {
    const res = await fetch(`${base}/available-routes`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

// ponytail: Across API doesn't know our OFT tokens (USDTX/USDCX/JOCX) — they're bridged via
// LayerZero, not Across. Hardcode their route mesh so available-routes lookups (routeFinder)
// find them like any other token; useBridgeQuote separately detects OFT symbols and mocks a
// 1:1 quote instead of calling Across's /suggested-fees for these.
export const TESTNET_EVM_CHAINS = [
  UniverseChainId.Sepolia,
  UniverseChainId.Avalanche_Fuji,
  UniverseChainId.Base_Sepolia,
  UniverseChainId.ArbitrumSepolia,
  UniverseChainId.JocTestnet
]

const JOCX_MAP = JOCX as unknown as Record<number, { address: string }>
const USDTX_MAP = USDTX as unknown as Record<number, { address: string }>
const USDCX_MAP = USDCX as unknown as Record<number, { address: string }>

export function meshRoutes(chainIds: number[], addresses: Record<number, { address: string }>, symbol: string): AcrossRouteEntry[] {
  const entries: AcrossRouteEntry[] = []
  for (const from of chainIds) {
    for (const to of chainIds) {
      if (from === to) continue
      const fromAddr = addresses[from]?.address
      const toAddr = addresses[to]?.address
      if (!fromAddr || !toAddr) continue
      entries.push({
        originChainId: from,
        originToken: fromAddr,
        originTokenSymbol: symbol,
        destinationChainId: to,
        destinationToken: toAddr,
        destinationTokenSymbol: symbol,
      })
    }
  }
  return entries
}

const JOCX_WITH_JOC_ADAPTER: Record<number, { address: string }> = {
  ...JOCX_MAP,
  [UniverseChainId.JocTestnet]: { address: JOCX_ADAPTER_JOC_ADDRESS[UniverseChainId.JocTestnet] },
}

export function meshToHubRoutes(params: {
  meshChainIds: number[]
  meshTokens: Record<number, { address: string }>
  meshSymbol: string

  hubChainId: number
  hubToken: string
  hubSymbol: string
}): AcrossRouteEntry[] {
  const {
    meshChainIds,
    meshTokens,
    meshSymbol,
    hubChainId,
    hubToken,
    hubSymbol,
  } = params

  if (!hubToken) return []

  const entries: AcrossRouteEntry[] = []

  for (const chainId of meshChainIds) {
    const meshToken = meshTokens[chainId]?.address
    if (!meshToken) continue

    entries.push(
      {
        originChainId: chainId,
        originToken: meshToken,
        originTokenSymbol: meshSymbol,

        destinationChainId: hubChainId,
        destinationToken: hubToken,
        destinationTokenSymbol: hubSymbol,
      },
      {
        originChainId: hubChainId,
        originToken: hubToken,
        originTokenSymbol: hubSymbol,

        destinationChainId: chainId,
        destinationToken: meshToken,
        destinationTokenSymbol: meshSymbol,
      },
    )
  }

  return entries
}


const HARDCODED_ACROSS_ROUTES: AcrossRouteEntry[] = [
  // JOCX (EVM testnets) ↔ native JOC coin on JocTestnet
  ...meshToHubRoutes({
    meshChainIds: [
      UniverseChainId.Sepolia,
      UniverseChainId.Avalanche_Fuji,
      UniverseChainId.Base_Sepolia,
      UniverseChainId.ArbitrumSepolia,
    ],
    meshTokens: JOCX_MAP,
    meshSymbol: JOCX[UniverseChainId.Sepolia].symbol ?? 'JOCX',

    hubChainId: UniverseChainId.JocTestnet,
    hubToken: WRAPPED_NATIVE_CURRENCY[UniverseChainId.JocTestnet]!.address,
    hubSymbol: 'JOCT',
  }),
  ...meshToHubRoutes({
    meshChainIds: [
      UniverseChainId.JocTestnet,
      UniverseChainId.ArbitrumSepolia,
      UniverseChainId.Avalanche_Fuji,
      UniverseChainId.Base_Sepolia,
    ],
    meshTokens: USDTX_MAP,
    meshSymbol: USDTX[UniverseChainId.Sepolia].symbol ?? 'USDTX',

    hubChainId: UniverseChainId.Sepolia,
    hubToken: USDT_SEPOLIA.address,
    hubSymbol: USDT_SEPOLIA.symbol || 'USDT',
  }),
  ...meshToHubRoutes({
    meshChainIds: [
      UniverseChainId.JocTestnet,
      UniverseChainId.ArbitrumSepolia,
      UniverseChainId.Avalanche_Fuji,
      UniverseChainId.Base_Sepolia,
    ],
    meshTokens: USDCX_MAP,
    meshSymbol: USDCX[UniverseChainId.Sepolia].symbol ?? 'USDCX',

    hubChainId: UniverseChainId.Sepolia,
    hubToken: USDC_SEPOLIA.address,
    hubSymbol: USDC_SEPOLIA.symbol || 'USDC',
  }),
  // USDTX / USDCX mesh: 4 EVM testnets ↔ JOC Testnet
  ...meshRoutes(TESTNET_EVM_CHAINS, USDTX, USDTX[UniverseChainId.Sepolia].symbol ?? 'USDTX'),
  ...meshRoutes(TESTNET_EVM_CHAINS, USDCX, USDCX[UniverseChainId.Sepolia].symbol ?? 'USDCX'),
  // JOCX mesh: 4 EVM testnets ↔ JOC Testnet
  ...meshRoutes(TESTNET_EVM_CHAINS, JOCX_WITH_JOC_ADAPTER, JOCX[UniverseChainId.Sepolia].symbol ?? 'JOCX'),

]

/** Fetch + cache Across's supported route list (testnet + mainnet + hardcoded OFT mesh). */
export async function fetchAcrossRoutes(): Promise<AcrossRouteEntry[]> {
  if (_routesCache) return _routesCache
  const [testnet, mainnet] = await Promise.all([
    fetchRoutesFromBase(ACROSS_API_BASE.testnet),
    fetchRoutesFromBase(ACROSS_API_BASE.mainnet),
  ])
  _routesCache = [...testnet, ...mainnet, ...HARDCODED_ACROSS_ROUTES]
  return _routesCache
}

// ponytail: Across route list doesn't include decimals. Guess by symbol (stablecoins=6, else 18).
// Display-only risk (amount formatting) — bridge execution uses real quote/outputAmount, not this.
// Upgrade: fetch decimals from a token-list API if precision issues surface.
function guessDecimals(symbol?: string): number {
  return STABLECOIN_SYMBOLS.has((symbol ?? '').toLowerCase()) ? 6 : 18
}

/** Tokens reachable cross-chain from (chainId, address) via Across, or null if unsupported. */
export async function fetchAcrossDestTokens(chainId: number, address: string): Promise<AcrossToken[] | null> {
  const routes = await fetchAcrossRoutes()
  const addrLower = address.toLowerCase()
  const dests: AcrossToken[] = []
  for (const r of routes) {
    if (r.originChainId === chainId && r.originToken.toLowerCase() === addrLower) {
      dests.push({
        chainId: r.destinationChainId,
        address: r.destinationToken,
        symbol: r.destinationTokenSymbol ?? '',
        decimals: guessDecimals(r.destinationTokenSymbol),
      })
    }
    if (r.destinationChainId === chainId && r.destinationToken.toLowerCase() === addrLower) {
      dests.push({
        chainId: r.originChainId,
        address: r.originToken,
        symbol: r.originTokenSymbol ?? '',
        decimals: guessDecimals(r.originTokenSymbol),
      })
    }
  }
  return dests.length ? dests : null
}

/** Whether (chainId, address) is a known Across origin/destination token. */
export async function isAcrossSupported(chainId: number, address: string): Promise<boolean> {
  const routes = await fetchAcrossRoutes()
  const addrLower = address.toLowerCase()
  return routes.some(
    (r) =>
      (r.originChainId === chainId && r.originToken.toLowerCase() === addrLower) ||
      (r.destinationChainId === chainId && r.destinationToken.toLowerCase() === addrLower),
  )
}

let _supportedChainsCache: Set<number> | null = null

/** Fetch + cache Across's supported mainnet chain list from GET /swap/chains. */
async function fetchAcrossSupportedChains(): Promise<Set<number>> {
  if (_supportedChainsCache) return _supportedChainsCache
  try {
    const res = await fetch(`${ACROSS_API_BASE.mainnet}/swap/chains`)
    if (!res.ok) return _supportedChainsCache ?? new Set()
    const chains: { chainId: number }[] = await res.json()
    _supportedChainsCache = new Set(chains.map((c) => c.chainId))
  } catch {
    // fail-open on error: don't cache, caller falls back to stale/empty set
  }
  return _supportedChainsCache ?? new Set()
}

/**
 * Whether Across supports bridging on this chain at all (chain-level pre-check, before
 * spending a /swap/tokens + quote round-trip). /swap/chains only lists mainnet chains — it
 * doesn't distinguish testnet by subdomain — so testnets fall back to the existing
 * ACROSS_TESTNET_CHAIN_IDS whitelist. JocTestnet/JocMainnet bypass entirely: they're not real
 * Across chains, only reachable via HARDCODED_ACROSS_ROUTES (OFT mesh over LayerZero).
 */
export async function isAcrossChainSupported(chainId: number): Promise<boolean> {
  if (chainId === UniverseChainId.JocTestnet || chainId === UniverseChainId.JocMainnet) return true
  if (ACROSS_TESTNET_CHAIN_IDS.has(chainId)) return true
  const chains = await fetchAcrossSupportedChains()
  return chains.has(chainId)
}

/** Pre-warm the Across route + supported-chains caches. Call once on app init. */
export async function prewarmAcrossCache(): Promise<void> {
  await Promise.all([fetchAcrossRoutes(), fetchAcrossSupportedChains()])
}

