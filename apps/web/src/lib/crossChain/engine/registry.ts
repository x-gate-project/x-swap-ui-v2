import type { TokenLike } from 'lib/crossChain/constants'
import type { BridgeToken } from 'lib/crossChain/types'
import { acrossProvider } from 'lib/crossChain/engine/across/provider'
import { layerZeroProvider } from 'lib/crossChain/engine/layerZero/provider'
import type { BridgeProvider, BridgeProviderId } from 'lib/crossChain/bridge'

/**
 * XChainSender bridge registry (Relay is its own rail, see pickRail). Add a provider = new folder under
 * engine/ implementing BridgeProvider + one entry here.
 * `supports` must be mutually exclusive across providers; array order = dest-token order in getDestTokens.
 */
// ponytail: first-match selection, no quote competition — no token pair is served by 2 providers today.
// Upgrade: Promise.allSettled getQuote over all `supports` matches, pick max outputAmount.
export const BRIDGE_PROVIDERS: BridgeProvider[] = [acrossProvider, layerZeroProvider]

/** Missing id = legacy tx persisted before `bridgeProtocol` existed, all of which were LayerZero. */
export function getBridgeProvider(id: BridgeProviderId = 'lz'): BridgeProvider {
  const provider = BRIDGE_PROVIDERS.find((p) => p.id === id)
  if (!provider) {throw new Error(`Unknown bridge provider: ${id}`)}
  return provider
}

export function findBridgeProvider(input: TokenLike, output: TokenLike): BridgeProvider {
  const provider = BRIDGE_PROVIDERS.find((p) => p.supports(input, output))
  if (!provider) {throw new Error(`No bridge provider for ${input.symbol} -> ${output.symbol}`)}
  return provider
}

/** Union of tokens reachable from (chainId, address) over all providers; null if none. */
export async function getDestTokens(chainId: number, address: string): Promise<BridgeToken[] | null> {
  const results = await Promise.allSettled(BRIDGE_PROVIDERS.map((p) => p.getDestTokens(chainId, address)))
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  return all.length ? all : null
}
