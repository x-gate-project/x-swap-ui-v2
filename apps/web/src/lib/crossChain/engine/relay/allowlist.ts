import { decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, isAddressEqual, maxUint256, type Address } from 'viem'
import type { AggregatorProviderId, SwapRequest, TxRequest } from 'lib/crossChain/engine/relay/types'
import { ProviderError } from 'lib/crossChain/engine/relay/types'
import { UniverseChainId } from 'uniswap/src/types/chains'

/**
 * Hand-configured deposit targets. Never taken from a provider API.
 * Relay: GET /chains `protocol.v2.depository` + `contracts.{erc20Router,approvalProxy,relayReceiver}`.
 */
const RELAY_MAINNET = [
  '0x4cd00e387622c35bddb9b4c962c136462338bc31', // depository (v2)
  '0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f', // erc20Router
  '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be', // approvalProxy
  '0xa5f565650890fba1824ee0f21ebbbf660a179934', // relayReceiver
]
const RELAY_TESTNET_DEPOSITORY = '0x5feab8db4534f9f7e2669bb260c57a01ad1c12e3'
const RELAY_TESTNET_RECEIVER = '0x4cec3461dd63f22554b7fa2abba5bbfe9e86ddfd'

const ALLOWLIST: Record<AggregatorProviderId, Record<number, readonly string[]>> = {
  relay: {
    [UniverseChainId.Mainnet]: RELAY_MAINNET,
    [UniverseChainId.Optimism]: RELAY_MAINNET,
    [UniverseChainId.Bnb]: RELAY_MAINNET,
    [UniverseChainId.Base]: RELAY_MAINNET,
    [UniverseChainId.ArbitrumOne]: RELAY_MAINNET,
    [UniverseChainId.Avalanche]: RELAY_MAINNET,
    [UniverseChainId.Sepolia]: [
      RELAY_TESTNET_DEPOSITORY,
      RELAY_TESTNET_RECEIVER,
      '0xa1bea5fe917450041748dbbbe7e9ac57a4bbebab',
      '0x77a917df7a084b7b3e43517ae28373c2a5492625',
    ],
    [UniverseChainId.Base_Sepolia]: [
      RELAY_TESTNET_DEPOSITORY,
      RELAY_TESTNET_RECEIVER,
      '0xf5042e6ffac5a625d4e7848e0b01373d8eb9e222',
      '0xbbbfd134e9b44bfb5123898ba36b01de7ab93d98',
    ],
  },
}

/** USDT-like tokens that revert on approve(non-zero) when allowance is already non-zero. */
const APPROVE_RESET = new Set([`${UniverseChainId.Mainnet}:0xdac17f958d2ee523a2206206994597c13d831ec7`])

export function supportsChain(provider: AggregatorProviderId, chainId: number): boolean {
  return !!ALLOWLIST[provider][chainId]
}

/**
 * Rejects a provider quote unless: deposit runs on the source chain, targets an allowlisted contract,
 * keeps the exact input amount, sends msg.value only for native input, and every provider approval
 * is approve(depositTarget) on the input token. Provider approval amounts are ignored (often max) —
 * the executor rebuilds them with buildApprovals.
 */
export function validateDeposit(
  provider: AggregatorProviderId,
  req: SwapRequest,
  deposit: TxRequest,
  providerApprovals: readonly { to: string; data: string }[],
  inputAmount: bigint,
): void {
  if (deposit.chainId !== req.src.chainId) {throw reject(`deposit on chain ${deposit.chainId}`)}
  const allowed = ALLOWLIST[provider][deposit.chainId] ?? []
  if (!allowed.some((a) => isAddressEqual(a as Address, deposit.to))) {throw reject(`target ${deposit.to} not allowlisted`)}
  if (inputAmount !== req.src.amount) {throw reject(`input amount ${inputAmount} != ${req.src.amount}`)}
  const expectedValue = req.src.token === 'native' ? req.src.amount : 0n
  if (deposit.value !== expectedValue) {throw reject(`msg.value ${deposit.value} != ${expectedValue}`)}

  for (const a of providerApprovals) {
    if (req.src.token === 'native' || !isAddressEqual(a.to as Address, req.src.token)) {
      throw reject('approval on a token other than the input')
    }
    let spender: Address
    try {
      const d = decodeFunctionData({ abi: erc20Abi, data: a.data as `0x${string}` })
      if (d.functionName !== 'approve') {throw new Error()}
      spender = d.args[0]
    } catch {
      throw reject('approval tx is not approve()')
    }
    if (!isAddressEqual(spender, deposit.to)) {throw reject(`spender ${spender} != deposit target ${deposit.to}`)}
  }
}

/** Exact-amount approvals from current allowance; approve(0) first for USDT-like tokens. Never unlimited. */
export function buildApprovals(src: SwapRequest['src'], spender: Address, allowance: bigint): TxRequest[] {
  if (src.token === 'native' || allowance >= src.amount) {return []}
  if (src.amount === maxUint256) {throw reject('unlimited approval')}
  const token = getAddress(src.token)
  const approve = (amount: bigint, kind: TxRequest['kind']): TxRequest => ({
    chainId: src.chainId,
    kind,
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
    value: 0n,
  })
  const needsReset = allowance > 0n && APPROVE_RESET.has(`${src.chainId}:${token.toLowerCase()}`)
  return [...(needsReset ? [approve(0n, 'approve-reset')] : []), approve(src.amount, 'approve')]
}


const reject = (reason: string) => new ProviderError('rejected', reason)
