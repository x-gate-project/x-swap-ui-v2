import { UniverseChainId } from 'uniswap/src/types/chains'

type XSwapFeeOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }

type XSwapFeeEstimate = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }

/**
 * Chains where wallets that estimate gas themselves set `maxFeePerGas = baseFee` and `maxPriorityFeePerGas = 0`, so any
 * base fee rise between signing and submission gets the tx rejected.
 */
const RAISED_FEE_CAP_CHAINS: ReadonlySet<number> = new Set([UniverseChainId.ArbitrumOne, UniverseChainId.ArbitrumSepolia])

/** wagmi / viem already cap at 1.2x the base fee (plus the tip); doubling that gives about 2.4x. */
const FEE_CAP_MULTIPLIER = BigInt(2)

/**
 * EIP-1559 fee overrides for an x-swap tx. On Arbitrum it raises `maxFeePerGas` well above the base fee: the tx only
 * pays baseFee + tip, so a higher cap costs nothing. Returns no overrides on other chains, or when the estimate fails,
 * so the wallet estimates the fees itself.
 */
export async function getXSwapFeeOverrides(
  chainId: number,
  estimateFees: (chainId: number) => Promise<XSwapFeeEstimate>,
): Promise<XSwapFeeOverrides> {
  if (!RAISED_FEE_CAP_CHAINS.has(chainId)) {
    return {}
  }
  try {
    const { maxFeePerGas, maxPriorityFeePerGas } = await estimateFees(chainId)
    return { maxFeePerGas: maxFeePerGas * FEE_CAP_MULTIPLIER, maxPriorityFeePerGas }
  } catch {
    return {}
  }
}
