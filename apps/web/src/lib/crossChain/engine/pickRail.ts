import type { BridgeProvider, BridgeProviderId } from 'lib/crossChain/bridge'
import { ACROSSADAPTER_ADDRESS, isOftSymbol, type TokenLike } from 'lib/crossChain/constants'
import { providersFor } from 'lib/crossChain/engine/relay'
import { aggregatorTracker } from 'lib/crossChain/engine/relay/source'
import { getBridgeProvider } from 'lib/crossChain/engine/registry'
import { UniverseChainId } from 'uniswap/src/types/chains'

/** Status tracker for a sent cross-chain tx, by the rail recorded on it. */
export function trackerFor(
  info: { bridgeProtocol?: BridgeProviderId; aggregatorOrderId?: string },
  hash: string,
): Pick<BridgeProvider, 'name' | 'getStatus'> {
  return info.bridgeProtocol === 'relay'
    ? aggregatorTracker('relay', info.aggregatorOrderId ?? hash)
    : getBridgeProvider(info.bridgeProtocol)
}

const JOC_CHAINS = new Set<number>([UniverseChainId.JocMainnet, UniverseChainId.JocTestnet])

/**
 * Rail picker. Everything goes through XChainSender (LayerZero for JOC/OFT, Across via AcrossAdapter,
 * SOR swap legs around the bridge) unless both of these hold:
 * - pair is not JOC/OFT and AcrossAdapter is missing on either chain;
 * - Relay covers both chains: Relay rail (one deposit tx, provider-internal swaps).
 */
// ponytail: Across returns to the XChainSender rail until the aggregator backend API ships.
export function isRelayPair(input?: TokenLike | null, output?: TokenLike | null): boolean {
  if (!input || !output || input.chainId === output.chainId) {return false}
  if (JOC_CHAINS.has(input.chainId) || JOC_CHAINS.has(output.chainId)) {return false}
  if (isOftSymbol(input.symbol) || isOftSymbol(output.symbol)) {return false}
  if (ACROSSADAPTER_ADDRESS[input.chainId] && ACROSSADAPTER_ADDRESS[output.chainId]) {return false}
  return providersFor(input.chainId, output.chainId).length > 0
}

