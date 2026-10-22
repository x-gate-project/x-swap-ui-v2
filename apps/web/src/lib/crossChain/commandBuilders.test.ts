import { Percent, TradeType } from '@uniswap/sdk-core'
import { Pair, Route as V2Route } from '@uniswap/v2-sdk'
import { Route as V3Route } from '@uniswap/v3-sdk'
import { encodeSwapCommandData, encodeURSwapCalldata } from 'lib/crossChain/commandBuilders'
import { CONTRACT_BALANCE } from 'lib/crossChain/constants'
import { ClassicTrade, QuoteMethod } from 'state/routing/types'
import {
  TEST_POOL_12, TEST_TOKEN_1, TEST_TOKEN_2, TEST_TRADE_EXACT_INPUT, TEST_TRADE_EXACT_OUTPUT, toCurrencyAmount,
} from 'test-utils/constants'
import { decodeAbiParameters, decodeFunctionData, hexToBytes, parseAbi, parseAbiParameters } from 'viem'

const UR_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline)'])
const SWAP = parseAbiParameters('address, uint256, uint256, bytes, bool') // V3; V2 head decodes the same
const V2_SWAP = parseAbiParameters('address, uint256, uint256, address[], bool')
const SWEEP = parseAbiParameters('address, address, uint256')
const RECIPIENT = '0x00000000000000000000000000000000000000AA' // checksummed, as viem decodes
const SLIPPAGE = new Percent(1, 100)

const PAIR_12 = new Pair(toCurrencyAmount(TEST_TOKEN_1, 1e9), toCurrencyAmount(TEST_TOKEN_2, 1e9))

function decode(calldata: `0x${string}`) {
  const { args: [cmds, inputs] } = decodeFunctionData({ abi: UR_ABI, data: calldata })
  return { cmds: [...hexToBytes(cmds)], inputs }
}

function trade(v2: number, v3: number) {
  return new ClassicTrade({
    v2Routes: v2 ? [{
      routev2: new V2Route([PAIR_12], TEST_TOKEN_1, TEST_TOKEN_2),
      inputAmount: toCurrencyAmount(TEST_TOKEN_1, v2), outputAmount: toCurrencyAmount(TEST_TOKEN_2, v2),
    }] : [],
    v3Routes: v3 ? [{
      routev3: new V3Route([TEST_POOL_12], TEST_TOKEN_1, TEST_TOKEN_2),
      inputAmount: toCurrencyAmount(TEST_TOKEN_1, v3), outputAmount: toCurrencyAmount(TEST_TOKEN_2, v3),
    }] : [],
    tradeType: TradeType.EXACT_INPUT,
    gasUseEstimateUSD: 1.0,
    approveInfo: { needsApprove: false },
    quoteMethod: QuoteMethod.ROUTING_API,
  })
}

describe('encodeURSwapCalldata', () => {
  it('single V3 route: spends CONTRACT_BALANCE, sweeps total min to recipient', () => {
    const { cmds, inputs } = decode(encodeURSwapCalldata(RECIPIENT, TEST_TRADE_EXACT_INPUT, SLIPPAGE, 1n))
    expect(cmds).toEqual([0x00, 0x04])
    const [to, amountIn, min, , payerIsUser] = decodeAbiParameters(SWAP, inputs[0])
    expect([to, amountIn, min, payerIsUser]).toEqual(['0x0000000000000000000000000000000000000002', CONTRACT_BALANCE, 0n, false])
    // 1000 / 1.01 = 990
    expect(decodeAbiParameters(SWEEP, inputs[1])).toEqual([TEST_TOKEN_2.address, RECIPIENT, 990n])
  })

  it('split V2+V3: only the last route spends CONTRACT_BALANCE', () => {
    const { cmds, inputs } = decode(encodeURSwapCalldata(RECIPIENT, trade(400, 600), SLIPPAGE, 1n))
    expect(cmds).toEqual([0x08, 0x00, 0x04])
    expect(decodeAbiParameters(V2_SWAP, inputs[0]).slice(1, 3)).toEqual([400n, 0n])
    expect(decodeAbiParameters(SWAP, inputs[1]).slice(1, 3)).toEqual([CONTRACT_BALANCE, 0n])
  })

  it('single V2 route: spends CONTRACT_BALANCE', () => {
    const { cmds, inputs } = decode(encodeURSwapCalldata(RECIPIENT, trade(1000, 0), SLIPPAGE, 1n))
    expect(cmds).toEqual([0x08, 0x04])
    expect(decodeAbiParameters(V2_SWAP, inputs[0])[1]).toBe(CONTRACT_BALANCE)
  })

  it('scales total min by worst-case arrival', () => {
    const { inputs } = decode(encodeURSwapCalldata(RECIPIENT, TEST_TRADE_EXACT_INPUT, SLIPPAGE, 1n, 500n))
    expect(decodeAbiParameters(SWEEP, inputs[1])[2]).toBe(495n) // 990 * 500 / 1000
  })

  it('rejects exact-output trades', () => {
    expect(() => encodeURSwapCalldata(RECIPIENT, TEST_TRADE_EXACT_OUTPUT, SLIPPAGE, 1n)).toThrow('exact-input')
  })
})

describe('encodeSwapCommandData', () => {
  it('passes inputAmount through (CONTRACT_BALANCE for dst swaps)', () => {
    const data = encodeSwapCommandData(TEST_TOKEN_1.address, CONTRACT_BALANCE, RECIPIENT, TEST_TRADE_EXACT_INPUT, SLIPPAGE, 1n, 1)
    const [{ inputAmount, shouldTransferTokensBeforeSwap }] = decodeAbiParameters(
      parseAbiParameters('(address inputToken, uint256 inputAmount, bool shouldTransferTokensBeforeSwap, address target, bytes input)'),
      data,
    )
    expect(inputAmount).toBe(CONTRACT_BALANCE)
    expect(shouldTransferTokensBeforeSwap).toBe(true)
  })
})
