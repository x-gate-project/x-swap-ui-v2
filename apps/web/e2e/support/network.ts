import { BrowserContext, Route } from '@playwright/test'

import { MockChain } from './mockChain'
import { JsonRpcRequest, RPC_HOSTS, respond } from './rpc'
import { XSwapApiStub } from './xswapApi'

const XSWAP_API_PATH = '/api/xswap/v1/'

/** Whether a request is a JSON-RPC call (single or batch), whatever host it goes to. */
function isJsonRpc(route: Route): boolean {
  if (route.request().method() !== 'POST') {
    return false
  }
  try {
    const body = route.request().postDataJSON() as unknown
    const first = Array.isArray(body) ? body[0] : body
    return typeof first === 'object' && first !== null && 'jsonrpc' in first && 'method' in first
  } catch {
    return false
  }
}

async function fulfillRpc(route: Route, chain: MockChain, chainId: number) {
  const body = route.request().postDataJSON() as JsonRpcRequest | JsonRpcRequest[]
  const json = Array.isArray(body) ? body.map((r) => respond(chain, chainId, r)) : respond(chain, chainId, body)
  await route.fulfill({ json })
}

/**
 * Routes every request the page makes: the x-swap API to its stub, chain RPCs to MockChain, the dev server through, and
 * everything else (GraphQL, Statsig, Amplitude, token lists, price APIs...) is aborted, so no test reaches the network.
 */
export async function installNetwork(
  context: BrowserContext,
  { chain, api, baseURL }: { chain: MockChain; api: XSwapApiStub; baseURL: string },
) {
  const appOrigin = new URL(baseURL).origin
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === appOrigin) {
      if (url.pathname.startsWith(XSWAP_API_PATH)) {
        return api.handle(route, url)
      }
      return route.fallback()
    }
    const rpcChainId = RPC_HOSTS[url.hostname]
    if (rpcChainId !== undefined && route.request().method() === 'POST') {
      return fulfillRpc(route, chain, rpcChainId)
    }
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.fallback()
    }
    if (isJsonRpc(route)) {
      // A chain RPC the stub does not know (a new transport or chain): the test fixture fails on it.
      chain.unroutedRpcHosts.add(url.hostname)
    }
    return route.abort('blockedbyclient')
  })
}
