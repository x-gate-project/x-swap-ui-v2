import { XSwapApiError } from 'state/xswap/client'
import { XSwapOrder, XSwapQuote, XSwapTx, XSwapTxKind } from 'state/xswap/types'
import { decodeFunctionData, erc20Abi, parseAbi } from 'viem'

/** Leave the user time to sign before the quote expires; a quote closer to expiry is refreshed first. */
const XSWAP_QUOTE_EXPIRY_MARGIN_MS = 15_000

const REGISTER_ATTEMPTS = 3
const REGISTER_RETRY_DELAY_MS = 2_000

const permit2ApproveAbi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
])

// Approvals first, the deposit last: `approve-reset` (USDT-style tokens) before `approve`, and the token's approval of
// Permit2 before Permit2's allowance for XChainSender.
const TX_KIND_RANK: Record<XSwapTxKind, number> = {
  'approve-reset': 0,
  approve: 1,
  'permit2-approve': 2,
  deposit: 3,
}

/** A quote whose txs cannot be sent as given. Never a user error: the API built a plan the UI does not trust. */
export class XSwapPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XSwapPlanError'
    Object.setPrototypeOf(this, XSwapPlanError.prototype)
  }
}

/** The quote expired and the API no longer holds it (`quote_unavailable`, 410): quote again from scratch. */
export class XSwapQuoteExpiredError extends Error {
  constructor() {
    super('quote_unavailable')
    this.name = 'XSwapQuoteExpiredError'
    Object.setPrototypeOf(this, XSwapQuoteExpiredError.prototype)
  }
}

/**
 * A refresh changed the quote in a way the user did not agree to: a lower `minOutputAmount` than the one shown
 * (`price`), or another amount / XChainSender / Permit2 than the approvals already sent cover (`route`). Nothing more is
 * sent; quote again and let the user confirm.
 */
export class XSwapQuoteChangedError extends Error {
  constructor(readonly reason: 'price' | 'route') {
    super(`quote changed on refresh (${reason})`)
    this.name = 'XSwapQuoteChangedError'
    Object.setPrototypeOf(this, XSwapQuoteChangedError.prototype)
  }
}

/** A tx was mined but reverted. */
export class XSwapTxRevertedError extends Error {
  constructor(
    readonly kind: XSwapTxKind,
    readonly hash: string,
  ) {
    super(`${kind} reverted (${hash})`)
    this.name = 'XSwapTxRevertedError'
    Object.setPrototypeOf(this, XSwapTxRevertedError.prototype)
  }
}

/** The deposit is on chain but `POST /v1/orders` kept failing; the funds are with the bridge, only tracking failed. */
export class XSwapRegisterError extends Error {
  constructor(
    readonly txHash: string,
    readonly reason: unknown,
  ) {
    super(`order registration failed for ${txHash}`)
    this.name = 'XSwapRegisterError'
    Object.setPrototypeOf(this, XSwapRegisterError.prototype)
  }
}

function sameAddress(a?: string, b?: string): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

function decodeErc20ApproveSpender(tx: XSwapTx): string {
  try {
    const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: tx.data as `0x${string}` })
    if (functionName === 'approve') {
      return args[0] as string
    }
  } catch {
    // fall through
  }
  throw new XSwapPlanError(`${tx.kind} is not an ERC-20 approve`)
}

function decodePermit2Approve(tx: XSwapTx): { token: string; spender: string } {
  try {
    const { args } = decodeFunctionData({ abi: permit2ApproveAbi, data: tx.data as `0x${string}` })
    return { token: args[0], spender: args[1] }
  } catch {
    throw new XSwapPlanError('permit2-approve is not a Permit2 approve')
  }
}

/**
 * The quote's txs in send order, after checking them against the quote:
 * - every tx is on the input chain, and there is exactly one `deposit`, sent last; its target is XChainSender;
 * - every `approve` / `approve-reset` approves the input token, to XChainSender, or to Permit2 on `senderPermit2`
 *   chains, where a `permit2-approve` then gives XChainSender its allowance on the same Permit2.
 */
export function planXSwapTxs(quote: XSwapQuote): XSwapTx[] {
  if (!quote.executable || quote.txs.length === 0) {
    throw new XSwapPlanError('quote is not executable')
  }
  const chainId = quote.tokenIn.chainId
  if (quote.txs.some((tx) => tx.chainId !== chainId)) {
    throw new XSwapPlanError('tx on another chain than the input')
  }
  const txs = quote.txs
    .map((tx, index) => ({ tx, index }))
    .sort((a, b) => TX_KIND_RANK[a.tx.kind] - TX_KIND_RANK[b.tx.kind] || a.index - b.index)
    .map(({ tx }) => tx)

  const deposits = txs.filter((tx) => tx.kind === 'deposit')
  if (deposits.length !== 1) {
    throw new XSwapPlanError(`expected one deposit, got ${deposits.length}`)
  }
  const sender = deposits[0].to

  const permit2Approvals = txs.filter((tx) => tx.kind === 'permit2-approve')
  if (permit2Approvals.length > 1) {
    throw new XSwapPlanError('more than one permit2-approve')
  }
  const permit2Approval = permit2Approvals[0]
  const permit2 = permit2Approval?.to
  if (permit2Approval) {
    const { token, spender } = decodePermit2Approve(permit2Approval)
    if (!sameAddress(spender, sender) || !sameAddress(token, quote.tokenIn.address)) {
      throw new XSwapPlanError('permit2-approve does not allow XChainSender to spend the input token')
    }
  }

  for (const tx of txs) {
    if (tx.kind !== 'approve' && tx.kind !== 'approve-reset') {
      continue
    }
    if (!sameAddress(tx.to, quote.tokenIn.address)) {
      throw new XSwapPlanError(`${tx.kind} is not on the input token`)
    }
    const spender = decodeErc20ApproveSpender(tx)
    if (!sameAddress(spender, sender) && !sameAddress(spender, permit2)) {
      throw new XSwapPlanError(`${tx.kind} spender is neither XChainSender nor Permit2`)
    }
  }
  return txs
}

/** Contracts the plan's approvals are granted to: XChainSender (the deposit target) and Permit2, if used. */
function planSpenders(txs: XSwapTx[]): { sender?: string; permit2?: string } {
  return {
    sender: txs.find((tx) => tx.kind === 'deposit')?.to,
    permit2: txs.find((tx) => tx.kind === 'permit2-approve')?.to,
  }
}

function sameOptionalAddress(a?: string, b?: string): boolean {
  return (!a && !b) || sameAddress(a, b)
}

/** Throws when `fresh` pays less than `shown` guaranteed, or spends another amount of another token. */
function assertRefreshAgreed(shown: XSwapQuote, fresh: XSwapQuote): void {
  if (
    fresh.inputAmount !== shown.inputAmount ||
    fresh.tokenIn.chainId !== shown.tokenIn.chainId ||
    !sameAddress(fresh.tokenIn.address, shown.tokenIn.address)
  ) {
    throw new XSwapQuoteChangedError('route')
  }
  if (BigInt(fresh.minOutputAmount) < BigInt(shown.minOutputAmount)) {
    throw new XSwapQuoteChangedError('price')
  }
}

function isXSwapQuoteExpiring(quote: XSwapQuote, now: number, marginMs = XSWAP_QUOTE_EXPIRY_MARGIN_MS) {
  return now >= quote.expiresAt - marginMs
}

export type XSwapExecutionDeps = {
  now: () => number
  sleep: (ms: number) => Promise<void>
  refreshQuote: (quoteId: string) => Promise<XSwapQuote>
  /** Switches the wallet to `tx.chainId` if needed, sends the tx and returns its hash. */
  sendTx: (tx: XSwapTx) => Promise<string>
  /** Resolves true when the tx succeeded, false when it reverted. */
  waitForTx: (chainId: number, hash: string) => Promise<boolean>
  registerOrder: (params: { quoteId: string; txHash: string }) => Promise<XSwapOrder>
}

type XSwapStepStatus = 'pending' | 'active' | 'submitted' | 'done' | 'error'
export type XSwapStep = { tx: XSwapTx; status: XSwapStepStatus; hash?: string }

type XSwapExecutionCallbacks = {
  onPlan?: (steps: XSwapStep[]) => void
  onStep?: (index: number, patch: Partial<XSwapStep>) => void
  /** A refresh replaced the quote: its `quoteId`, amounts and expiry changed. */
  onQuote?: (quote: XSwapQuote) => void
  onRegistering?: () => void
}

/** The quote unchanged while it has time left, else a refreshed one. */
async function ensureFreshXSwapQuote(
  quote: XSwapQuote,
  deps: Pick<XSwapExecutionDeps, 'now' | 'refreshQuote'>,
): Promise<XSwapQuote> {
  if (!isXSwapQuoteExpiring(quote, deps.now())) {
    return quote
  }
  try {
    return await deps.refreshQuote(quote.quoteId)
  } catch (error) {
    if (error instanceof XSwapApiError && (error.code === 'quote_unavailable' || error.status === 410)) {
      throw new XSwapQuoteExpiredError()
    }
    throw error
  }
}

async function registerWithRetry(
  params: { quoteId: string; txHash: string },
  deps: Pick<XSwapExecutionDeps, 'registerOrder' | 'sleep'>,
): Promise<XSwapOrder> {
  let lastError: unknown
  for (let attempt = 0; attempt < REGISTER_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await deps.sleep(REGISTER_RETRY_DELAY_MS * attempt)
    }
    try {
      return await deps.registerOrder(params)
    } catch (error) {
      lastError = error
      // A definite answer (e.g. quote_not_found, tx_sender_mismatch) does not change on retry.
      if (error instanceof XSwapApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        break
      }
    }
  }
  throw new XSwapRegisterError(params.txHash, lastError)
}

/**
 * Sends a cross-chain quote's txs in order, then registers the order:
 * 1. refresh the quote if it is about to expire (`quote_unavailable` → `XSwapQuoteExpiredError`, re-quote);
 * 2. send each approval and wait for it;
 * 3. refresh again before the deposit, since approvals take time, and send the refreshed quote's deposit;
 *    a refresh that lowers `minOutputAmount` or targets other contracts than the approvals stops with
 *    `XSwapQuoteChangedError`;
 * 4. `POST /v1/orders` with the deposit's quote and hash.
 */
export async function executeXSwapQuote(
  initialQuote: XSwapQuote,
  deps: XSwapExecutionDeps,
  callbacks: XSwapExecutionCallbacks = {},
): Promise<XSwapOrder> {
  let quote = await ensureFreshXSwapQuote(initialQuote, deps)
  if (quote !== initialQuote) {
    assertRefreshAgreed(initialQuote, quote)
    callbacks.onQuote?.(quote)
  }
  const txs = planXSwapTxs(quote)
  const approved = planSpenders(txs)
  const steps: XSwapStep[] = txs.map((tx) => ({ tx, status: 'pending' }))
  callbacks.onPlan?.(steps)

  for (let index = 0; index < steps.length; index++) {
    let { tx } = steps[index]
    if (tx.kind === 'deposit') {
      const fresh = await ensureFreshXSwapQuote(quote, deps)
      if (fresh !== quote) {
        // The user agreed to what `initialQuote` showed; the approvals already sent must still cover the deposit.
        assertRefreshAgreed(initialQuote, fresh)
        const freshTxs = planXSwapTxs(fresh)
        const freshSpenders = planSpenders(freshTxs)
        if (
          !sameAddress(freshSpenders.sender, approved.sender) ||
          !sameOptionalAddress(freshSpenders.permit2, approved.permit2)
        ) {
          throw new XSwapQuoteChangedError('route')
        }
        quote = fresh
        callbacks.onQuote?.(quote)
        tx = freshTxs.find((t) => t.kind === 'deposit') as XSwapTx
        steps[index] = { ...steps[index], tx }
        callbacks.onStep?.(index, { tx })
      }
    }

    callbacks.onStep?.(index, { status: 'active' })
    const hash = await deps.sendTx(tx)
    callbacks.onStep?.(index, { status: 'submitted', hash })
    const ok = await deps.waitForTx(tx.chainId, hash)
    if (!ok) {
      callbacks.onStep?.(index, { status: 'error' })
      throw new XSwapTxRevertedError(tx.kind, hash)
    }
    callbacks.onStep?.(index, { status: 'done' })

    if (tx.kind === 'deposit') {
      callbacks.onRegistering?.()
      return registerWithRetry({ quoteId: quote.quoteId, txHash: hash }, deps)
    }
  }
  // planXSwapTxs guarantees a deposit last.
  throw new XSwapPlanError('no deposit sent')
}
