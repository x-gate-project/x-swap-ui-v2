import { XSwapApiError } from 'state/xswap/client'
import {
  XSwapExecutionDeps,
  XSwapPermitRejectedError,
  XSwapPlanError,
  XSwapQuoteChangedError,
  XSwapQuoteExpiredError,
  XSwapRegisterError,
  XSwapTxRevertedError,
  decodeXSwapApproval,
  isDefiniteXSwapRegisterError,
  executeXSwapQuote,
  planXSwapSteps,
  planXSwapTxs,
} from 'state/xswap/execute'
import { XSwapOrder, XSwapPermitTypedData, XSwapQuote, XSwapTx } from 'state/xswap/types'
import { encodeFunctionData, erc20Abi, parseAbi } from 'viem'

const TOKEN = '0x1111111111111111111111111111111111111111'
const SENDER = '0x2222222222222222222222222222222222222222'
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
const OTHER = '0x3333333333333333333333333333333333333333'
const ROUTER = '0x4444444444444444444444444444444444444444'
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

const deposit = (data = '0xdead', to = SENDER): XSwapTx => ({ chainId: CHAIN, kind: 'deposit', to, data, value: '0' })

const permit = (
  overrides: { spender?: string; token?: string; amount?: string; permit2?: string; sigDeadline?: string } = {},
) =>
  ({
    domain: { name: 'Permit2', chainId: CHAIN, verifyingContract: overrides.permit2 ?? PERMIT2 },
    types: { PermitSingle: [] },
    primaryType: 'PermitSingle',
    message: {
      // Unix seconds; NOW is 1_000 s.
      details: { token: overrides.token ?? TOKEN, amount: overrides.amount ?? '100', expiration: 10_000, nonce: 0 },
      spender: overrides.spender ?? ROUTER,
      sigDeadline: overrides.sigDeadline ?? '10000',
    },
  }) satisfies XSwapPermitTypedData

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
    signPermit: jest.fn(async () => '0xsig'),
    permitQuote: jest.fn(),
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

/** An `xswap` same-chain ERC-20 swap: approve Permit2, Permit2 allowance for the router, then the router's execute. */
const localQuote = (overrides: Partial<XSwapQuote> = {}): XSwapQuote =>
  quote({
    provider: 'xswap',
    routing: 'SWAP',
    routeClass: 'local',
    tokenOut: { chainId: CHAIN, address: OTHER },
    fees: { lp: '0', relayer: '0', gas: '0', app: '0' },
    shape: 'swap',
    txs: [approve(PERMIT2), permit2Approve(ROUTER), deposit('0xdead', ROUTER)],
    permit: permit(),
    ...overrides,
  })

/** What `POST /v1/quote/:quoteId/permit` answers: the deposit alone, built from the signature. */
const signedQuote = (overrides: Partial<XSwapQuote> = {}): XSwapQuote =>
  localQuote({ quoteId: 'q-signed', txs: [deposit('0xsigned', ROUTER)], permit: undefined, ...overrides })

describe('planXSwapTxs with a permit', () => {
  it('accepts a same-chain swap through Permit2', () => {
    expect(planXSwapTxs(localQuote()).map((t) => t.kind)).toEqual(['approve', 'permit2-approve', 'deposit'])
  })

  it('accepts the token approval of Permit2 when only the permit gives the router its allowance', () => {
    expect(planXSwapTxs(localQuote({ txs: [approve(PERMIT2), deposit('0xdead', ROUTER)] }))).toHaveLength(2)
  })

  it('rejects a permit on a contract other than the canonical Permit2', () => {
    const q = localQuote({ txs: [approve(OTHER), deposit('0xdead', ROUTER)], permit: permit({ permit2: OTHER }) })
    expect(() => planXSwapTxs(q)).toThrow(XSwapPlanError)
  })

  it('rejects a permit2-approve on a contract other than the canonical Permit2', () => {
    const q = quote({ txs: [approve(OTHER), { ...permit2Approve(SENDER), to: OTHER }, deposit()] })
    expect(() => planXSwapTxs(q)).toThrow(XSwapPlanError)
  })

  it('rejects a permit that is not a PermitSingle', () => {
    const q = localQuote({ permit: { ...permit(), primaryType: 'PermitBatch' } as unknown as XSwapPermitTypedData })
    expect(() => planXSwapTxs(q)).toThrow(XSwapPlanError)
  })

  it.each([
    ['to another spender', { spender: OTHER }],
    ['on another token', { token: OTHER }],
    ['for another amount', { amount: '1000' }],
    ['on another Permit2', { permit2: OTHER }],
  ])('rejects a permit %s', (_, overrides) => {
    expect(() => planXSwapTxs(localQuote({ permit: permit(overrides) }))).toThrow(XSwapPlanError)
  })
})

describe('planXSwapSteps', () => {
  it('signs the permit in place of the permit2-approve tx', () => {
    expect(planXSwapSteps(localQuote(), true).map((s) => s.kind)).toEqual(['approve', 'permit', 'deposit'])
  })

  it('sends every tx without the permit', () => {
    expect(planXSwapSteps(localQuote(), false).map((s) => s.kind)).toEqual(['approve', 'permit2-approve', 'deposit'])
  })

  it('sends the deposit alone for a native input', () => {
    const native = localQuote({ txs: [{ ...deposit('0xdead', ROUTER), value: '100' }], permit: undefined })
    expect(planXSwapSteps(native, true).map((s) => s.kind)).toEqual(['deposit'])
  })
})

describe('executeXSwapQuote with a permit', () => {
  it('approves Permit2, signs the permit and sends the deposit built from it', async () => {
    const d = deps({ permitQuote: jest.fn(async () => signedQuote()) })
    const onQuote = jest.fn()
    await expect(executeXSwapQuote(localQuote(), d, { onQuote })).resolves.toBe(order)
    expect(d.signPermit).toHaveBeenCalledWith(permit())
    expect(d.permitQuote).toHaveBeenCalledWith('q1', '0xsig')
    expect(d.sent.map((t) => t.data)).toEqual([approve(PERMIT2).data, '0xsigned'])
    expect(onQuote).toHaveBeenCalledWith(signedQuote())
    expect(d.registerOrder).toHaveBeenCalledWith({ quoteId: 'q-signed', txHash: '0xhash2' })
  })

  it('sends the permit2-approve tx when told not to sign', async () => {
    const d = deps()
    await executeXSwapQuote(localQuote(), d, { usePermit: false })
    expect(d.signPermit).not.toHaveBeenCalled()
    expect(d.sent.map((t) => t.kind)).toEqual(['approve', 'permit2-approve', 'deposit'])
    expect(d.registerOrder).toHaveBeenCalledWith({ quoteId: 'q1', txHash: '0xhash3' })
  })

  it('signs the permit of a quote refreshed after the approvals', async () => {
    let now = NOW
    const refreshed = localQuote({ quoteId: 'q2', expiresAt: NOW + 120_000 })
    const d = deps({
      now: () => now,
      refreshQuote: jest.fn(async () => refreshed),
      permitQuote: jest.fn(async () => signedQuote({ expiresAt: NOW + 120_000 })),
      waitForTx: jest.fn(async () => {
        now += 60_000
        return true
      }),
    })
    await executeXSwapQuote(localQuote(), d)
    expect(d.permitQuote).toHaveBeenCalledWith('q2', '0xsig')
    expect(d.sent.map((t) => t.data)).toEqual([approve(PERMIT2).data, '0xsigned'])
  })

  it('skips the signature when the refreshed quote offers no permit', async () => {
    let now = NOW
    const refreshed = localQuote({
      quoteId: 'q2',
      expiresAt: NOW + 120_000,
      permit: undefined,
      txs: [deposit('0xbeef', ROUTER)],
    })
    const d = deps({
      now: () => now,
      refreshQuote: jest.fn(async () => refreshed),
      waitForTx: jest.fn(async () => {
        now += 60_000
        return true
      }),
    })
    await executeXSwapQuote(localQuote(), d)
    expect(d.signPermit).not.toHaveBeenCalled()
    expect(d.sent.map((t) => t.data)).toEqual([approve(PERMIT2).data, '0xbeef'])
    expect(d.registerOrder).toHaveBeenCalledWith({ quoteId: 'q2', txHash: '0xhash2' })
  })

  it.each([
    ['lowers the minimum output', { minOutputAmount: '97' }, XSwapQuoteChangedError],
    ['deposits to another contract', { txs: [deposit('0xsigned', OTHER)] }, XSwapQuoteChangedError],
    ['still needs approvals', { txs: [permit2Approve(ROUTER), deposit('0xsigned', ROUTER)] }, XSwapPlanError],
  ])('does not send a signed quote that %s', async (_, overrides, errorClass) => {
    const d = deps({ permitQuote: jest.fn(async () => signedQuote(overrides as Partial<XSwapQuote>)) })
    await expect(executeXSwapQuote(localQuote(), d)).rejects.toBeInstanceOf(errorClass)
    expect(d.sent.map((t) => t.kind)).toEqual(['approve'])
  })

  it('does not sign a permit whose signature deadline has passed', async () => {
    const d = deps()
    await expect(executeXSwapQuote(localQuote({ permit: permit({ sigDeadline: '1005' }) }), d)).rejects.toBeInstanceOf(
      XSwapQuoteExpiredError,
    )
    expect(d.signPermit).not.toHaveBeenCalled()
  })

  it('does not send a signed quote about to expire', async () => {
    const d = deps({ permitQuote: jest.fn(async () => signedQuote({ expiresAt: NOW + 5_000 })) })
    await expect(executeXSwapQuote(localQuote(), d)).rejects.toBeInstanceOf(XSwapQuoteExpiredError)
    expect(d.sent.map((t) => t.kind)).toEqual(['approve'])
  })

  it.each([
    ['permit_unavailable', XSwapQuoteChangedError],
    ['validator_failed', XSwapPermitRejectedError],
    ['simulation_failed', XSwapPermitRejectedError],
  ])('maps a %s answer to the permit', async (code, errorClass) => {
    const d = deps({
      permitQuote: jest.fn(async () => {
        throw new XSwapApiError(code, 422)
      }),
    })
    await expect(executeXSwapQuote(localQuote(), d)).rejects.toBeInstanceOf(errorClass)
  })

  it('stops when a refresh after the approvals approves the router directly instead of through Permit2', async () => {
    let now = NOW
    const refreshed = localQuote({
      quoteId: 'q2',
      expiresAt: NOW + 120_000,
      permit: undefined,
      txs: [approve(ROUTER), deposit('0xbeef', ROUTER)],
    })
    const d = deps({
      now: () => now,
      refreshQuote: jest.fn(async () => refreshed),
      waitForTx: jest.fn(async () => {
        now += 60_000
        return true
      }),
    })
    const error = await executeXSwapQuote(localQuote(), d, { usePermit: false }).catch((e) => e)
    expect(error).toBeInstanceOf(XSwapQuoteChangedError)
    expect(error.reason).toBe('route')
    expect(d.sent.map((t) => t.kind)).toEqual(['approve', 'permit2-approve'])
  })

  it('does not refresh a signed quote that expired', async () => {
    let now = NOW
    const d = deps({
      now: () => now,
      permitQuote: jest.fn(async () => {
        now += 60_000
        return signedQuote()
      }),
    })
    await expect(executeXSwapQuote(localQuote(), d)).rejects.toBeInstanceOf(XSwapQuoteExpiredError)
    expect(d.refreshQuote).not.toHaveBeenCalled()
    expect(d.sent.map((t) => t.kind)).toEqual(['approve'])
  })

  it('asks for a new quote when the permit is quote_unavailable', async () => {
    const d = deps({
      permitQuote: jest.fn(async () => {
        throw new XSwapApiError('quote_unavailable', 410)
      }),
    })
    await expect(executeXSwapQuote(localQuote(), d)).rejects.toBeInstanceOf(XSwapQuoteExpiredError)
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

  it('reports each sent tx with the quote it belongs to', async () => {
    const refreshed = quote({ quoteId: 'q2', expiresAt: NOW + 120_000, txs: [deposit('0xbeef')] })
    let now = NOW
    const d = deps({
      now: () => now,
      refreshQuote: jest.fn(async () => refreshed),
      waitForTx: jest.fn(async () => {
        now += 60_000
        return true
      }),
    })
    const onTxSent = jest.fn()
    await executeXSwapQuote(quote(), d, { onTxSent })
    expect(onTxSent.mock.calls.map(([tx, hash, q]) => [tx.kind, hash, q.quoteId])).toEqual([
      ['approve', '0xhash1', 'q1'],
      ['deposit', '0xhash2', 'q2'],
    ])
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

  it('stops before sending when the refresh lowers the minimum output', async () => {
    const refreshed = quote({ quoteId: 'q2', minOutputAmount: '97', expiresAt: NOW + 30_000 })
    const d = deps({ refreshQuote: jest.fn(async () => refreshed) })
    const error = await executeXSwapQuote(quote({ expiresAt: NOW + 5_000 }), d).catch((e) => e)
    expect(error).toBeInstanceOf(XSwapQuoteChangedError)
    expect(error.reason).toBe('price')
    expect(d.sent).toHaveLength(0)
  })

  it.each([
    ['lowers the minimum output', { minOutputAmount: '97' }, 'price'],
    ['deposits to another XChainSender', { txs: [{ ...deposit(), to: OTHER }] }, 'route'],
    ['spends another amount', { inputAmount: '101' }, 'route'],
  ])('does not send the deposit when a refresh after the approvals %s', async (_, overrides, reason) => {
    let now = NOW
    const refreshed = quote({ quoteId: 'q2', expiresAt: NOW + 120_000, ...(overrides as Partial<XSwapQuote>) })
    const d = deps({
      now: () => now,
      refreshQuote: jest.fn(async () => refreshed),
      waitForTx: jest.fn(async () => {
        now += 60_000
        return true
      }),
    })
    const error = await executeXSwapQuote(quote(), d).catch((e) => e)
    expect(error).toBeInstanceOf(XSwapQuoteChangedError)
    expect(error.reason).toBe(reason)
    expect(d.sent.map((t) => t.kind)).toEqual(['approve'])
    expect(d.registerOrder).not.toHaveBeenCalled()
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
    expect(registerOrder).toHaveBeenCalledTimes(4)
  })

  it('registers the deposit without waiting for its receipt', async () => {
    const d = deps()
    await executeXSwapQuote(quote(), d)
    expect(d.waitForTx).toHaveBeenCalledTimes(1)
    expect(d.waitForTx).toHaveBeenCalledWith(d.sent[0].chainId, '0xhash1')
  })

  it('retries a deposit the API does not see yet', async () => {
    const registerOrder = jest
      .fn()
      .mockRejectedValueOnce(new XSwapApiError('tx_not_found', 404))
      .mockResolvedValueOnce(order)
    await expect(executeXSwapQuote(quote(), deps({ registerOrder }))).resolves.toBe(order)
    expect(registerOrder).toHaveBeenCalledTimes(2)
  })

  it('does not retry a definite registration error', async () => {
    const registerOrder = jest.fn(async () => {
      throw new XSwapApiError('tx_sender_mismatch', 403)
    })
    await expect(executeXSwapQuote(quote(), deps({ registerOrder }))).rejects.toBeInstanceOf(XSwapRegisterError)
    expect(registerOrder).toHaveBeenCalledTimes(1)
  })
})

describe('executeXSwapQuote for joc-eth-stable routes', () => {
  // USDT on Sepolia → USDTX on JOC over XGate: USDT needs its allowance reset first, and the deposit carries the
  // LayerZero fee as `msg.value` although the input is an ERC-20.
  it('resets the USDT allowance, approves and sends the deposit with the LayerZero fee', async () => {
    const usdtIn = quote({
      provider: 'xgate',
      routeClass: 'joc-eth-stable-in',
      tokenOut: { chainId: 10081, address: OTHER },
      txs: [{ ...deposit(), value: '2500000000000000' }, approve(SENDER), approve(SENDER, 'approve-reset')],
    })
    const d = deps()
    await expect(executeXSwapQuote(usdtIn, d)).resolves.toBe(order)
    expect(d.sent.map((t) => t.kind)).toEqual(['approve-reset', 'approve', 'deposit'])
    expect(d.sent[2].value).toBe('2500000000000000')
  })

  // USDCX on JOC → USDC on Sepolia: XGate burns USDCX for the real stable; the order is sent from JOC.
  it('sends the burn deposit from JOC', async () => {
    const JOC = 10081
    const usdcxOut = quote({
      provider: 'xgate',
      routeClass: 'joc-eth-stable-out',
      tokenIn: { chainId: JOC, address: TOKEN },
      tokenOut: { chainId: CHAIN, address: OTHER },
      txs: [
        { ...approve(SENDER), chainId: JOC },
        { ...deposit(), chainId: JOC, value: '1000' },
      ],
    })
    const d = deps()
    await expect(executeXSwapQuote(usdcxOut, d)).resolves.toBe(order)
    expect(d.sent.map((t) => [t.kind, t.chainId])).toEqual([
      ['approve', JOC],
      ['deposit', JOC],
    ])
  })
})

describe('decodeXSwapApproval', () => {
  it('reads the token, spender and amount of an ERC-20 approve', () => {
    expect(decodeXSwapApproval(approve(SENDER))).toEqual({ token: TOKEN, spender: SENDER, amount: '100' })
  })

  it('reads a reset as an approval of 0', () => {
    expect(decodeXSwapApproval(approve(SENDER, 'approve-reset'))).toEqual({ token: TOKEN, spender: SENDER, amount: '0' })
  })

  it("reads Permit2's allowance of the token", () => {
    expect(decodeXSwapApproval(permit2Approve(ROUTER))).toEqual({ token: TOKEN, spender: ROUTER, amount: '100' })
  })

  it('has nothing for a deposit', () => {
    expect(decodeXSwapApproval(deposit())).toBeUndefined()
  })
})

describe('isDefiniteXSwapRegisterError', () => {
  it.each([
    [new XSwapApiError('quote_not_found', 404), true],
    [new XSwapApiError('tx_sender_mismatch', 400), true],
    [new XSwapApiError('tx_not_found', 404), false],
    [new XSwapApiError('rate_limited', 429), false],
    [new XSwapApiError('internal', 500), false],
    [new Error('network'), false],
  ])('%s → %s', (error, definite) => {
    expect(isDefiniteXSwapRegisterError(error)).toBe(definite)
  })
})
