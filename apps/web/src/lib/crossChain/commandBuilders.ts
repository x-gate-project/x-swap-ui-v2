import type { Config } from 'wagmi'
import { readContract } from 'wagmi/actions'
import {
  type Hex, bytesToHex, decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData,
  hexToBytes, parseAbi, parseAbiParameters,
} from 'viem'
import { type Currency, type Percent, TradeType } from '@uniswap/sdk-core'
import type { Trade } from '@uniswap/router-sdk'
import { WRAPPED_NATIVE_CURRENCY } from 'constants/tokens'
import { ROUTER_AS_RECIPIENT, SwapRouter, UNIVERSAL_ROUTER_ADDRESS } from '@uniswap/universal-router-sdk'
import { CMD_SWAP, CMD_CONVERT, CONTRACT_BALANCE, MINT_SELECTOR } from 'lib/crossChain/constants'
import XChainSenderAbi from 'lib/crossChain/abis/xChainSender.json'

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
  if (!currency.isNative) {return currency.address}
  const wrapped = WRAPPED_NATIVE_CURRENCY[currency.chainId]
  if (!wrapped) {throw new Error(`No wrapped native token configured for chain ${currency.chainId}`)}
  return wrapped.address
}

// ─── SWAP command ─────────────────────────────────────────────────────────────

const UR_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline)'])
// UR CommandType ids (universal-router-sdk routerCommands); high bits are flags (allowRevert).
const UR_V3_SWAP_EXACT_IN = 0x00
const UR_SWEEP = 0x04
const UR_V2_SWAP_EXACT_IN = 0x08
const UR_UNWRAP_WETH = 0x0c
const UR_CMD_MASK = 0x3f
const V3_SWAP_PARAMS = parseAbiParameters('address, uint256, uint256, bytes, bool')
const V2_SWAP_PARAMS = parseAbiParameters('address, uint256, uint256, address[], bool')

/**
 * UR execute() calldata for any SOR trade (V2/V3/mixed/split), adapted to XChainSender, which
 * transfers the input to UR before calling it (payerIsUser=false):
 *  - the last route's first hop spends CONTRACT_BALANCE, so it absorbs any gap between the quoted
 *    and the actually arrived amount (dst swaps: bridge fee drift, leg1 slippage) and leaves no dust in UR.
 *  - since that route takes the whole gap, per-route mins would be wrong: they are zeroed, outputs stay
 *    in UR and one final SWEEP/UNWRAP_WETH enforces the total min.
 * minAmountIn: worst-case amount reaching UR — total min is scaled by minAmountIn / trade.inputAmount.
 */
export function encodeURSwapCalldata(
  recipient: string,
  trade: Trade<Currency, Currency, TradeType>,
  slippageTolerance: Percent,
  deadline: bigint,
  minAmountIn?: bigint,
): Hex {
  if (trade.tradeType !== TradeType.EXACT_INPUT) {throw new Error('Swap: only exact-input trades supported')}
  if (trade.inputAmount.currency.isNative) {throw new Error('Swap: native input not supported')}

  const { calldata } = SwapRouter.swapERC20CallParameters(trade, {
    slippageTolerance,
    recipient: ROUTER_AS_RECIPIENT,
    useRouterBalance: true,
    deadlineOrPreviousBlockhash: deadline.toString(),
  })
  const { args: [commandsHex, sdkInputs] } = decodeFunctionData({ abi: UR_ABI, data: calldata as Hex })
  const commands = [...hexToBytes(commandsHex)]
  const inputs = [...sdkInputs]

  // Drop SDK's own tail (SWEEP/UNWRAP_WETH to ROUTER) — replaced by ours below.
  while (commands.length && [UR_SWEEP, UR_UNWRAP_WETH].includes(commands[commands.length - 1] & UR_CMD_MASK)) {
    commands.pop()
    inputs.pop()
  }

  let lastRoutePatched = false
  for (let i = commands.length - 1; i >= 0; i--) {
    const type = commands[i] & UR_CMD_MASK
    if (type !== UR_V3_SWAP_EXACT_IN && type !== UR_V2_SWAP_EXACT_IN) {
      throw new Error(`Swap: unexpected UR command 0x${type.toString(16)}`)
    }
    // V2/V3 exact-in share the head (recipient, amountIn, amountOutMin, path, payerIsUser); only path type differs.
    const params = type === UR_V3_SWAP_EXACT_IN ? V3_SWAP_PARAMS : V2_SWAP_PARAMS
    const [to, amountIn, , path, payerIsUser] = decodeAbiParameters(params, inputs[i])
    const useBalance: boolean = !lastRoutePatched && amountIn !== CONTRACT_BALANCE
    lastRoutePatched ||= useBalance
    inputs[i] = encodeAbiParameters(params, [to, useBalance ? CONTRACT_BALANCE : amountIn, 0n, path, payerIsUser] as never)
  }

  const quotedIn = BigInt(trade.inputAmount.quotient.toString())
  let totalMin = BigInt(trade.minimumAmountOut(slippageTolerance).quotient.toString())
  if (minAmountIn !== undefined && minAmountIn < quotedIn) {totalMin = (totalMin * minAmountIn) / quotedIn}

  const output = trade.outputAmount.currency
  if (output.isNative) {
    commands.push(UR_UNWRAP_WETH)
    inputs.push(encodeAbiParameters(parseAbiParameters('address, uint256'), [recipient as Hex, totalMin]))
  } else {
    commands.push(UR_SWEEP)
    inputs.push(encodeAbiParameters(parseAbiParameters('address, address, uint256'), [output.address as Hex, recipient as Hex, totalMin]))
  }

  return encodeFunctionData({ abi: UR_ABI, functionName: 'execute', args: [bytesToHex(Uint8Array.from(commands)), inputs, deadline] })
}

/**
 * XChainSender SWAP commandData. inputAmount = CONTRACT_BALANCE on dst chain (adapter forwards
 * whatever arrived); minAmountIn = worst-case arrival, used to scale the swap's total min out.
 */
export function encodeSwapCommandData(
  inputToken: string,
  inputAmount: bigint,
  recipient: string,
  trade: Trade<Currency, Currency, TradeType>,
  slippageTolerance: Percent,
  deadline: bigint,
  chainId: number,
  minAmountIn?: bigint,
): `0x${string}` {
  const universalRouter = UNIVERSAL_ROUTER_ADDRESS(chainId)

  const urCalldata = encodeURSwapCalldata(recipient, trade, slippageTolerance, deadline, minAmountIn)

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

// ─── PCS command builders ───────────────────────────────────────────────────

export interface PcsCommand {
  command: bigint
  commandData: `0x${string}`
}

export interface BuildSwapParams {
  inputTokenAddr: `0x${string}`
  rawAmount: bigint
  xChainSenderAddr: `0x${string}`
  trade: Trade<Currency, Currency, TradeType>
  slippageTolerance: Percent
  srcChainId: number
}

export function buildSwapCommands(params: BuildSwapParams): PcsCommand[] {
  const { inputTokenAddr, rawAmount, xChainSenderAddr, trade, slippageTolerance, srcChainId } = params
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  const commandData = encodeSwapCommandData(
    inputTokenAddr, rawAmount, xChainSenderAddr, trade, slippageTolerance, deadline, srcChainId, rawAmount,
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
