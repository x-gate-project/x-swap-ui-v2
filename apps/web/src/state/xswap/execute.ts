import { permit2Address } from '@uniswap/permit2-sdk'
import { XSwapApiError } from 'state/xswap/client'
import { XSwapOrder, XSwapPermitTypedData, XSwapQuote, XSwapTx, XSwapTxKind } from 'state/xswap/types'
import { decodeFunctionData, erc20Abi, parseAbi } from 'viem'

/** Leave the user time to sign before the quote expires; a quote closer to expiry is refreshed first. */
const XSWAP_QUOTE_EXPIRY_MARGIN_MS = 15_000

const REGISTER_ATTEMPTS = 4
const REGISTER_RETRY_DELAY_MS = 2_000

const permit2ApproveAbi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
])

// Approvals first, the deposit last: `approve-reset` (USDT-style tokens) before `approve`, and the token's approval of
// Permit2 before Permit2's allowance for the deposit target.
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
 * (`price`), or another amount / deposit target / Permit2 than the approvals already sent cover (`route`). Nothing more is
 * sent; quote again and let the user confirm.
 */
export class XSwapQuoteChangedError extends Error {
  constructor(readonly reason: 'price' | 'route') {
    super(`quote changed on refresh (${reason})`)
    this.name = 'XSwapQuoteChangedError'
    Object.setPrototypeOf(this, XSwapQuoteChangedError.prototype)
  }
}

/** `POST /v1/quote/:quoteId/permit` refused the signature (`validator_failed` / `simulation_failed`). */
export class XSwapPermitRejectedError extends Error {
  constructor(readonly code: string) {
    super(`permit rejected (${code})`)
    this.name = 'XSwapPermitRejectedError'
    Object.setPrototypeOf(this, XSwapPermitRejectedError.prototype)
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
 * Checks the quote's Permit2 `permit` against the quote: on the input chain, for exactly the input amount of the input
 * token, to the deposit target, and on the same Permit2 as the `permit2-approve` tx it replaces.
 */
function checkPermit(quote: XSwapQuote, permit: XSwapPermitTypedData, deposit: XSwapTx, permit2Approval?: XSwapTx) {
  const { domain, message } = permit
  if (permit.primaryType !== 'PermitSingle' || !permit.types.PermitSingle) {
    throw new XSwapPlanError('permit is not a Permit2 PermitSingle')
  }
  if (domain.chainId !== quote.tokenIn.chainId) {
    throw new XSwapPlanError('permit on another chain than the input')
  }
  if (!sameAddress(message.details.token, quote.tokenIn.address)) {
    throw new XSwapPlanError('permit is not on the input token')
  }
  if (!sameAddress(message.spender, deposit.to)) {
    throw new XSwapPlanError('permit spender is not the deposit target')
  }
  if (BigInt(message.details.amount) !== BigInt(quote.inputAmount)) {
    throw new XSwapPlanError('permit amount is not the input amount')
  }
  if (permit2Approval && !sameAddress(permit2Approval.to, domain.verifyingContract)) {
    throw new XSwapPlanError('permit and permit2-approve are on different Permit2 contracts')
  }
}

/**
 * The quote's txs in send order, after checking them against the quote:
 * - every tx is on the input chain, and there is exactly one `deposit`, sent last. Its target is what the approvals are
 *   for: XChainSender for a cross-chain order; the Universal Router (`xswap`) or Uniswap's SwapProxy (`uniswap`) for a
 *   same-chain swap;
 * - every `approve` / `approve-reset` approves the input token, to the deposit target or to Permit2, where a
 *   `permit2-approve` (or a signed `permit`) then gives the deposit target its allowance on the same Permit2;
 * - a `permit`, if offered, is for exactly the input amount, to the deposit target.
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
  const deposit = deposits[0]
  const target = deposit.to

  const permit2Approvals = txs.filter((tx) => tx.kind === 'permit2-approve')
  if (permit2Approvals.length > 1) {
    throw new XSwapPlanError('more than one permit2-approve')
  }
  const permit2Approval = permit2Approvals[0]
  if (permit2Approval) {
    const { token, spender } = decodePermit2Approve(permit2Approval)
    if (!sameAddress(spender, target) || !sameAddress(token, quote.tokenIn.address)) {
      throw new XSwapPlanError('permit2-approve does not allow the deposit target to spend the input token')
    }
  }
  if (quote.permit) {
    checkPermit(quote, quote.permit, deposit, permit2Approval)
  }
  const permit2 = permit2Approval?.to ?? quote.permit?.domain.verifyingContract
  // Both come from the API: only the chain's canonical Permit2 may receive the token's approval.
  if (permit2 && !sameAddress(permit2, permit2Address(chainId))) {
    throw new XSwapPlanError('Permit2 is not the canonical Permit2 contract')
  }

  for (const tx of txs) {
    if (tx.kind !== 'approve' && tx.kind !== 'approve-reset') {
      continue
    }
    if (!sameAddress(tx.to, quote.tokenIn.address)) {
      throw new XSwapPlanError(`${tx.kind} is not on the input token`)
    }
    const spender = decodeErc20ApproveSpender(tx)
    if (!sameAddress(spender, target) && !sameAddress(spender, permit2)) {
      throw new XSwapPlanError(`${tx.kind} spender is neither the deposit target nor Permit2`)
    }
  }
  return txs
}

type PlanSpenders = {
  target?: string
  /** Permit2, if the plan goes through it. */
  permit2?: string
  /** Lowercased spenders of the plan's ERC-20 `approve` / `approve-reset` txs. */
  erc20: Set<string>
}

/** Contracts the plan's approvals are granted to. */
function planSpenders(quote: XSwapQuote, txs: XSwapTx[]): PlanSpenders {
  return {
    target: txs.find((tx) => tx.kind === 'deposit')?.to,
    permit2: txs.find((tx) => tx.kind === 'permit2-approve')?.to ?? quote.permit?.domain.verifyingContract,
    erc20: new Set(
      txs
        .filter((tx) => tx.kind === 'approve' || tx.kind === 'approve-reset')
        .map((tx) => decodeErc20ApproveSpender(tx).toLowerCase()),
    ),
  }
}

/**
 * Whether a replacement plan spends through what `approved` already set up: the same deposit target, no other Permit2,
 * and no ERC-20 approval of a spender the sent approvals did not cover (e.g. a direct approval of the target in place of
 * Permit2's allowance). A replacement with only the deposit relies on the allowances already granted.
 */
function coveredBy(approved: PlanSpenders, next: PlanSpenders): boolean {
  if (!sameAddress(next.target, approved.target)) {
    return false
  }
  if (next.permit2 !== undefined && !sameAddress(next.permit2, approved.permit2)) {
    return false
  }
  return [...next.erc20].every((spender) => approved.erc20.has(spender))
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
  /** `POST /v1/quote/:quoteId/permit`: the quote's swap built from the signed permit, as a new quote. */
  permitQuote: (quoteId: string, signature: string) => Promise<XSwapQuote>
  /** Switches the wallet to the permit's chain if needed, signs the typed data and returns the signature. */
  signPermit: (permit: XSwapPermitTypedData) => Promise<string>
  /** Switches the wallet to `tx.chainId` if needed, sends the tx and returns its hash. */
  sendTx: (tx: XSwapTx) => Promise<string>
  /** Resolves true when the tx succeeded, false when it reverted. Only approvals are waited for. */
  waitForTx: (chainId: number, hash: string) => Promise<boolean>
  registerOrder: (params: { quoteId: string; txHash: string }) => Promise<XSwapOrder>
}

/** A tx, or `permit`: the Permit2 signature sent in place of the `permit2-approve` tx. */
export type XSwapStepKind = XSwapTxKind | 'permit'
type XSwapStepStatus = 'pending' | 'active' | 'submitted' | 'done' | 'error'
/** `tx` is unset for `permit`, and for a deposit the API builds from the signature until it is built. */
export type XSwapStep = { kind: XSwapStepKind; chainId: number; tx?: XSwapTx; status: XSwapStepStatus; hash?: string }

/**
 * The steps to run for a quote. With `usePermit` and a quote offering a `permit`, the signature replaces the
 * `permit2-approve` tx: only the token's approvals of Permit2 are sent as txs, then the permit is signed and the API
 * builds the deposit from it (a 3-tx ERC-20 swap becomes 2 txs and a signature).
 */
export function planXSwapSteps(quote: XSwapQuote, usePermit: boolean): XSwapStep[] {
  return stepsOf(quote, planXSwapTxs(quote), usePermit)
}

/** `planXSwapSteps` for txs `planXSwapTxs` already checked. */
function stepsOf(quote: XSwapQuote, txs: XSwapTx[], usePermit: boolean): XSwapStep[] {
  const chainId = quote.tokenIn.chainId
  const step = (tx: XSwapTx): XSwapStep => ({ kind: tx.kind, chainId, tx, status: 'pending' })
  if (!usePermit || !quote.permit) {
    return txs.map(step)
  }
  const permit2 = quote.permit.domain.verifyingContract
  const permit2Approvals = txs.filter(
    (tx) =>
      (tx.kind === 'approve' || tx.kind === 'approve-reset') && sameAddress(decodeErc20ApproveSpender(tx), permit2),
  )
  return [
    ...permit2Approvals.map(step),
    { kind: 'permit', chainId, status: 'pending' },
    { kind: 'deposit', chainId, status: 'pending' },
  ]
}

type XSwapExecutionOptions = {
  /** Sign a quote's `permit` instead of sending its `permit2-approve` tx. Default true. */
  usePermit?: boolean
  onPlan?: (steps: XSwapStep[]) => void
  onStep?: (index: number, patch: Partial<XSwapStep>) => void
  /** A refresh or a signed permit replaced the quote: its `quoteId`, amounts and expiry changed. */
  onQuote?: (quote: XSwapQuote) => void
  onRegistering?: () => void
}

/** Maps the API's `quote_unavailable` (410) to `XSwapQuoteExpiredError`. */
async function orQuoteExpired<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof XSwapApiError && (error.code === 'quote_unavailable' || error.status === 410)) {
      throw new XSwapQuoteExpiredError()
    }
    throw error
  }
}

/**
 * `POST /v1/quote/:quoteId/permit`, with its answers mapped: `quote_unavailable` → `XSwapQuoteExpiredError`;
 * `permit_unavailable` (the quote can no longer be signed) → `XSwapQuoteChangedError`, re-quote;
 * `validator_failed` / `simulation_failed` → `XSwapPermitRejectedError`.
 */
async function permitQuote(
  quoteId: string,
  signature: string,
  deps: Pick<XSwapExecutionDeps, 'permitQuote'>,
): Promise<XSwapQuote> {
  try {
    return await orQuoteExpired(() => deps.permitQuote(quoteId, signature))
  } catch (error) {
    if (error instanceof XSwapApiError) {
      if (error.code === 'permit_unavailable') {
        throw new XSwapQuoteChangedError('route')
      }
      if (error.code === 'validator_failed' || error.code === 'simulation_failed') {
        throw new XSwapPermitRejectedError(error.code)
      }
    }
    throw error
  }
}

/** Throws when the permit's signature or allowance would lapse before the deposit can use it. */
function assertPermitUsable(permit: XSwapPermitTypedData, now: number): void {
  const deadline = now + XSWAP_QUOTE_EXPIRY_MARGIN_MS
  if (
    Number(permit.message.sigDeadline) * 1000 <= deadline ||
    Number(permit.message.details.expiration) * 1000 <= deadline
  ) {
    throw new XSwapQuoteExpiredError()
  }
}

/** The quote unchanged while it has time left, else a refreshed one. */
async function ensureFreshXSwapQuote(
  quote: XSwapQuote,
  deps: Pick<XSwapExecutionDeps, 'now' | 'refreshQuote'>,
): Promise<XSwapQuote> {
  if (!isXSwapQuoteExpiring(quote, deps.now())) {
    return quote
  }
  return orQuoteExpired(() => deps.refreshQuote(quote.quoteId))
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
      // A definite answer (e.g. quote_not_found, tx_sender_mismatch) does not change on retry; `tx_not_found` does once
      // the just-sent deposit reaches the API's RPC.
      if (
        error instanceof XSwapApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429 &&
        error.code !== 'tx_not_found'
      ) {
        break
      }
    }
  }
  throw new XSwapRegisterError(params.txHash, lastError)
}

function depositOf(txs: XSwapTx[]): XSwapTx {
  // planXSwapTxs guarantees one deposit, last.
  return txs[txs.length - 1]
}

/**
 * Sends a quote's txs in order, then registers the order (same-chain swaps are tracked as orders too):
 * 1. refresh the quote if it is about to expire (`quote_unavailable` → `XSwapQuoteExpiredError`, re-quote);
 * 2. send each approval and wait for it;
 * 3. with a `permit`: refresh again if needed, sign it, and take the deposit `POST /v1/quote/:quoteId/permit` builds
 *    from the signature; that quote is not refreshed (it would drop the signature), so once expired it fails;
 * 4. else refresh again before the deposit, since approvals take time, and send the refreshed quote's deposit;
 * 5. `POST /v1/orders` with the deposit's quote and hash as soon as it is sent, without waiting for its receipt: the
 *    API takes a pending tx and its tracker follows it (a reverted deposit ends `FAILED_ORIGIN`). Waiting on the UI's own
 *    RPC could hang forever when that RPC fails, since viem's receipt polling swallows RPC errors.
 *
 * A refresh or a signed quote that lowers `minOutputAmount`, spends another amount, or targets other contracts than the
 * approvals already sent stops with `XSwapQuoteChangedError`.
 */
export async function executeXSwapQuote(
  initialQuote: XSwapQuote,
  deps: XSwapExecutionDeps,
  { usePermit = true, ...callbacks }: XSwapExecutionOptions = {},
): Promise<XSwapOrder> {
  let quote = await ensureFreshXSwapQuote(initialQuote, deps)
  if (quote !== initialQuote) {
    assertRefreshAgreed(initialQuote, quote)
    callbacks.onQuote?.(quote)
  }
  // The txs of `quote`, kept in step with it.
  let quoteTxs = planXSwapTxs(quote)
  const approved = planSpenders(quote, quoteTxs)
  const steps = stepsOf(quote, quoteTxs, usePermit)
  callbacks.onPlan?.(steps)

  /** A replacement quote must still be what the user agreed to, and spend through the contracts already approved. */
  const assertCovered = (next: XSwapQuote): XSwapTx[] => {
    assertRefreshAgreed(initialQuote, next)
    const txs = planXSwapTxs(next)
    if (!coveredBy(approved, planSpenders(next, txs))) {
      throw new XSwapQuoteChangedError('route')
    }
    return txs
  }
  /** The quote with time left for the next step. */
  const freshCovered = async (): Promise<XSwapTx[]> => {
    const fresh = await ensureFreshXSwapQuote(quote, deps)
    if (fresh !== quote) {
      quoteTxs = assertCovered(fresh)
      quote = fresh
      callbacks.onQuote?.(quote)
    }
    return quoteTxs
  }

  // Set once the API built the deposit from the signature.
  let signed = false
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]

    if (step.kind === 'permit') {
      callbacks.onStep?.(index, { status: 'active' })
      // The approvals may have taken a while.
      const txs = await freshCovered()
      const { permit } = quote
      if (permit) {
        assertPermitUsable(permit, deps.now())
        const signature = await deps.signPermit(permit)
        const signedQuote = await permitQuote(quote.quoteId, signature, deps)
        const signedTxs = assertCovered(signedQuote)
        if (signedTxs.length !== 1 || signedQuote.permit) {
          throw new XSwapPlanError('signed quote is not the deposit alone')
        }
        quote = signedQuote
        quoteTxs = signedTxs
        signed = true
        callbacks.onQuote?.(quote)
      } else if (txs.length !== 1) {
        // A refreshed quote offers no permit once the Permit2 allowance covers the swap; it must not need other txs.
        throw new XSwapQuoteChangedError('route')
      }
      callbacks.onStep?.(index, { status: 'done' })
      continue
    }

    let tx = step.tx
    if (step.kind === 'deposit') {
      if (signed) {
        // A refresh would drop the signature. Same margin as elsewhere: the wallet prompt may stay open a while.
        if (isXSwapQuoteExpiring(quote, deps.now())) {
          throw new XSwapQuoteExpiredError()
        }
        tx = depositOf(quoteTxs)
      } else {
        // Approvals take time; the deposit must come from an unexpired quote.
        tx = depositOf(await freshCovered())
      }
      if (tx !== step.tx) {
        steps[index] = { ...step, tx }
        callbacks.onStep?.(index, { tx })
      }
    }
    if (!tx) {
      throw new XSwapPlanError(`${step.kind} has no tx`)
    }

    callbacks.onStep?.(index, { status: 'active' })
    const hash = await deps.sendTx(tx)
    callbacks.onStep?.(index, { status: 'submitted', hash })

    if (tx.kind === 'deposit') {
      callbacks.onRegistering?.()
      const order = await registerWithRetry({ quoteId: quote.quoteId, txHash: hash }, deps)
      callbacks.onStep?.(index, { status: 'done' })
      return order
    }

    // The next tx relies on this approval.
    const ok = await deps.waitForTx(tx.chainId, hash)
    if (!ok) {
      callbacks.onStep?.(index, { status: 'error' })
      throw new XSwapTxRevertedError(tx.kind, hash)
    }
    callbacks.onStep?.(index, { status: 'done' })
  }
  // planXSwapSteps guarantees a deposit last.
  throw new XSwapPlanError('no deposit sent')
}
