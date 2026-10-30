import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { addressToBytes32, encodeRecipientMessage, encodeSwapCommandData, type PcsCommand } from 'lib/crossChain/commandBuilders'
import {
  ACROSSADAPTER_ADDRESS, CMD_BRIDGE, CMD_SWAP, CONTRACT_BALANCE, XCHAINSENDER_NATIVE_SENTINEL,
} from 'lib/crossChain/constants'
import { fetchAcrossSuggestedFees } from 'lib/crossChain/engine/across/api'
import type { BuildBridgeParams } from 'lib/crossChain/bridge'

/** abi.encode(AcrossData{exclusiveRelayer, exclusivityDeadline, quoteTimestamp, fillDeadline}) — guide §3 Bước C */
function encodeAcrossData(
  exclusiveRelayer: `0x${string}`,
  exclusivityDeadline: number,
  quoteTimestamp: number,
  fillDeadline: number,
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('address, uint32, uint32, uint32'),
    [exclusiveRelayer, exclusivityDeadline, quoteTimestamp, fillDeadline],
  )
}

/**
 * BridgeData with target=AcrossAdapter — recipientMessage = ([], fallbackReceiver) per guide §3 Bước D.
 * `inputAmount` must be the real expected input (e.g. post-swap leg1 output with slippage buffer,
 * or the raw bridge amount for BRIDGE_ONLY) — NOT a placeholder. Dispatcher.sol scales
 * outputAmount by `actualBalance / inputAmount` before calling AcrossAdapter, so a wrong
 * (e.g. 1n) inputAmount here makes outputAmount blow up and the Across SpokePool deposit revert.
 *
 * dstSwap: set for BRIDGE_SWAP / SWAP_BRIDGE_SWAP — embeds a SWAP command in recipientMessage,
 * run automatically by AcrossAdapter.handleV3AcrossMessage on arrival; recipient becomes the
 * AcrossAdapter itself (not the EOA) so the SpokePool calls that hook.
 */
function encodeAcrossBridgeCommandData(
  inputToken: string,
  outputToken: string,
  acrossAdapterAddress: string,
  recipient: string,
  destinationChainId: bigint,
  inputAmount: bigint,
  outputAmount: bigint,
  acrossData: `0x${string}`,
  fallbackReceiver: string,
  dstSwap?: { recipientOverride: string; commands: PcsCommand[] },
): `0x${string}` {

  const recipientMessage = encodeRecipientMessage(dstSwap?.commands ?? [], fallbackReceiver)
  const finalRecipient = dstSwap?.recipientOverride ?? recipient

  return encodeAbiParameters(
    parseAbiParameters(
      '(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, address refundRecipient, address target, bytes data, uint256 destinationChainId, bytes32 recipient, bytes recipientMessage)',
    ),
    [{
      inputToken: addressToBytes32(inputToken),
      outputToken: addressToBytes32(outputToken),
      inputAmount,
      outputAmount,
      refundRecipient: recipient as `0x${string}`,
      target: acrossAdapterAddress as `0x${string}`,
      data: acrossData,
      destinationChainId,
      recipient: addressToBytes32(finalRecipient),
      recipientMessage,
    }],
  )
}

export async function createAcrossBridgeCommand({
  account, srcChainId, dstChainId, bridgeTokenAddr, bridgeInputAmount, outputTokenAddr, isNativeInput = false, dstSwap,
}: BuildBridgeParams): Promise<{ commands: PcsCommand[]; value: bigint }> {
  const acrossAdapterAddr = ACROSSADAPTER_ADDRESS[srcChainId]
  if (!acrossAdapterAddr) {throw new Error(`AcrossAdapter not deployed on chain ${srcChainId}`)}
  if (!outputTokenAddr) {throw new Error('Across bridge: outputTokenAddr required')}

  // API needs the real ERC20 address (WETH for native input — SpokePool wraps/unwraps itself).
  const quote = await fetchAcrossSuggestedFees(bridgeTokenAddr, outputTokenAddr, srcChainId, dstChainId, bridgeInputAmount)
  const acrossData = encodeAcrossData(
    quote.exclusiveRelayer, quote.exclusivityDeadline, quote.quoteTimestamp, quote.fillDeadline,
  )

  let dstSwapCmds: { recipientOverride: string; commands: PcsCommand[] } | undefined
  if (dstSwap) {
    const dstAcrossAdapterAddr = ACROSSADAPTER_ADDRESS[dstChainId]
    if (!dstAcrossAdapterAddr) {throw new Error(`AcrossAdapter not deployed on dst chain ${dstChainId}`)}
    // +1h — dst-chain swap executes later, via handleV3AcrossMessage, not immediately.
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    // Adapter forwards whatever landed (CONTRACT_BALANCE). quote.outputAmount = worst case: Dispatcher
    // scales it up by actualBalance / bridgeInputAmount, and bridgeInputAmount is leg1's min output.
    const swapCommandData = encodeSwapCommandData(
      outputTokenAddr, CONTRACT_BALANCE, dstSwap.account,
      dstSwap.trade, dstSwap.slippageTolerance, deadline, dstChainId, quote.outputAmount,
    )
    dstSwapCmds = { recipientOverride: dstAcrossAdapterAddr, commands: [{ command: CMD_SWAP, commandData: swapCommandData }] }
  }

  // BridgeData.inputToken on-chain must be the native sentinel (address(0)), not WETH —
  // Dispatcher.dispatch() branches on inputToken == Constants.ETH to pick address(this).balance
  // vs ERC20(inputToken).balanceOf(this); WETH here would read a balance of 0 and revert.
  const onChainInputToken = isNativeInput ? XCHAINSENDER_NATIVE_SENTINEL : bridgeTokenAddr
  const commandData = encodeAcrossBridgeCommandData(
    onChainInputToken, outputTokenAddr, acrossAdapterAddr, account, BigInt(dstChainId),
    bridgeInputAmount, quote.outputAmount, acrossData, account, // fallbackReceiver
    dstSwapCmds,
  )
  return { commands: [{ command: CMD_BRIDGE, commandData }], value: isNativeInput ? bridgeInputAmount : 0n }
}
