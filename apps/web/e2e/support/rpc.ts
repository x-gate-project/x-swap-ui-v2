import {
  Hex,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  numberToHex,
  parseAbi,
  toFunctionSelector,
  zeroHash,
} from 'viem'

import { MockChain, NATIVE, PERMIT2_ADDRESS } from './mockChain'

/** The `rpcUrls.appOnly` hosts the app reads chains through (packages/uniswap/src/constants/chains.ts). */
export const RPC_HOSTS: Record<string, number> = {
  'mainnet.infura.io': 1,
  'sepolia.infura.io': 11155111,
  'rpc-1.testnet.japanopenchain.org': 10081,
  'rpc-1.japanopenchain.org': 81,
}

export type JsonRpcRequest = { jsonrpc?: '2.0'; id?: number | string; method: string; params?: unknown[] }
type JsonRpcResponse = {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: { code: number; message: string }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

// Multicall3, read by viem's batched public client.
const aggregate3Abi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
])
// On both multicall contracts: the native balance read inside a batch.
const getEthBalanceAbi = parseAbi(['function getEthBalance(address addr) view returns (uint256 balance)'])
// UniswapInterfaceMulticall, read by the redux multicall updater.
const interfaceMulticallAbi = parseAbi([
  'struct Call { address target; uint256 gasLimit; bytes callData; }',
  'struct Result { bool success; uint256 gasUsed; bytes returnData; }',
  'function multicall(Call[] calls) returns (uint256 blockNumber, Result[] returnData)',
])
const permit2Abi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
])
const erc20MetadataAbi = parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)'])

const SELECTORS = {
  aggregate3: toFunctionSelector('aggregate3((address,bool,bytes)[])'),
  getEthBalance: toFunctionSelector('getEthBalance(address)'),
  multicall: toFunctionSelector('multicall((address,uint256,bytes)[])'),
  permit2Allowance: toFunctionSelector('allowance(address,address,address)'),
}

type CallResult = { success: boolean; data: Hex }

/** Answers one `eth_call` from MockChain state. Unknown calls revert, like a call to a contract that is not there. */
function call(chain: MockChain, chainId: number, to: string, data: Hex): CallResult {
  const selector = data.slice(0, 10)
  try {
    if (selector === SELECTORS.multicall) {
      const { args } = decodeFunctionData({ abi: interfaceMulticallAbi, data })
      const results = args[0].map((c) => {
        const r = call(chain, chainId, c.target, c.callData)
        return { success: r.success, gasUsed: 30_000n, returnData: r.data }
      })
      return {
        success: true,
        data: encodeFunctionResult({
          abi: interfaceMulticallAbi,
          functionName: 'multicall',
          result: [chain.blockNumber, results],
        }),
      }
    }
    if (selector === SELECTORS.aggregate3) {
      const { args } = decodeFunctionData({ abi: aggregate3Abi, data })
      const results = args[0].map((c) => {
        const r = call(chain, chainId, c.target, c.callData)
        return { success: r.success, returnData: r.data }
      })
      return {
        success: true,
        data: encodeFunctionResult({ abi: aggregate3Abi, functionName: 'aggregate3', result: results }),
      }
    }
    if (selector === SELECTORS.getEthBalance) {
      const { args } = decodeFunctionData({ abi: getEthBalanceAbi, data })
      return {
        success: true,
        data: encodeFunctionResult({
          abi: getEthBalanceAbi,
          functionName: 'getEthBalance',
          result: chain.balance(chainId, NATIVE) * (args[0].toLowerCase() === chain.account.toLowerCase() ? 1n : 0n),
        }),
      }
    }
    if (to.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() && selector === SELECTORS.permit2Allowance) {
      return {
        success: true,
        data: encodeFunctionResult({ abi: permit2Abi, functionName: 'allowance', result: [0n, 0, 0] }),
      }
    }

    const token = chain.token(chainId, to)
    if (token) {
      const { functionName, args } = decodeFunctionData({ abi: [...erc20Abi, ...erc20MetadataAbi], data })
      switch (functionName) {
        case 'balanceOf':
          return {
            success: true,
            data: encodeFunctionResult({
              abi: erc20Abi,
              functionName: 'balanceOf',
              result:
                (args?.[0] as string).toLowerCase() === chain.account.toLowerCase() ? chain.balance(chainId, to) : 0n,
            }),
          }
        case 'allowance':
          return { success: true, data: encodeFunctionResult({ abi: erc20Abi, functionName: 'allowance', result: 0n }) }
        case 'decimals':
          return {
            success: true,
            data: encodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', result: token.decimals }),
          }
        case 'symbol':
          return {
            success: true,
            data: encodeFunctionResult({ abi: erc20MetadataAbi, functionName: 'symbol', result: token.symbol }),
          }
        case 'name':
          return {
            success: true,
            data: encodeFunctionResult({
              abi: erc20MetadataAbi,
              functionName: 'name',
              result: token.name ?? token.symbol,
            }),
          }
        case 'totalSupply':
          return {
            success: true,
            data: encodeFunctionResult({ abi: erc20Abi, functionName: 'totalSupply', result: 10n ** 30n }),
          }
      }
    }
  } catch {
    // Undecodable calldata: fall through to a revert.
  }
  return { success: false, data: '0x' }
}

function receipt(chain: MockChain, hash: Hex) {
  const tx = chain.txs.get(hash)
  if (!tx || tx.status === 'pending' || tx.blockNumber === undefined) {
    return null
  }
  return {
    transactionHash: tx.hash,
    transactionIndex: '0x0',
    blockHash: zeroHash.replace(/0$/, '1'),
    blockNumber: numberToHex(tx.blockNumber),
    from: tx.from,
    to: tx.to,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x3b9aca00',
    contractAddress: null,
    logs: [],
    logsBloom: `0x${'0'.repeat(512)}`,
    status: tx.status === 'success' ? '0x1' : '0x0',
    type: '0x2',
  }
}

function transaction(chain: MockChain, hash: Hex) {
  const tx = chain.txs.get(hash)
  if (!tx) {
    return null
  }
  return {
    hash: tx.hash,
    blockHash: tx.blockNumber === undefined ? null : zeroHash.replace(/0$/, '1'),
    blockNumber: tx.blockNumber === undefined ? null : numberToHex(tx.blockNumber),
    transactionIndex: tx.blockNumber === undefined ? null : '0x0',
    from: tx.from,
    to: tx.to,
    input: tx.data,
    value: numberToHex(tx.value),
    nonce: '0x0',
    gas: '0x30d40',
    maxFeePerGas: '0x77359400',
    maxPriorityFeePerGas: '0x3b9aca00',
    type: '0x2',
    chainId: numberToHex(tx.chainId),
    v: '0x0',
    r: '0x1',
    s: '0x1',
  }
}

function block(chain: MockChain, tag: unknown) {
  const number = typeof tag === 'string' && tag.startsWith('0x') ? BigInt(tag) : chain.blockNumber
  return {
    number: numberToHex(number),
    hash: numberToHex(number, { size: 32 }),
    parentHash: numberToHex(number - 1n, { size: 32 }),
    timestamp: numberToHex(Math.floor(Date.now() / 1000)),
    baseFeePerGas: '0x3b9aca00',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    miner: `0x${'0'.repeat(40)}`,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    nonce: '0x0000000000000000',
    sha3Uncles: zeroHash,
    logsBloom: `0x${'0'.repeat(512)}`,
    transactionsRoot: zeroHash,
    stateRoot: zeroHash,
    receiptsRoot: zeroHash,
    mixHash: zeroHash,
    size: '0x0',
    transactions: [],
    uncles: [],
  }
}

/** Answers one read-only JSON-RPC method for `chainId` from MockChain state. */
export function handleRpc(chain: MockChain, chainId: number, method: string, params: unknown[] = []): unknown {
  chain.record(method)
  switch (method) {
    case 'eth_chainId':
      return numberToHex(chainId)
    case 'net_version':
      return String(chainId)
    case 'eth_blockNumber':
      return numberToHex(chain.blockNumber)
    case 'eth_getBlockByNumber':
    case 'eth_getBlockByHash':
      return block(chain, params[0])
    case 'eth_getBalance':
      return numberToHex(
        String(params[0]).toLowerCase() === chain.account.toLowerCase() ? chain.balance(chainId, NATIVE) : 0n,
      )
    case 'eth_getTransactionCount':
      return numberToHex(chain.sent().filter((tx) => tx.chainId === chainId).length)
    case 'eth_getCode':
      return '0x'
    case 'eth_estimateGas':
      return '0x30d40'
    case 'eth_gasPrice':
      return '0x77359400'
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00'
    case 'eth_feeHistory':
      return {
        oldestBlock: numberToHex(chain.blockNumber),
        baseFeePerGas: ['0x3b9aca00', '0x3b9aca00'],
        gasUsedRatio: [0.5],
        reward: [['0x3b9aca00']],
      }
    case 'eth_getTransactionReceipt':
      return receipt(chain, params[0] as Hex)
    case 'eth_getTransactionByHash':
      return transaction(chain, params[0] as Hex)
    case 'eth_getLogs':
      return []
    case 'eth_call': {
      const { to, data, input } = params[0] as { to: string; data?: Hex; input?: Hex }
      const result = call(chain, chainId, to, (data ?? input ?? '0x') as Hex)
      if (!result.success) {
        throw new RpcError(3, 'execution reverted')
      }
      return result.data
    }
  }
  chain.unhandled.add(method)
  throw new RpcError(-32601, `e2e rpc stub: method ${method} not handled`)
}

export function respond(chain: MockChain, chainId: number, request: JsonRpcRequest): JsonRpcResponse {
  try {
    return { jsonrpc: '2.0', id: request.id, result: handleRpc(chain, chainId, request.method, request.params) }
  } catch (e) {
    const error = e instanceof RpcError ? e : new RpcError(-32603, String(e))
    return { jsonrpc: '2.0', id: request.id, error: { code: error.code, message: error.message } }
  }
}
