import { XSwapApiError } from 'state/xswap/client'
import {
  XSwapExecutionDeps,
  XSwapPlanError,
  XSwapQuoteExpiredError,
  XSwapRegisterError,
  XSwapTxRevertedError,
  executeXSwapQuote,
  planXSwapTxs,
} from 'state/xswap/execute'
import { XSwapOrder, XSwapQuote, XSwapTx } from 'state/xswap/types'
import { encodeFunctionData, erc20Abi, parseAbi } from 'viem'

const TOKEN = '0x1111111111111111111111111111111111111111'
const SENDER = '0x2222222222222222222222222222222222222222'
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const OTHER = '0x3333333333333333333333333333333333333333'
const CHAIN = 11155111
const NOW = 1_000_000

const approve = (spender: string, kind: 'approve' | 'approve-reset' = 'approve', to = TOKEN): XSwapTx => ({
  chainId: CHAIN,
  kind,
  to,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender as `0x${string}`, kind === 'approve-reset' ? 0n : 100n],
  }),
  value: '0',
})

const permit2Approve = (spender: string, token = TOKEN): XSwapTx => ({
  chainId: CHAIN,
  kind: 'permit2-approve',
  to: PERMIT2,
  data: encodeFunctionData({
    abi: parseAbi(['function approve(address token, address spender, uint160 amount, uint48 expiration)']),
    functionName: 'approve',
    args: [token as `0x${string}`, spender as `0x${string}`, 100n, 1_000],
  }),
  value: '0',
})

const deposit = (data = '0xdead'): XSwapTx => ({ chainId: CHAIN, kind: 'deposit', to: SENDER, data, value: '0' })

const quote = (overrides: Partial<XSwapQuote> = {}): XSwapQuote => ({
  quoteId: 'q1',
  provider: 'across',
  routing: 'BRIDGE',
  routeClass: 'evm-native',
  tokenIn: { chainId: CHAIN, address: TOKEN },
  tokenOut: { chainId: 84532, address: OTHER },
  inputAmount: '100',
  outputAmount: '99',
  minOutputAmount: '98',
  priceImpactBps: 0,
  fees: { lp: '0', relayer: '1', gas: '0', app: '0' },
  etaSec: 30,
  expiresAt: NOW + 30_000,
  executable: true,
  destSwap: false,
  txs: [approve(SENDER), deposit()],
  score: 1,
  ...overrides,
})

const order = { id: 'o1', quoteId: 'q1' } as XSwapOrder

function deps(overrides: Partial<XSwapExecutionDeps> = {}): XSwapExecutionDeps & { sent: XSwapTx[] } {
  const sent: XSwapTx[] = []
  return {
    sent,
    now: () => NOW,
    sleep: () => Promise.resolve(),
    refreshQuote: jest.fn(),
    sendTx: jest.fn(async (tx: XSwapTx) => {
      sent.push(tx)
      return `0xhash${sent.length}`
    }),
    waitForTx: jest.fn(async () => true),
    registerOrder: jest.fn(async () => order),
    ...overrides,
  }
}

describe('planXSwapTxs', () => {
  it('sends approvals before the deposit, reset first', () => {
    const txs = planXSwapTxs(quote({ txs: [deposit(), approve(SENDER), approve(SENDER, 'approve-reset')] }))
    expect(txs.map((t) => t.kind)).toEqual(['approve-reset', 'approve', 'deposit'])
  })

  it('accepts Permit2 as spender on senderPermit2 chains', () => {
    const txs = planXSwapTxs(quote({ txs: [deposit(), permit2Approve(SENDER), approve(PERMIT2)] }))
    expect(txs.map((t) => t.kind)).toEqual(['approve', 'permit2-approve', 'deposit'])
  })

  it('accepts a deposit alone (native input or allowance already set)', () => {
    expect(planXSwapTxs(quote({ txs: [deposit()] }))).toHaveLength(1)
  })

  it.each([
    ['not executable', { executable: false, txs: [] }],
    ['no deposit', { txs: [approve(SENDER)] }],
    ['two deposits', { txs: [deposit(), deposit()] }],
    ['approve to an unknown spender', { txs: [approve(OTHER), deposit()] }],
    ['approve on another token', { txs: [approve(SENDER, 'approve', OTHER), deposit()] }],
    ['Permit2 approved without a permit2-approve', { txs: [approve(PERMIT2), deposit()] }],
    ['permit2-approve to another spender', { txs: [approve(PERMIT2), permit2Approve(OTHER), deposit()] }],
    ['permit2-approve on another token', { txs: [approve(PERMIT2), permit2Approve(SENDER, OTHER), deposit()] }],
    ['tx on another chain', { txs: [{ ...deposit(), chainId: 1 }] }],
  ])('rejects %s', (_, overrides) => {
    expect(() => planXSwapTxs(quote(overrides as Partial<XSwapQuote>))).toThrow(XSwapPlanError)
  })
})

describe('executeXSwapQuote', () => {
  it('sends txs in order and registers the deposit', async () => {
    const d = deps()
    await expect(executeXSwapQuote(quote(), d)).resolves.toBe(order)
    expect(d.sent.map((t) => t.kind)).toEqual(['approve', 'deposit'])
    expect(d.registerOrder).toHaveBeenCalledWith({ quoteId: 'q1', txHash: '0xhash2' })
    expect(d.refreshQuote).not.toHaveBeenCalled()
  })

  it('refreshes an expiring quote before starting', async () => {
    const refreshed = quote({ quoteId: 'q2', expiresAt: NOW + 30_000 })
    const d = deps({ refreshQuote: jest.fn(async () => refreshed) })
    const onQuote = jest.fn()
    await executeXSwapQuote(quote({ expiresAt: NOW + 5_000 }), d, { onQuote })
    expect(d.refreshQuote).toHaveBeenCalledWith('q1')
    expect(onQuote).toHaveBeenCalledWith(refreshed)
    expect(d.registerOrder).toHaveBeenCalledWith({ quoteId: 'q2', txHash: '0xhash2' })
  })

  it('sends the deposit of a quote refreshed after the approvals', async () => {
    let now = NOW
    const refreshed = quote({ quoteId: 'q2', expiresAt: NOW + 120_000, txs: [deposit('0xbeef')] })
    const d = deps({
      now: () => now,
      refreshQuote: jest.fn(async () => refreshed),
      waitForTx: jest.fn(async () => {
        now += 60_000
        return true
      }),
    })
    await executeXSwapQuote(quote(), d)
    expect(d.sent.map((t) => t.data)).toEqual([approve(SENDER).data, '0xbeef'])
    expect(d.registerOrder).toHaveBeenCalledWith({ quoteId: 'q2', txHash: '0xhash2' })
  })

  it('asks for a new quote when the refresh is quote_unavailable', async () => {
    const d = deps({
      refreshQuote: jest.fn(async () => {
        throw new XSwapApiError('quote_unavailable', 410)
      }),
    })
    await expect(executeXSwapQuote(quote({ expiresAt: NOW }), d)).rejects.toBeInstanceOf(XSwapQuoteExpiredError)
    expect(d.sent).toHaveLength(0)
  })

  it('stops on a reverted tx', async () => {
    const d = deps({ waitForTx: jest.fn(async () => false) })
    await expect(executeXSwapQuote(quote(), d)).rejects.toBeInstanceOf(XSwapTxRevertedError)
    expect(d.sent).toHaveLength(1)
    expect(d.registerOrder).not.toHaveBeenCalled()
  })

  it('retries a failed registration, then reports the deposit hash', async () => {
    const registerOrder = jest.fn(async () => {
      throw new XSwapApiError('internal', 500)
    })
    const d = deps({ registerOrder })
    const error = await executeXSwapQuote(quote(), d).catch((e) => e)
    expect(error).toBeInstanceOf(XSwapRegisterError)
    expect(error.txHash).toBe('0xhash2')
    expect(registerOrder).toHaveBeenCalledTimes(3)
  })

  it('does not retry a definite registration error', async () => {
    const registerOrder = jest.fn(async () => {
      throw new XSwapApiError('tx_sender_mismatch', 403)
    })
    await expect(executeXSwapQuote(quote(), deps({ registerOrder }))).rejects.toBeInstanceOf(XSwapRegisterError)
    expect(registerOrder).toHaveBeenCalledTimes(1)
  })
})
