import type { Config } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { encodeAbiParameters, parseAbiParameters, encodePacked } from 'viem'
import type { Currency } from '@uniswap/sdk-core'
import { WRAPPED_NATIVE_CURRENCY } from 'constants/tokens'
import { UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { encodeLzData, quoteLzFee, type DstSwapOpts } from './bridge/layerZero'
import { fetchAcrossSuggestedFees } from './bridge/across'
import { CMD_SWAP, CMD_BRIDGE, CMD_CONVERT, MINT_SELECTOR, LZADAPTER_ADDRESS, ACROSSADAPTER_ADDRESS, SWAP_COMPOSE_GAS, XCHAINSENDER_NATIVE_SENTINEL } from './constants'
import XChainSenderAbi from './abis/xChainSender.json'

// ─── Address helpers ──────────────────────────────────────────────────────────

export function addressToBytes32(addr: string): `0x${string}` {
  return `0x${addr.slice(2).padStart(64, '0')}` as `0x${string}`
}

/**
 * Across doesn't understand a native-ETH sentinel address — its SpokePool takes WETH
 * and wraps/unwraps ETH for you at both ends (deposit via msg.value when inputToken=WETH,
 * fill unwraps WETH→ETH when recipient is an EOA). So for bridging, native currencies must
 * be represented by their chain's WETH address, not a placeholder.
 */
export function toBridgeAddress(currency: Currency): string {
  if (!currency.isNative) return currency.address
  const wrapped = WRAPPED_NATIVE_CURRENCY[currency.chainId]
  if (!wrapped) throw new Error(`No wrapped native token configured for chain ${currency.chainId}`)
  return wrapped.address
}

// ─── SWAP command ─────────────────────────────────────────────────────────────

export function encodeURSwapCalldata(
  recipient: string,
  amountIn: bigint,
  amountOutMin: bigint,
  tokenIn: string,
  fee: number,
  tokenOut: string,
  deadline: bigint,
): `0x${string}` {
  const path = encodePacked(
    ['address', 'uint24', 'address'],
    [tokenIn as `0x${string}`, fee, tokenOut as `0x${string}`],
  )

  const swapInput = encodeAbiParameters(
    parseAbiParameters('address, uint256, uint256, bytes, bool'),
    [recipient as `0x${string}`, amountIn, amountOutMin, path, false],
  )

  const urCalldata = encodeAbiParameters(
    parseAbiParameters('bytes, bytes[], uint256'),
    ['0x00' as `0x${string}`, [swapInput], deadline],
  )

  // Prepend selector: execute(bytes,bytes[],uint256) = 0x3593564c
  return `0x3593564c${urCalldata.slice(2)}` as `0x${string}`
}

export function encodeSwapCommandData(
  inputToken: string,
  inputAmount: bigint,
  xChainSenderAddress: string,
  tokenOut: string,
  fee: number,
  deadline: bigint,
  srcChainId: number,
  amountOutMin = 0n,
): `0x${string}` {
  const universalRouter = UNIVERSAL_ROUTER_ADDRESS(srcChainId)

  const urCalldata = encodeURSwapCalldata(
    xChainSenderAddress,
    inputAmount,
    amountOutMin,
    inputToken,
    fee,
    tokenOut,
    deadline,
  )

  return encodeAbiParameters(
    parseAbiParameters(
      '(address inputToken, uint256 inputAmount, bool shouldTransferTokensBeforeSwap, address target, bytes input)',
    ),
    [{
      inputToken: inputToken as `0x${string}`,
      inputAmount,
      shouldTransferTokensBeforeSwap: true,
      target: universalRouter as `0x${string}`,
      input: urCalldata,
    }],
  )
}

/**
 * recipientMessage for dst-chain compose (lzCompose / handleV3AcrossMessage) — abi.encode(PCSCommand[], fallbackReceiver).
 * Empty commands array = plain bridge (no dst-chain action), same as before.
 */
export function encodeRecipientMessage(
  commands: { command: bigint; commandData: `0x${string}` }[],
  fallbackReceiver: string,
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('(uint256 command, bytes commandData)[], address'),
    [commands, fallbackReceiver as `0x${string}`],
  )
}

/**
 * inputTokenAddress: OFT token being sent from src chain.
 * outputTokenAddress: token recipient should end up holding on dst chain — same as
 * inputTokenAddress for a plain send, but the underlying ERC20 (e.g. USDT) when
 * unwrapToOrigin=true (burn-to-origin: dst chain receives the redeemed underlying, not the OFT).
 * dstSwap: set for BRIDGE_SWAP / SWAP_BRIDGE_SWAP — runs a SWAP command via lzCompose on arrival.
 */
export function encodeBridgeCommandData(
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
 * CONVERT command — mint OFT from its underlying stablecoin 1:1 (e.g. USDT → USDTX)
 * via the OFT contract's mint(uint256) (selector 0xa0712d68). `token` = underlying to
 * approve+consume, `target` = OFT contract address to call mint() on.
 */
export function encodeConvertCommandData(
  token: string,
  target: string,
  selector: `0x${string}` = MINT_SELECTOR,
  approveToken = true,
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters(
      '(address token, address target, bytes4 selector, bool approveToken)',
    ),
    [{
      token: token as `0x${string}`,
      target: target as `0x${string}`,
      selector,
      approveToken,
    }],
  )
}

// ─── Across Protocol (non-OFT tokens: USDT, USDC, WETH...) ────────────────────

/** abi.encode(AcrossData{exclusiveRelayer, exclusivityDeadline, quoteTimestamp, fillDeadline}) — guide §3 Bước C */
export function encodeAcrossData(
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
export function encodeAcrossBridgeCommandData(
  inputToken: string,
  outputToken: string,
  acrossAdapterAddress: string,
  recipient: string,
  destinationChainId: bigint,
  inputAmount: bigint,
  outputAmount: bigint,
  acrossData: `0x${string}`,
  fallbackReceiver: string,
  dstSwap?: { recipientOverride: string; commands: { command: bigint; commandData: `0x${string}` }[] },
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

// ─── PCS command builders ───────────────────────────────────────────────────

export interface PcsCommand {
  command: bigint
  commandData: `0x${string}`
}

export interface BuildSwapParams {
  inputTokenAddr: `0x${string}`
  rawAmount: bigint
  xChainSenderAddr: `0x${string}`
  outputTokenAddr: `0x${string}`
  poolFee: number
  srcChainId: number
}

export function buildSwapCommands(params: BuildSwapParams): PcsCommand[] {
  const { inputTokenAddr, rawAmount, xChainSenderAddr, outputTokenAddr, poolFee, srcChainId } = params
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  const commandData = encodeSwapCommandData(
    inputTokenAddr, rawAmount, xChainSenderAddr, outputTokenAddr, poolFee, deadline, srcChainId,
  )
  return [{ command: CMD_SWAP, commandData }]
}

// ─── CONVERT ────────────────────────────────────────────────────────────────

export interface BuildConvertParams {

  underlyingAddr: `0x${string}`
  oftAddr: `0x${string}`
  xChainSenderAddr: `0x${string}`
  wagmiConfig: Config
}

export async function buildConvertCommands(params: BuildConvertParams): Promise<PcsCommand[]> {
  const { underlyingAddr, oftAddr, xChainSenderAddr, wagmiConfig } = params

  const isWhitelisted = await readContract(wagmiConfig, {
    address: xChainSenderAddr,
    abi: XChainSenderAbi,

    functionName: 'isSwapFunctionWhitelisted',
    args: [oftAddr, MINT_SELECTOR],
  }) as boolean
  if (!isWhitelisted) {
    throw new Error(`ConvertBridge: mint() not whitelisted for ${oftAddr} on XChainSender (${xChainSenderAddr})`)
  }

  const commandData = encodeConvertCommandData(underlyingAddr, oftAddr, MINT_SELECTOR, true)
  return [{ command: CMD_CONVERT, commandData }]
}

/**
 * Dst-chain SWAP embedded in the bridge's recipientMessage (BRIDGE_SWAP / SWAP_BRIDGE_SWAP) —
 * runs automatically via lzCompose / handleV3AcrossMessage right after the bridge lands, instead
 * of a separate top-level XChainSender command (there is no XChainSender on the dst chain to run one).
 */
export interface DstSwapParams {
  /** Final buy-token address on dst chain (the recipientMessage's SWAP output). */
  outputCurrencyAddr: `0x${string}`
  poolFee: number
  /** Final recipient of the swap output — the user's own EOA (not XChainSender, which doesn't
   * run on the dst chain for this step). */
  account: `0x${string}`
  dstChainId: number
}

export interface BuildBridgeParams {
  protocol: 'lz' | 'across'
  account: `0x${string}`
  srcChainId: number
  dstChainId: number
  bridgeTokenAddr: `0x${string}`
  bridgeInputAmount: bigint
  outputTokenAddr?: `0x${string}`
  unwrapToOrigin?: boolean
  isNativeInput?: boolean
  wagmiConfig: Config
  dstSwap?: DstSwapParams
}

export interface BuildBridgeResult {
  commands: PcsCommand[]
  value: bigint
}

export async function buildBridgeCommands(params: BuildBridgeParams): Promise<BuildBridgeResult> {
  const {
    protocol, account, srcChainId, dstChainId, bridgeTokenAddr, bridgeInputAmount,
    outputTokenAddr, unwrapToOrigin = false, isNativeInput = false, wagmiConfig, dstSwap,
  } = params
  const dstChainIdBig = BigInt(dstChainId)
  // +1h — dst-chain swap executes later, via bridge delivery / compose, not immediately.
  const dstSwapDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600)

  if (protocol === 'lz') {
    const lzAdapterAddr = LZADAPTER_ADDRESS[srcChainId]
    if (!lzAdapterAddr) throw new Error(`LZAdapter not deployed on chain ${srcChainId}`)

    let dstSwapOpts: DstSwapOpts | undefined
    if (dstSwap) {
      const dstLzAdapterAddr = LZADAPTER_ADDRESS[dstChainId]
      if (!dstLzAdapterAddr) throw new Error(`LZAdapter not deployed on dst chain ${dstChainId}`)
      // OFT bridges 1:1 — bridgeInputAmount is what lands on dst chain, i.e. the swap's inputAmount.
      const swapCommandData = encodeSwapCommandData(
        outputTokenAddr ?? bridgeTokenAddr, bridgeInputAmount, dstSwap.account,
        dstSwap.outputCurrencyAddr, dstSwap.poolFee, dstSwapDeadline, dstChainId,
      )
      dstSwapOpts = {
        recipientOverride: dstLzAdapterAddr,
        recipientMessage: encodeRecipientMessage([{ command: CMD_SWAP, commandData: swapCommandData }], dstSwap.account),
        composeGas: SWAP_COMPOSE_GAS,
      }
    }

    const nativeFee = await quoteLzFee(
      bridgeTokenAddr, account, dstChainIdBig, srcChainId, wagmiConfig, unwrapToOrigin, dstSwapOpts,
      outputTokenAddr ?? bridgeTokenAddr,
    )
    const commandData = encodeBridgeCommandData(
      bridgeTokenAddr, lzAdapterAddr, account, dstChainIdBig, nativeFee,
      outputTokenAddr ?? bridgeTokenAddr, unwrapToOrigin, dstSwapOpts,
    )
    // Native input (e.g. JOC): msg.value must cover both the bridged amount and the LZ fee —
    // XChainSender.send() pulls inputAmount from msg.value for native, not via transferFrom.
    // ERC20 input: only the LZ fee is native; the token itself moves via transferFrom/permit2.
    const value = nativeFee + (isNativeInput ? bridgeInputAmount : 0n)
    return { commands: [{ command: CMD_BRIDGE, commandData }], value }


  }

  const acrossAdapterAddr = ACROSSADAPTER_ADDRESS[srcChainId]
  if (!acrossAdapterAddr) throw new Error(`AcrossAdapter not deployed on chain ${srcChainId}`)
  if (!outputTokenAddr) throw new Error('Across bridge: outputTokenAddr required')

  const quote = await fetchAcrossSuggestedFees(bridgeTokenAddr, outputTokenAddr, srcChainId, dstChainId, bridgeInputAmount)
  const acrossData = encodeAcrossData(
    quote.exclusiveRelayer, quote.exclusivityDeadline, quote.quoteTimestamp, quote.fillDeadline,
  )

  let dstSwapCmds: { recipientOverride: string; commands: PcsCommand[] } | undefined
  if (dstSwap) {
    const dstAcrossAdapterAddr = ACROSSADAPTER_ADDRESS[dstChainId]
    if (!dstAcrossAdapterAddr) throw new Error(`AcrossAdapter not deployed on dst chain ${dstChainId}`)
    // quote.outputAmount = real amount landing post-relayer-fee — that's the swap's inputAmount.
    const swapCommandData = encodeSwapCommandData(
      outputTokenAddr, quote.outputAmount, dstSwap.account,
      dstSwap.outputCurrencyAddr, dstSwap.poolFee, dstSwapDeadline, dstChainId,
    )
    dstSwapCmds = { recipientOverride: dstAcrossAdapterAddr, commands: [{ command: CMD_SWAP, commandData: swapCommandData }] }
  }

  // BridgeData.inputToken on-chain must be the native sentinel (address(0)), not WETH —
  // Dispatcher.dispatch() branches on inputToken == Constants.ETH to pick address(this).balance
  // vs ERC20(inputToken).balanceOf(this); WETH here would hit the ERC20 branch and read a
  // balance of 0 (native ETH sits in msg.value, never as WETH tokens), reverting. WETH is only
  // needed above for the Across suggested-fees API call, which requires the real token address.
  const onChainInputToken = isNativeInput ? XCHAINSENDER_NATIVE_SENTINEL : bridgeTokenAddr
  const commandData = encodeAcrossBridgeCommandData(
    onChainInputToken, outputTokenAddr, acrossAdapterAddr, account, dstChainIdBig,
    bridgeInputAmount, quote.outputAmount, acrossData, account, // fallbackReceiver
    dstSwapCmds,
  )
  return { commands: [{ command: CMD_BRIDGE, commandData }], value: isNativeInput ? bridgeInputAmount : 0n }
}
