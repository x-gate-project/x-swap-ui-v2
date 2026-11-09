import { test as base, expect } from '@playwright/test'

import { ACCOUNT, ALL_TOKENS, CHAINS, NATIVE_ADDRESS, SEPOLIA, TOKENS, allRoutes } from './fixtures'
import { MockChain, NATIVE } from './mockChain'
import { installNetwork } from './network'
import { SwapPage } from './swapPage'
import { installWallet } from './wallet'
import { XSwapApiStub } from './xswapApi'

/**
 * Methods the x-swap execute path relies on; the stub must implement each. This checks methods only: an `eth_call` to a
 * contract the stub does not model is answered with a revert, as a call to an address without code would be.
 */
const REQUIRED_RPC = ['eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_blockNumber', 'eth_call']

type Fixtures = {
  chain: MockChain
  api: XSwapApiStub
  swap: SwapPage
}

/**
 * Each test gets a wallet on Sepolia holding 1 ETH and 1,000 USDC/USDT, an x-swap API that lists `CHAINS` and
 * `ALL_TOKENS` with every pair reachable, and no quote: tests set `api.set({ quote })` for their scenario.
 */
export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures destructure their dependencies; this one has none
  chain: async ({}, use) => {
    const chain = new MockChain({ account: ACCOUNT, chainId: SEPOLIA })
    for (const token of ALL_TOKENS) {
      if (token.address !== NATIVE_ADDRESS) {
        chain.addToken({ ...token, name: token.symbol })
      }
    }
    chain.setBalance(SEPOLIA, NATIVE, 10n ** 18n)
    chain.setBalance(SEPOLIA, TOKENS.usdcSepolia.address, 1_000_000_000n)
    chain.setBalance(SEPOLIA, TOKENS.usdtSepolia.address, 1_000_000_000n)
    await use(chain)
    const missing = REQUIRED_RPC.filter((m) => chain.unhandled.has(m))
    expect(missing, 'RPC methods the stub left unanswered').toEqual([])
    expect([...chain.unroutedRpcHosts], 'JSON-RPC hosts missing from RPC_HOSTS').toEqual([])
  },
  // eslint-disable-next-line no-empty-pattern -- as above
  api: async ({}, use) => {
    await use(new XSwapApiStub({ chains: CHAINS, tokens: ALL_TOKENS, routes: allRoutes }))
  },
  swap: async ({ page, context, chain, api, baseURL }, use) => {
    await installNetwork(context, { chain, api, baseURL: baseURL as string })
    await installWallet(page, chain)
    // Every price-impact confirm is accepted; the e2e quotes carry none.
    page.on('dialog', (dialog) => dialog.accept())
    await use(new SwapPage(page))
  },
})

export { expect }
