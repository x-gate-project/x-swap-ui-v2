import type { XSwapOrder, XSwapOrderStatus, XSwapQuote } from '../../src/state/xswap/types'
import { order, quoteResponse, signedQuote } from './fixtures'
import { ApiError, XSwapApiStub } from './xswapApi'

/**
 * The happy path of one quote: `POST /quote` answers `best` (and `candidates`), a signed permit gets the deposit-only
 * quote, `POST /orders` registers a SUBMITTED order (unless `registerError` fails that attempt), and each
 * `GET /orders/:id` poll moves it along `statuses`, staying on the last one.
 */
export function serveQuote(
  api: XSwapApiStub,
  best: XSwapQuote,
  {
    candidates = [],
    statuses = ['FILLED'],
    registerError,
  }: {
    candidates?: XSwapQuote[]
    statuses?: XSwapOrderStatus[]
    /** Fails `POST /orders` attempt `attempt` (from 0) with this error; undefined registers it. */
    registerError?: (attempt: number) => ApiError | undefined
  } = {},
) {
  const quotes = new Map<string, XSwapQuote>([best, ...candidates].map((q) => [q.quoteId, q]))
  let registered: XSwapOrder | undefined
  api.set({
    quote: () => quoteResponse(best, candidates),
    permit: (quoteId) => {
      const signed = signedQuote(quotes.get(quoteId) ?? best)
      quotes.set(signed.quoteId, signed)
      return signed
    },
    register: ({ quoteId, txHash }, attempt) => {
      const error = registerError?.(attempt)
      if (error) {
        return error
      }
      registered = order(quotes.get(quoteId) ?? best, txHash, 'SUBMITTED')
      return registered
    },
    order: (_, attempt) => {
      const current = registered as XSwapOrder
      const status = statuses[Math.min(attempt, statuses.length - 1)]
      return { ...order(best, current.originTxHash, status), id: current.id, quoteId: current.quoteId }
    },
  })
}
