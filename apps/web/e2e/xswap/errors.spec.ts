import { quoteResponse, xchainQuote } from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'
import { ApiError } from '../support/xswapApi'

const USDC_TO_ARB = { symbol: 'USDC', chain: 'Arbitrum Sepolia' }

test.describe('errors', () => {
  for (const [code, message] of [
    ['local_unsupported', 'Same-chain swap not available on this chain'],
    ['no_route', 'No route for this pair'],
  ]) {
    test(`shows the ${code} quote error`, async ({ swap, api }) => {
      api.set({ quote: () => new ApiError(422, code) })
      await swap.goto()
      await swap.quote('USDC', { symbol: 'ETH' }, '100')

      await expect(swap.quoteError).toHaveText(message)
      await expect(swap.executeButton).toBeHidden()
    })
  }

  test('refreshes an expiring quote before sending', async ({ swap, api, chain }) => {
    // Inside the 15 s expiry margin from the start: the panel refreshes before the first tx.
    const expiring = xchainQuote({ expiresAt: Date.now() + 10_000 })
    serveQuote(api, expiring)
    const refreshed = { ...expiring, quoteId: `${expiring.quoteId}-r`, expiresAt: Date.now() + 120_000 }
    api.set({ quote: () => quoteResponse({ ...expiring, expiresAt: Date.now() + 10_000 }), refresh: () => refreshed })
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    await expect(swap.tracker).toBeVisible()
    expect(api.calls(`POST /quote/${expiring.quoteId}/refresh`).length).toBeGreaterThan(0)
    const [deposit] = chain.sent('deposit')
    expect(api.calls('POST /orders')[0].body).toEqual({ quoteId: refreshed.quoteId, txHash: deposit.hash })
  })

  test('requotes when the quote can no longer be refreshed', async ({ swap, api, chain }) => {
    serveQuote(api, xchainQuote())
    api.set({
      quote: () => quoteResponse(xchainQuote({ quoteId: 'q-expiring', expiresAt: Date.now() + 10_000 })),
      refresh: () => new ApiError(410, 'quote_unavailable'),
    })
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    const quotesBefore = api.calls('POST /quote').length
    await swap.execute()

    // The panel re-quotes at once; nothing is sent from the expired quote.
    await expect.poll(() => api.calls('POST /quote').length).toBeGreaterThan(quotesBefore)
    expect(api.calls('POST /quote/q-expiring/refresh')).toHaveLength(1)
    expect(chain.sent()).toHaveLength(0)
    await expect(swap.executeButton).toBeEnabled()
  })

  test('stops on a reverted approval', async ({ swap, api, chain }) => {
    serveQuote(api, xchainQuote())
    chain.revert('approve')
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    await expect(swap.executeError).toHaveText('Transaction reverted')
    expect(chain.sent('deposit')).toHaveLength(0)
    await expect(swap.executeButton).toHaveText('Try again')
  })

  test('stops when the user rejects in the wallet', async ({ swap, api, chain }) => {
    serveQuote(api, xchainQuote())
    chain.rejectNext('eth_sendTransaction')
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    await expect(swap.executeError).toHaveText('Transaction rejected')
    expect(chain.sent()).toHaveLength(0)
  })
})
