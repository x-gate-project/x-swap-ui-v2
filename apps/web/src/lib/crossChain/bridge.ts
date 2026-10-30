import type { Config } from 'wagmi'
import type { Currency, Percent, TradeType } from '@uniswap/sdk-core'
import type { Trade } from '@uniswap/router-sdk'
import type { PcsCommand } from 'lib/crossChain/commandBuilders'
import { STABLECOIN_SYMBOLS, type TokenLike } from 'lib/crossChain/constants'
import type { BridgeToken } from 'lib/crossChain/types'

/** Persisted in tx history (`bridgeProtocol`) — never rename existing ids. */
export type BridgeProviderId = 'lz' | 'across' | 'relay'

/** Name + logo only — what quote/route UI needs (also covers aggregator-rail providers). */
export type BridgeDisplay = Pick<BridgeProvider, 'name' | 'logoUrl'>

interface BridgeQuoteRequest {
  inputToken: string
  outputToken: string
  srcChainId: number
  dstChainId: number
  amount: bigint
  recipient: string
  unwrapToOrigin?: boolean
  wagmiConfig: Config
}

interface BridgeQuoteResult {
  outputAmount: bigint
  /** Extra msg.value paid on src chain (e.g. LZ messaging fee). */
  nativeFee?: bigint
}

/**
 * Dst-chain SWAP embedded in the bridge's recipientMessage (BRIDGE_SWAP / SWAP_BRIDGE_SWAP) —
 * runs automatically via lzCompose / handleV3AcrossMessage right after the bridge lands.
 */
interface DstSwapParams {
  /** Dst-leg SOR quote — encoded into UR calldata (see encodeURSwapCalldata). */
  trade: Trade<Currency, Currency, TradeType>
  slippageTolerance: Percent
  /** Final recipient of the swap output — the user's own EOA. */
  account: `0x${string}`
  dstChainId: number
}

export interface BuildBridgeParams {
  account: `0x${string}`
  srcChainId: number
  dstChainId: number
  /** ERC20 address; for native input pass the wrapped address (toBridgeAddress) + isNativeInput. */
  bridgeTokenAddr: `0x${string}`
  bridgeInputAmount: bigint
  outputTokenAddr?: `0x${string}`
  unwrapToOrigin?: boolean
  isNativeInput?: boolean
  wagmiConfig: Config
  dstSwap?: DstSwapParams
}

export interface BridgeProvider {
  id: BridgeProviderId
  /** Display name. */
  name: string
  logoUrl: string
  /** Bridge ignores the encoded input amount (uses CONTRACT_BALANCE on-chain), so callers needn't estimate it. */
  usesContractBalance?: boolean
  supports(input: TokenLike, output: TokenLike): boolean
  getDestTokens(chainId: number, address: string): Promise<BridgeToken[]>
  getQuote(req: BridgeQuoteRequest): Promise<BridgeQuoteResult>
  /** isCrossChainSwap: commands changed the token before bridging (e.g. LZ mint USDT→USDTX). */
  buildCommands(params: BuildBridgeParams): Promise<{ commands: PcsCommand[]; value: bigint; isCrossChainSwap?: boolean }>
  /** Pulls the id needed by getStatus out of the src tx receipt. */
  getDepositId?(logs: readonly { data: string; topics: readonly string[] }[]): string | undefined
  /** One-shot dst-chain delivery check; polling lives in `waitForBridge`. */
  getStatus(tx: BridgeTx): Promise<BridgeStatus>
  getExplorerUrl?(srcChainId: number, hash: string): string | undefined
}

export type BridgeStatus = 'pending' | 'filled' | 'failed'

interface BridgeTx {
  hash: string
  srcChainId: number
  depositId?: string
}

/** Raw route entry (Across `GET /available-routes` shape, also used for hardcoded meshes). */
export interface RouteEntry {
  originChainId: number
  originToken: string
  originTokenSymbol?: string
  destinationChainId: number
  destinationToken: string
  destinationTokenSymbol?: string
}

// ponytail: route lists don't include decimals. Guess by symbol (stablecoins=6, else 18).
// Display-only risk — bridge execution uses real quote/outputAmount. Upgrade: token-list lookup.
function guessDecimals(symbol?: string): number {
  return STABLECOIN_SYMBOLS.has((symbol ?? '').toLowerCase()) ? 6 : 18
}

/** Tokens reachable from (chainId, address) in either direction of the given routes. */
export function destTokensFromRoutes(routes: RouteEntry[], chainId: number, address: string): BridgeToken[] {
  const addrLower = address.toLowerCase()
  const dests: BridgeToken[] = []
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
  return dests
}

const BRIDGE_POLL_INTERVAL = 5000

/**
 * Polls provider.getStatus until 'filled' (resolves) or 'failed' (rejects). Network / not-indexed-yet
 * errors are swallowed and retried. Rejects with 'Aborted' when signal fires (immediately, even mid-sleep)
 * and with 'Timeout' once Date.now() passes `deadline` (ms epoch). Shared by both rails.
 */
export async function waitForBridge(
  provider: Pick<BridgeProvider, 'name' | 'getStatus'>, tx: BridgeTx, signal: AbortSignal, deadline = Infinity,
): Promise<void> {
  while (!signal.aborted) {
    if (Date.now() > deadline) {throw new Error('Timeout')}
    const status = await provider.getStatus(tx).catch(() => 'pending' as const)
    if (status === 'filled') {return}
    if (status === 'failed') {throw new Error(`${provider.name} bridge failed`)}
    if (signal.aborted) {break} // aborted during getStatus — 'abort' already fired, listener would never run
    await new Promise<void>((resolve) => {
      const onAbort = () => { clearTimeout(id); resolve() }
      const id = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, BRIDGE_POLL_INTERVAL)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
  throw new Error('Aborted')
}

