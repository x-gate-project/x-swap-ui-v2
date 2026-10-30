import type { AggregatorSource } from 'lib/crossChain/engine/relay/source'
import { supportsChain } from 'lib/crossChain/engine/relay/allowlist'
import { quoteRelay, relayOrderStatus } from 'lib/crossChain/engine/relay/relay'
import {
  AGGREGATOR_PROVIDERS,
  ProviderError,
  type AggregatorProviderId,
  type Quote,
  type SwapRequest,
} from 'lib/crossChain/engine/relay/types'

const QUOTE_TIMEOUT_MS = 4000

const QUOTERS: Record<AggregatorProviderId, (req: SwapRequest, signal: AbortSignal) => Promise<Quote>> = {
  relay: quoteRelay,
}

export function providersFor(srcChainId: number, dstChainId: number): AggregatorProviderId[] {
  return AGGREGATOR_PROVIDERS.filter((p) => supportsChain(p, srcChainId) && supportsChain(p, dstChainId))
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let id: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new ProviderError('timeout')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(id))
}

export const directSource: AggregatorSource = {
  async getQuotes(req, signal) {
    const providers = providersFor(req.src.chainId, req.dst.chainId)
    const results = await Promise.allSettled(providers.map((p) => withTimeout(QUOTERS[p](req, signal), QUOTE_TIMEOUT_MS)))
    const quotes = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (!quotes.length) {
      const err = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason
      throw err instanceof ProviderError ? err : new ProviderError('no_route', String(err ?? 'no provider'))
    }
    return quotes.sort((a, b) => (b.minOutput > a.minOutput ? 1 : b.minOutput < a.minOutput ? -1 : 0))
  },

  // Direct mode has no order store: Relay is tracked by requestId.
  async registerOrder(quote) {
    return quote.quoteId
  },

  getOrderStatus({ id, srcChainId }) {
    return relayOrderStatus(srcChainId, id)
  },
}
