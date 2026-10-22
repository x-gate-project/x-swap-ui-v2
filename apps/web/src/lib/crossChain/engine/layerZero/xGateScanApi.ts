import { MessageStatus, createClient } from '@x-gate-project/x-gate-scan-client'
import { getXGateScanEnv } from 'lib/crossChain/scanLink'
import type { BridgeStatus } from 'lib/crossChain/bridge'

/** One-shot X-Gate Scan check: 'filled' when every LZ message of the src tx is DELIVERED, 'failed' if any FAILED. */
export async function fetchLzStatus(srcChainId: number, hash: string): Promise<BridgeStatus> {
  const { messages } = await createClient(getXGateScanEnv(srcChainId)).getMessagesBySrcTxHash(hash)
  if (messages.some((m) => m.status === MessageStatus.FAILED)) {return 'failed'}
  return messages.length > 0 && messages.every((m) => m.status === MessageStatus.DELIVERED) ? 'filled' : 'pending'
}
