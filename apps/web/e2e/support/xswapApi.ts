import { Route } from '@playwright/test'

import type {
  XSwapChain,
  XSwapOrder,
  XSwapOrdersPage,
  XSwapQuote,
  XSwapQuoteRequest,
  XSwapQuoteResponse,
  XSwapRoutesResponse,
  XSwapToken,
} from '../../src/state/xswap/types'

/** An error the stub answers instead of a body, as `{ code, message }` with this HTTP status. */
export class ApiError {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message = code,
  ) {}
}

type Answer<T> = T | ApiError

type ApiRequest = { method: string; path: string; query: URLSearchParams; body: unknown }

/** How the stubbed API answers. Each handler gets how many times it was called before (`attempt`, from 0). */
type ApiScenario = {
  chains: XSwapChain[]
  tokens: XSwapToken[]
  routes: (tokenInChainId: number, tokenIn: string) => Answer<XSwapRoutesResponse>
  quote: (request: XSwapQuoteRequest, attempt: number) => Answer<XSwapQuoteResponse>
  refresh: (quoteId: string, attempt: number) => Answer<XSwapQuote>
  permit: (quoteId: string, signature: string, attempt: number) => Answer<XSwapQuote>
  register: (body: { quoteId: string; txHash: string }, attempt: number) => Answer<XSwapOrder>
  order: (id: string, attempt: number) => Answer<XSwapOrder>
  orders: (wallet: string) => Answer<XSwapOrdersPage>
}

const notStubbed = (what: string) => () => new ApiError(501, 'not_stubbed', `e2e: ${what} is not stubbed`)

/** Serves `/api/xswap/v1/*` from a scenario and records every request for assertions. */
export class XSwapApiStub {
  readonly requests: ApiRequest[] = []
  private scenario: ApiScenario
  private readonly attempts = new Map<string, number>()

  constructor(scenario: Partial<ApiScenario> = {}) {
    this.scenario = {
      chains: [],
      tokens: [],
      routes: (chainId, tokenIn) => ({ tokenIn: { chainId, address: tokenIn }, destinations: [] }),
      quote: notStubbed('POST /quote'),
      refresh: notStubbed('POST /quote/:id/refresh'),
      permit: notStubbed('POST /quote/:id/permit'),
      register: notStubbed('POST /orders'),
      order: notStubbed('GET /orders/:id'),
      orders: () => ({ orders: [], nextCursor: null }),
      ...scenario,
    }
  }

  set(scenario: Partial<ApiScenario>) {
    this.scenario = { ...this.scenario, ...scenario }
  }

  /** Requests to `path` (e.g. `POST /orders`, `GET /orders/o1`), in order. */
  calls(methodAndPath: string): ApiRequest[] {
    return this.requests.filter((r) => `${r.method} ${r.path}` === methodAndPath)
  }

  private attempt(name: string): number {
    const n = this.attempts.get(name) ?? 0
    this.attempts.set(name, n + 1)
    return n
  }

  private answer(): Answer<unknown> | undefined {
    const { method, path, query, body } = this.requests[this.requests.length - 1]
    const s = this.scenario
    const segments = path.split('/').filter(Boolean)
    if (method === 'GET' && path === '/chains') {
      return { chains: s.chains }
    }
    if (method === 'GET' && path === '/tokens') {
      const chainId = Number(query.get('chainId'))
      return { tokens: s.tokens.filter((t) => t.chainId === chainId) }
    }
    if (method === 'GET' && path === '/routes') {
      return s.routes(Number(query.get('tokenInChainId')), query.get('tokenIn') ?? '')
    }
    if (method === 'POST' && path === '/quote') {
      return s.quote(body as XSwapQuoteRequest, this.attempt('quote'))
    }
    if (method === 'POST' && segments[0] === 'quote' && segments[2] === 'refresh') {
      return s.refresh(segments[1], this.attempt(`refresh`))
    }
    if (method === 'POST' && segments[0] === 'quote' && segments[2] === 'permit') {
      return s.permit(segments[1], (body as { signature: string }).signature, this.attempt('permit'))
    }
    if (method === 'POST' && path === '/orders') {
      return s.register(body as { quoteId: string; txHash: string }, this.attempt('register'))
    }
    if (method === 'GET' && path === '/orders') {
      return s.orders(query.get('wallet') ?? '')
    }
    if (method === 'GET' && segments[0] === 'orders' && segments[1]) {
      return s.order(segments[1], this.attempt(`order:${segments[1]}`))
    }
    return undefined
  }

  async handle(route: Route, url: URL) {
    const request = route.request()
    const raw = request.postData()
    this.requests.push({
      method: request.method(),
      path: url.pathname.replace(/^\/api\/xswap\/v1/, ''),
      query: url.searchParams,
      body: raw ? JSON.parse(raw) : undefined,
    })
    const answer = this.answer()
    if (answer === undefined) {
      return route.fulfill({ status: 404, json: { code: 'not_found', message: `e2e: no stub for ${url.pathname}` } })
    }
    if (answer instanceof ApiError) {
      return route.fulfill({ status: answer.status, json: { code: answer.code, message: answer.message } })
    }
    return route.fulfill({ json: answer })
  }
}
