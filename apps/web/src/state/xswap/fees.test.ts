import { getXSwapFeeOverrides } from 'state/xswap/fees'
import { UniverseChainId } from 'uniswap/src/types/chains'

const estimate = { maxFeePerGas: BigInt(12_000_000), maxPriorityFeePerGas: BigInt(1_000) }

describe('getXSwapFeeOverrides', () => {
  it.each([UniverseChainId.ArbitrumOne, UniverseChainId.ArbitrumSepolia])(
    'doubles the estimated fee cap on chain %s',
    async (chainId) => {
      const estimateFees = jest.fn().mockResolvedValue(estimate)
      await expect(getXSwapFeeOverrides(chainId, estimateFees)).resolves.toEqual({
        maxFeePerGas: BigInt(24_000_000),
        maxPriorityFeePerGas: BigInt(1_000),
      })
      expect(estimateFees).toHaveBeenCalledWith(chainId)
    },
  )

  it.each([UniverseChainId.Mainnet, UniverseChainId.Sepolia, UniverseChainId.Base, UniverseChainId.Polygon])(
    'leaves the fees to the wallet on chain %s',
    async (chainId) => {
      const estimateFees = jest.fn().mockResolvedValue(estimate)
      await expect(getXSwapFeeOverrides(chainId, estimateFees)).resolves.toEqual({})
      expect(estimateFees).not.toHaveBeenCalled()
    },
  )

  it('falls back to the wallet estimate when the estimate fails', async () => {
    const estimateFees = jest.fn().mockRejectedValue(new Error('rpc down'))
    await expect(getXSwapFeeOverrides(UniverseChainId.ArbitrumOne, estimateFees)).resolves.toEqual({})
  })
})
