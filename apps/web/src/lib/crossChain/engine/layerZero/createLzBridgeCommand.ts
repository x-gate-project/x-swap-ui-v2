import { encodeAbiParameters, parseAbiParameters } from 'viem'
import {
  addressToBytes32, buildConvertCommands, encodeRecipientMessage, encodeSwapCommandData, type PcsCommand,
} from 'lib/crossChain/commandBuilders'
import {
  CMD_BRIDGE, CMD_SWAP, CONTRACT_BALANCE, LZADAPTER_ADDRESS, SWAP_COMPOSE_GAS, UNDERLYING_TO_OFT_SYMBOL,
  XCHAINSENDER_ADDRESS, XCHAINSENDER_NATIVE_SENTINEL, getOftAddress, getOftSymbolByAddress,
} from 'lib/crossChain/constants'
import { type DstSwapOpts, encodeLzData, quoteLzFee } from 'lib/crossChain/engine/layerZero/lzFee'
import type { BuildBridgeParams } from 'lib/crossChain/bridge'

/**
 * inputTokenAddress: OFT token being sent from src chain.
 * outputTokenAddress: token recipient should end up holding on dst chain — same as
 * inputTokenAddress for a plain send, but the underlying ERC20 (e.g. USDT) when
 * unwrapToOrigin=true (burn-to-origin: dst chain receives the redeemed underlying, not the OFT).
 * dstSwap: set for BRIDGE_SWAP / SWAP_BRIDGE_SWAP — runs a SWAP command via lzCompose on arrival.
 */
function encodeLzBridgeCommandData(
  inputTokenAddress: string,
  lzAdapterAddress: string,
  recipient: string,
  dstChainId: bigint,
  nativeFee: bigint,
  outputTokenAddress: string = inputTokenAddress,
  unwrapToOrigin = false,
  dstSwap?: DstSwapOpts,
): `0x${string}` {
  const lzData = encodeLzData(nativeFee, unwrapToOrigin, dstSwap?.composeGas)
  const finalRecipient = dstSwap?.recipientOverride ?? recipient

  return encodeAbiParameters(
    parseAbiParameters(
      '(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, address refundRecipient, address target, bytes data, uint256 destinationChainId, bytes32 recipient, bytes recipientMessage)',
    ),
    [{
      inputToken: addressToBytes32(inputTokenAddress),
      outputToken: addressToBytes32(outputTokenAddress),
      inputAmount: 1n, // placeholder — XChainSender uses CONTRACT_BALANCE internally
      outputAmount: 0n,
      refundRecipient: recipient as `0x${string}`,
      target: lzAdapterAddress as `0x${string}`,
      data: lzData,
      destinationChainId: dstChainId,
      recipient: addressToBytes32(finalRecipient),
      recipientMessage: dstSwap?.recipientMessage ?? '0x' as `0x${string}`,
    }],
  )
}

/**
 * Stablecoin -> OFT (e.g. USDT -> USDTX): XChainSender mints the src-chain OFT from the underlying
 * (CONVERT), then the minted OFT is bridged. Only for plain bridges (no dst swap / burn-to-origin).
 */
export async function createLzBridgeCommand(
  params: BuildBridgeParams,
): Promise<{ commands: PcsCommand[]; value: bigint; isCrossChainSwap?: boolean }> {
  const { srcChainId, dstChainId, bridgeTokenAddr, outputTokenAddr, unwrapToOrigin, isNativeInput, dstSwap, wagmiConfig } = params
  const oftSymbol = outputTokenAddr && getOftSymbolByAddress(outputTokenAddr, dstChainId)
  const oftAddr = oftSymbol && getOftAddress(oftSymbol, srcChainId)
  const isMint = !!oftAddr && !isNativeInput && !dstSwap && !unwrapToOrigin &&
    Object.values(UNDERLYING_TO_OFT_SYMBOL).includes(oftSymbol) &&
    bridgeTokenAddr.toLowerCase() !== oftAddr.toLowerCase()
  if (!isMint) {return createLzSendCommand(params)}

  const xChainSenderAddr = XCHAINSENDER_ADDRESS[srcChainId]
  if (!xChainSenderAddr) {throw new Error(`XChainSender not deployed on chain ${srcChainId}`)}
  const convertCommands = await buildConvertCommands({ underlyingAddr: bridgeTokenAddr, oftAddr, xChainSenderAddr, wagmiConfig })
  // outputTokenAddr omitted (= src OFT) — same encoding as the pre-refactor convert+bridge flow.
  const { commands, value } = await createLzSendCommand({ ...params, bridgeTokenAddr: oftAddr, outputTokenAddr: undefined })
  return { commands: [...convertCommands, ...commands], value, isCrossChainSwap: true }
}

async function createLzSendCommand({
  account, srcChainId, dstChainId, bridgeTokenAddr, bridgeInputAmount,
  outputTokenAddr, unwrapToOrigin = false, isNativeInput = false, wagmiConfig, dstSwap,
}: BuildBridgeParams): Promise<{ commands: PcsCommand[]; value: bigint }> {
  const lzAdapterAddr = LZADAPTER_ADDRESS[srcChainId]
  if (!lzAdapterAddr) {throw new Error(`LZAdapter not deployed on chain ${srcChainId}`)}
  // Native input: LZAdapter/XChainSender expect the contract's own zero-address sentinel
  // (Constants.ETH), NOT the WETH-wrap convention — see x-chain-sender e2e/layerzero/
  // japan-open-chain-testnet/joc/bridge.e2e.ts.
  const inputToken = isNativeInput ? XCHAINSENDER_NATIVE_SENTINEL : bridgeTokenAddr
  const outputToken = outputTokenAddr ?? inputToken

  let dstSwapOpts: DstSwapOpts | undefined
  if (dstSwap) {
    const dstLzAdapterAddr = LZADAPTER_ADDRESS[dstChainId]
    if (!dstLzAdapterAddr) {throw new Error(`LZAdapter not deployed on dst chain ${dstChainId}`)}
    // +1h — dst-chain swap executes later, via compose, not immediately.
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
    // Adapter forwards whatever landed (CONTRACT_BALANCE). OFT bridges 1:1, so bridgeInputAmount
    // (leg1 min output / raw input) is the worst case.
    // ponytail: ignores OFT dust removal (amount truncated to sharedDecimals) — negligible vs slippage.
    const swapCommandData = encodeSwapCommandData(
      outputToken, CONTRACT_BALANCE, dstSwap.account,
      dstSwap.trade, dstSwap.slippageTolerance, deadline, dstChainId, bridgeInputAmount,
    )
    dstSwapOpts = {
      recipientOverride: dstLzAdapterAddr,
      recipientMessage: encodeRecipientMessage([{ command: CMD_SWAP, commandData: swapCommandData }], dstSwap.account),
      composeGas: SWAP_COMPOSE_GAS,
    }
  }

  const dstChainIdBig = BigInt(dstChainId)
  const nativeFee = await quoteLzFee(
    inputToken, account, dstChainIdBig, srcChainId, wagmiConfig, unwrapToOrigin, dstSwapOpts, outputToken,
  )
  const commandData = encodeLzBridgeCommandData(
    inputToken, lzAdapterAddr, account, dstChainIdBig, nativeFee, outputToken, unwrapToOrigin, dstSwapOpts,
  )
  // Native input: msg.value covers both the bridged amount and the LZ fee. ERC20 input: only the fee.
  const value = nativeFee + (isNativeInput ? bridgeInputAmount : 0n)
  return { commands: [{ command: CMD_BRIDGE, commandData }], value }
}
