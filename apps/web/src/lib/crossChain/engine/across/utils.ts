import { decodeEventLog, parseAbiItem } from 'viem'
import type { AcrossDepositStatus } from 'lib/crossChain/engine/across/api'
import type { BridgeStatus } from 'lib/crossChain/bridge'

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

export function mapAcrossStatus(status: AcrossDepositStatus['status']): BridgeStatus {
  if (status === 'filled') {return 'filled'}
  return status === 'expired' || status === 'refunded' ? 'failed' : 'pending'
}
