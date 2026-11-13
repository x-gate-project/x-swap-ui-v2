import { NATIVE_CHAIN_ID } from 'constants/tokens'
import { TransactionDetails, TransactionType } from 'state/transactions/types'
import { findUnregisteredXSwapDeposits, xswapTxInfo } from 'state/xswap/transactions'
import { XSwapQuote, XSwapTx } from 'state/xswap/types'
import { XSWAP_NATIVE_ADDRESS } from 'state/xswap/utils'
import { TransactionStatus } from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { encodeFunctionData, erc20Abi } from 'viem'

const TOKEN = '0x1111111111111111111111111111111111111111'
const SENDER = '0x2222222222222222222222222222222222222222'
const OTHER = '0x3333333333333333333333333333333333333333'
const ACCOUNT = '0x4444444444444444444444444444444444444444'
const CHAIN = 11155111
const NOW = 10_000_000

const quote = (overrides: Partial<XSwapQuote> = {}) =>
  ({
    quoteId: 'q1',
    routeClass: 'evm-native',
    tokenIn: { chainId: CHAIN, address: TOKEN },
    tokenOut: { chainId: 84532, address: OTHER },
    inputAmount: '100',
    outputAmount: '99',
    ...overrides,
  }) as XSwapQuote

const deposit: XSwapTx = { chainId: CHAIN, kind: 'deposit', to: SENDER, data: '0xdead', value: '0' }

describe('xswapTxInfo', () => {
  it('keeps an approval as APPROVAL', () => {
    const tx: XSwapTx = {
      chainId: CHAIN,
      kind: 'approve',
      to: TOKEN,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SENDER, 100n] }),
      value: '0',
    }
    expect(xswapTxInfo(tx, quote())).toEqual({
      type: TransactionType.APPROVAL,
      tokenAddress: TOKEN,
      spender: SENDER,
      amount: '100',
    })
  })

  it('keeps the deposit with what registering its order needs', () => {
    expect(xswapTxInfo(deposit, quote())).toEqual({
      type: TransactionType.XSWAP_DEPOSIT,
      quoteId: 'q1',
      routeClass: 'evm-native',
      inputChainId: CHAIN,
      inputCurrencyId: TOKEN,
      inputCurrencyAmountRaw: '100',
      outputChainId: 84532,
      outputCurrencyId: OTHER,
      expectedOutputCurrencyAmountRaw: '99',
    })
  })

  it('names a native token as the app does', () => {
    const info = xswapTxInfo(deposit, quote({ tokenIn: { chainId: CHAIN, address: XSWAP_NATIVE_ADDRESS } }))
    expect(info).toMatchObject({ inputCurrencyId: NATIVE_CHAIN_ID })
  })
})

describe('findUnregisteredXSwapDeposits', () => {
  const tx = (overrides: Partial<TransactionDetails> = {}): TransactionDetails =>
    ({
      hash: '0xaaa',
      from: ACCOUNT,
      addedTime: NOW - 120_000,
      status: TransactionStatus.Confirmed,
      confirmedTime: NOW - 100_000,
      info: xswapTxInfo(deposit, quote()),
      ...overrides,
    }) as TransactionDetails
  const find = (txs: TransactionDetails[], registered: string[] = []) =>
    findUnregisteredXSwapDeposits(txs, ACCOUNT, new Set(registered), NOW).map((t) => t.hash)

  it('finds a deposit with no order', () => {
    expect(find([tx()])).toEqual(['0xaaa'])
  })

  it('finds a deposit whose receipt the app has not read', () => {
    expect(find([tx({ status: TransactionStatus.Pending })])).toEqual(['0xaaa'])
  })

  it('skips a deposit older than the orders loaded when the history has more pages', () => {
    const since = (listedSince: number) =>
      findUnregisteredXSwapDeposits([tx()], ACCOUNT, new Set(), NOW, listedSince).map((t) => t.hash)
    expect(since(NOW - 60_000)).toEqual([])
    expect(since(NOW - 200_000)).toEqual(['0xaaa'])
  })

  it('skips a deposit whose order is listed, whatever the hash case', () => {
    expect(find([tx({ hash: '0xAAA' })], ['0xaaa'])).toEqual([])
  })

  it.each([
    ['sent just now: the panel is still registering it', { addedTime: NOW - 5_000 }],
    ['too old', { addedTime: NOW - 2 * 24 * 60 * 60 * 1000 }],
    ['reverted', { status: TransactionStatus.Failed }],
    ['cancelled', { cancelled: true as const }],
    ['from another wallet', { from: OTHER }],
    [
      'not a deposit',
      { info: { type: TransactionType.APPROVAL, tokenAddress: TOKEN, spender: SENDER, amount: '1' } },
    ],
  ])('skips a deposit %s', (_, overrides) => {
    expect(find([tx(overrides as Partial<TransactionDetails>)])).toEqual([])
  })
})
