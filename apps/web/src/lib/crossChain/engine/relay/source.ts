import type { BridgeDisplay, BridgeProvider } from 'lib/crossChain/bridge'
import { directSource } from 'lib/crossChain/engine/relay'
import type { AggregatorProviderId, OrderRef, OrderStatus, Quote, SwapRequest } from 'lib/crossChain/engine/relay/types'

export interface AggregatorSource {
  /** Sorted by minOutput desc, [0] = best. Rejects when no provider returns a valid quote. */
  getQuotes(req: SwapRequest, signal: AbortSignal): Promise<Quote[]>
  /** Called once the deposit tx is sent; returns the id to persist for status polling. */
  registerOrder(quote: Quote, txHash: `0x${string}`): Promise<string>
  /** undefined = not indexed yet. */
  getOrderStatus(ref: OrderRef): Promise<OrderStatus | undefined>
}

// ponytail: direct provider calls only. When the backend (feature/x-swap-crosschain) ships, add
// aggregator/backend/ implementing AggregatorSource and switch here on REACT_APP_CROSSCHAIN_API_URL.
export const aggregatorSource: AggregatorSource = directSource

export const PROVIDER_DISPLAY: Record<AggregatorProviderId, BridgeDisplay> = {
  relay: { name: 'Relay', logoUrl: '/images/logos/relay-logo.png' },
}

/** Adapts an aggregator order to `waitForBridge`. EXPIRED stays pending: a refund follows it. */
export function aggregatorTracker(provider: AggregatorProviderId, id: string): Pick<BridgeProvider, 'name' | 'getStatus'> {
  return {
    name: provider,
    async getStatus({ srcChainId }) {
      const s = await aggregatorSource.getOrderStatus({ provider, id, srcChainId })
      if (s === 'FILLED' || s === 'FILLED_FALLBACK') {return 'filled'}
      return s === 'REFUNDED' || s === 'FAILED_ORIGIN' ? 'failed' : 'pending'
    },
  }
}
