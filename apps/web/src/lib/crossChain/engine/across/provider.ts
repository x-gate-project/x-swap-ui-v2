import { isOftSymbol } from 'lib/crossChain/constants'
import {
  fetchAcrossDepositStatus,
  fetchAcrossRoutes,
  fetchAcrossSuggestedFees,
} from 'lib/crossChain/engine/across/api'
import { createAcrossBridgeCommand } from 'lib/crossChain/engine/across/createAcrossBridgeCommand'
import { extractAcrossDepositId, mapAcrossStatus } from 'lib/crossChain/engine/across/utils'
import { BridgeProvider, destTokensFromRoutes } from 'lib/crossChain/bridge'

export const acrossProvider: BridgeProvider = {
  id: 'across',
  name: 'Across',
  logoUrl: '/images/logos/across-logo.png',

  // Everything that isn't an OFT (OFTs only move over LayerZero).
  supports: (input, output) => !isOftSymbol(input.symbol) && !isOftSymbol(output.symbol),

  getDestTokens: async (chainId, address) => destTokensFromRoutes(await fetchAcrossRoutes(), chainId, address),

  getQuote: ({ inputToken, outputToken, srcChainId, dstChainId, amount }) =>
    fetchAcrossSuggestedFees(inputToken, outputToken, srcChainId, dstChainId, amount),

  buildCommands: createAcrossBridgeCommand,

  getDepositId: extractAcrossDepositId,

  /** One-shot Across `GET /deposit/status` check. No depositId = untrackable, fail fast (as before). */
  async getStatus({ srcChainId, depositId }) {
    if (!depositId) {return 'failed'}
    return mapAcrossStatus((await fetchAcrossDepositStatus(srcChainId, depositId)).status)
  },
}
