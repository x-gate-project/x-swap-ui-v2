import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { readContract } from 'wagmi/actions'
import type { Config } from 'wagmi'
import LzAdapterAbi from 'lib/crossChain/abis/lzAdapter.json'
import { LZADAPTER_ADDRESS, LZ_RECEIVE_GAS, CONTRACT_BALANCE } from '../constants'

// ponytail: duplicate of commandBuilders.ts's addressToBytes32 — kept private here to avoid
// a commandBuilders <-> bridge/layerZero circular import (commandBuilders imports quoteLzFee
// from this file). Upgrade: extract to a tiny shared leaf module if a 3rd consumer appears.
function addressToBytes32(addr: string): `0x${string}` {
  return `0x${addr.slice(2).padStart(64, '0')}` as `0x${string}`
}

/**
 * unwrapToOrigin: burn-to-origin flow (OFT → underlying) uses OFTX_BURN gas + composeGas
 * (lzCompose unwraps to the underlying ERC20 on arrival). Plain send uses OFTX_SEND, no compose.
 * dstSwapComposeGas: dst-chain SWAP embedded in recipientMessage (BRIDGE_SWAP / SWAP_BRIDGE_SWAP) —
 * takes priority over unwrapToOrigin's own composeGas (the two never happen on the same leg).
 */
export function encodeLzData(nativeFee: bigint, unwrapToOrigin: boolean, dstSwapComposeGas?: bigint): `0x${string}` {
  const hasSwapCompose = !!dstSwapComposeGas && dstSwapComposeGas > 0n
  return encodeAbiParameters(
    parseAbiParameters(
      '(uint128 nativeFee, uint128 lzReceiveGas, uint128 composeGas, bytes oftCmd)',
    ),
    [{
      nativeFee,
      lzReceiveGas: BigInt(
        hasSwapCompose ? LZ_RECEIVE_GAS.SWAP_COMPOSE : unwrapToOrigin ? LZ_RECEIVE_GAS.OFTX_BURN : LZ_RECEIVE_GAS.OFTX_SEND,
      ),
      composeGas: hasSwapCompose ? dstSwapComposeGas : unwrapToOrigin ? BigInt(LZ_RECEIVE_GAS.OFTX_BURN_COMPOSE) : 0n,
      oftCmd: '0x',
    }],
  )
}

/** Dst-chain SWAP embedded in a bridge's recipientMessage — triggers lzCompose / handleV3AcrossMessage. */
export interface DstSwapOpts {
  /** LZAdapter/AcrossAdapter address on dst chain — BridgeData.recipient MUST point here so the
   * endpoint/SpokePool calls its compose/handleV3AcrossMessage hook instead of paying the EOA directly. */
  recipientOverride: string
  recipientMessage: `0x${string}`
  /** LZ only — composeGas for the Executor's lzCompose call. */
  composeGas?: bigint
}

/**
 * dstSwap: quote with the real recipientMessage/composeGas/recipientOverride so the fee
 * covers the compose step (message size + composeGas both affect LZ's quoted fee).
 */
export async function quoteLzFee(
  inputTokenAddress: string,
  recipient: string,
  dstChainId: bigint,
  srcChainId: number,
  wagmiConfig: Config,
  unwrapToOrigin = false,
  dstSwap?: DstSwapOpts,
  outputTokenAddress: string = inputTokenAddress,
): Promise<bigint> {
  const lzAdapterAddress = LZADAPTER_ADDRESS[srcChainId]
  if (!lzAdapterAddress) throw new Error(`No LZAdapter for chainId ${srcChainId}`)

  const lzDataForQuote = encodeLzData(0n, unwrapToOrigin, dstSwap?.composeGas)
  const finalRecipient = dstSwap?.recipientOverride ?? recipient

  const nativeFee = await readContract(wagmiConfig, {
    address: lzAdapterAddress,
    abi: LzAdapterAbi,
    functionName: 'quoteBridge',
    args: [{
      inputToken: addressToBytes32(inputTokenAddress),
      outputToken: addressToBytes32(outputTokenAddress),
      inputAmount: CONTRACT_BALANCE,
      outputAmount: 0n,
      refundRecipient: recipient as `0x${string}`,
      target: lzAdapterAddress,
      data: lzDataForQuote,
      destinationChainId: dstChainId,
      recipient: addressToBytes32(finalRecipient),
      recipientMessage: dstSwap?.recipientMessage ?? '0x' as `0x${string}`,
    }],
    chainId: srcChainId,
  }) as bigint

  return nativeFee
}
