import { Address, Hex, keccak256, toHex } from 'viem'

export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'
export const NATIVE = 'native'

const APPROVE_SELECTOR = '0x095ea7b3'
const PERMIT2_APPROVE_SELECTOR = '0x87517c45'

type TxKind = 'approve' | 'permit2-approve' | 'deposit'
type TxStatus = 'pending' | 'success' | 'reverted'

type SentTx = {
  hash: Hex
  chainId: number
  from: Address
  to: Address
  data: Hex
  value: bigint
  kind: TxKind
  status: TxStatus
  blockNumber?: bigint
}

type TokenInfo = { chainId: number; address: string; symbol: string; name?: string; decimals: number }

type Waiter = { kind: TxKind; resolve: (tx: SentTx) => void }

const key = (chainId: number, token: string) => `${chainId}:${token.toLowerCase()}`

/** What a tx does, from its calldata: the same split the app makes when it plans the quote's txs. */
function txKindOf(to: string, data: string): TxKind {
  if (data.startsWith(APPROVE_SELECTOR)) {
    return 'approve'
  }
  if (to.toLowerCase() === PERMIT2_ADDRESS.toLowerCase() && data.startsWith(PERMIT2_APPROVE_SELECTOR)) {
    return 'permit2-approve'
  }
  return 'deposit'
}

/**
 * In-memory chain state for one test, shared by the mock wallet (sends, signs) and the RPC stub (receipts, balances).
 * Every tx is mined at once unless the test holds or reverts its kind first.
 */
export class MockChain {
  readonly account: Address
  chainId: number
  blockNumber = 5_000_000n
  readonly txs = new Map<Hex, SentTx>()
  readonly signatures: { method: string; params: unknown }[] = []
  /** JSON-RPC methods nothing answered; the test fixture fails on the ones the x-swap path uses. */
  readonly unhandled = new Set<string>()

  private readonly rpcCalls = new Map<string, number>()
  private readonly balances = new Map<string, bigint>()
  private readonly tokens = new Map<string, TokenInfo>()
  private readonly held = new Set<TxKind>()
  private readonly reverting = new Set<TxKind>()
  private rejecting: string | undefined
  private waiters: Waiter[] = []

  constructor({ account, chainId }: { account: Address; chainId: number }) {
    this.account = account
    this.chainId = chainId
  }

  record(method: string) {
    this.rpcCalls.set(method, (this.rpcCalls.get(method) ?? 0) + 1)
  }

  /** How many times the app (or its wallet) called this JSON-RPC method. */
  calls(method: string): number {
    return this.rpcCalls.get(method) ?? 0
  }

  addToken(token: TokenInfo, balance?: bigint) {
    this.tokens.set(key(token.chainId, token.address), token)
    if (balance !== undefined) {
      this.setBalance(token.chainId, token.address, balance)
    }
  }

  token(chainId: number, address: string): TokenInfo | undefined {
    return this.tokens.get(key(chainId, address))
  }

  /** `token` is an ERC-20 address, or `NATIVE` for the chain's native balance. */
  setBalance(chainId: number, token: string, amount: bigint) {
    this.balances.set(key(chainId, token), amount)
  }

  balance(chainId: number, token: string): bigint {
    return this.balances.get(key(chainId, token)) ?? 0n
  }

  /** Sends of this kind stay pending (no receipt) until `mine`. */
  hold(kind: TxKind) {
    this.held.add(kind)
  }

  /** Sends of this kind are mined with a reverted receipt. */
  revert(kind: TxKind) {
    this.reverting.add(kind)
  }

  /** The next wallet request with this method fails with EIP-1193 4001 (user rejected). */
  rejectNext(method: 'eth_sendTransaction' | 'eth_signTypedData_v4') {
    this.rejecting = method
  }

  takeRejection(method: string): boolean {
    if (this.rejecting === method) {
      this.rejecting = undefined
      return true
    }
    return false
  }

  mine(hash: Hex, status: Exclude<TxStatus, 'pending'> = 'success') {
    const tx = this.txs.get(hash)
    if (!tx) {
      throw new Error(`mine: unknown tx ${hash}`)
    }
    this.blockNumber += 1n
    tx.status = status
    tx.blockNumber = this.blockNumber
  }

  sendTransaction(params: { from?: string; to: string; data?: string; value?: string }): Hex {
    const data = (params.data ?? '0x') as Hex
    const kind = txKindOf(params.to, data)
    const hash = keccak256(toHex(`${this.chainId}:${this.txs.size}:${params.to}:${data}`))
    const tx: SentTx = {
      hash,
      chainId: this.chainId,
      from: (params.from ?? this.account) as Address,
      to: params.to as Address,
      data,
      value: params.value ? BigInt(params.value) : 0n,
      kind,
      status: 'pending',
    }
    this.txs.set(hash, tx)
    if (!this.held.has(kind)) {
      this.mine(hash, this.reverting.has(kind) ? 'reverted' : 'success')
    }
    this.waiters = this.waiters.filter((w) => (w.kind === kind ? (w.resolve(tx), false) : true))
    return hash
  }

  sent(kind?: TxKind): SentTx[] {
    return [...this.txs.values()].filter((tx) => !kind || tx.kind === kind)
  }

  /** Resolves with the first tx of this kind, already sent or sent later. */
  waitForSend(kind: TxKind): Promise<SentTx> {
    const sent = this.sent(kind)[0]
    if (sent) {
      return Promise.resolve(sent)
    }
    return new Promise((resolve) => this.waiters.push({ kind, resolve }))
  }
}
