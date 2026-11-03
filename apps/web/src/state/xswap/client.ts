import {
  XSwapChain,
  XSwapErrorBody,
  XSwapOrder,
  XSwapOrdersPage,
  XSwapQuote,
  XSwapQuoteRequest,
  XSwapQuoteResponse,
  XSwapRoutesResponse,
  XSwapToken,
} from 'state/xswap/types'

/**
 * Base URL of the x-swap API including the `/v1` prefix: `/api/xswap/v1`, served by the Vercel function in
 * `api/xswap` and, in local development, by `src/setupProxy.js`. The API sends no CORS headers, so the browser always
 * goes through that proxy. Unset disables every x-swap API call and the swap form keeps its old behavior.
 */
function getXSwapApiUrl(): string {
  return (process.env.REACT_APP_XSWAP_API_URL ?? '').replace(/\/+$/, '')
}

export function isXSwapApiEnabled(): boolean {
  return getXSwapApiUrl().length > 0
}

/** Code used when the request never got an API error envelope (network failure, non-JSON body). */
export const XSWAP_REQUEST_FAILED = 'request_failed'

export class XSwapApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly serverMessage?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(serverMessage && serverMessage !== code ? `${code}: ${serverMessage}` : code)
    this.name = 'XSwapApiError'
    // Keep `instanceof` working when classes are transpiled to ES5.
    Object.setPrototypeOf(this, XSwapApiError.prototype)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(getXSwapApiUrl() + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw error
    }
    throw new XSwapApiError(XSWAP_REQUEST_FAILED, 0, String(error))
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<XSwapErrorBody>) | null
  if (!res.ok) {
    throw new XSwapApiError(body?.code ?? `http_${res.status}`, res.status, body?.message, body?.details)
  }
  if (body === null) {
    throw new XSwapApiError(XSWAP_REQUEST_FAILED, res.status, 'empty response body')
  }
  return body as T
}

export async function getXSwapChains(signal?: AbortSignal): Promise<XSwapChain[]> {
  const { chains } = await request<{ chains: XSwapChain[] }>('/chains', { signal })
  return chains
}

export async function getXSwapTokens(chainId: number, signal?: AbortSignal): Promise<XSwapToken[]> {
  const { tokens } = await request<{ tokens: XSwapToken[] }>(`/tokens?chainId=${chainId}`, { signal })
  return tokens
}

/**
 * Tokens `tokenIn` can reach. An unknown or denylisted `tokenIn` is `unsupported_token` (400); `risk.killSwitch`
 * answers an empty list.
 */
export function getXSwapRoutes(
  tokenInChainId: number,
  tokenIn: string,
  signal?: AbortSignal,
): Promise<XSwapRoutesResponse> {
  const query = new URLSearchParams({ tokenInChainId: String(tokenInChainId), tokenIn })
  return request<XSwapRoutesResponse>(`/routes?${query.toString()}`, { signal })
}

/** Every provider's quote at once. No quote is an `XSwapApiError` (`no_route` carries `details.rejected`). */
export function getXSwapQuote(params: XSwapQuoteRequest, signal?: AbortSignal): Promise<XSwapQuoteResponse> {
  return request<XSwapQuoteResponse>('/quote', { method: 'POST', body: JSON.stringify(params), signal })
}

/**
 * A fresh quote for the same route, with a new `quoteId` and `expiresAt`. An expired quote the API no longer holds is
 * `quote_unavailable` (410): quote again from scratch.
 */
export function refreshXSwapQuote(quoteId: string, signal?: AbortSignal): Promise<XSwapQuote> {
  return request<XSwapQuote>(`/quote/${encodeURIComponent(quoteId)}/refresh`, { method: 'POST', signal })
}

/** Starts tracking the order once its deposit tx is mined. */
export function registerXSwapOrder(params: { quoteId: string; txHash: string }): Promise<XSwapOrder> {
  return request<XSwapOrder>('/orders', { method: 'POST', body: JSON.stringify(params) })
}

export function getXSwapOrder(id: string, signal?: AbortSignal): Promise<XSwapOrder> {
  return request<XSwapOrder>(`/orders/${encodeURIComponent(id)}`, { signal })
}

/** A wallet's orders, newest first. */
export function getXSwapOrders(wallet: string, cursor?: string, signal?: AbortSignal): Promise<XSwapOrdersPage> {
  const query = new URLSearchParams({ wallet })
  if (cursor) {
    query.set('cursor', cursor)
  }
  return request<XSwapOrdersPage>(`/orders?${query.toString()}`, { signal })
}
