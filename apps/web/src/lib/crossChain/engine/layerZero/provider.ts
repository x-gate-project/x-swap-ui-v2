import { isOftSymbol } from 'lib/crossChain/constants'
import { getXGateScanTxLink } from 'lib/crossChain/scanLink'
import { OFT_ROUTES } from 'lib/crossChain/engine/layerZero/routes'
import { createLzBridgeCommand } from 'lib/crossChain/engine/layerZero/createLzBridgeCommand'
import { quoteLzFee } from 'lib/crossChain/engine/layerZero/lzFee'
import { fetchLzStatus } from 'lib/crossChain/engine/layerZero/xGateScanApi'
import { BridgeProvider, destTokensFromRoutes } from 'lib/crossChain/bridge'

export const layerZeroProvider: BridgeProvider = {
  id: 'lz',
  name: 'LayerZero OFT',
  logoUrl: '/images/logos/layer_zero.png',
  usesContractBalance: true,

  supports: (input, output) => isOftSymbol(input.symbol) || isOftSymbol(output.symbol),

  getDestTokens: async (chainId, address) => destTokensFromRoutes(OFT_ROUTES, chainId, address),

  // OFT bridges 1:1; only cost is the LZ native messaging fee.
  async getQuote({ inputToken, recipient, srcChainId, dstChainId, amount, unwrapToOrigin, wagmiConfig }) {
    const nativeFee = await quoteLzFee(inputToken, recipient, BigInt(dstChainId), srcChainId, wagmiConfig, unwrapToOrigin)
    return { outputAmount: amount, nativeFee }
  },

  buildCommands: createLzBridgeCommand,

  getStatus: ({ hash, srcChainId }) => fetchLzStatus(srcChainId, hash),

  getExplorerUrl: getXGateScanTxLink,
}
