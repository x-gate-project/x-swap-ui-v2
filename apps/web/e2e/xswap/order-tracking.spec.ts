import type { XSwapOrderStatus } from '../../src/state/xswap/types'
import { order, xchainQuote } from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'

const USDC_TO_ARB = { symbol: 'USDC', chain: 'Arbitrum Sepolia' }

test.describe('order tracking', () => {
  test('follows the order from submitted to filled', async ({ swap, api }) => {
    serveQuote(api, xchainQuote(), { statuses: ['DEPOSITED', 'FILLED'] })
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    // The tracker polls GET /orders/:id every 3 s until the order is terminal.
    await expect(swap.tracker).toContainText('Submitted')
    await expect(swap.tracker).toContainText('Deposited, waiting for the destination')
    await expect(swap.tracker).toContainText('Completed')
    await expect(swap.tracker).not.toContainText('Updating…')
    const polls = api.requests.filter((r) => r.method === 'GET' && /^\/orders\/.+/.test(r.path)).length
    await swap.page.waitForTimeout(4_000)
    expect(api.requests.filter((r) => r.method === 'GET' && /^\/orders\/.+/.test(r.path))).toHaveLength(polls)
  })

  for (const [status, label] of [
    ['REFUNDED', 'Refunded'],
    ['FAILED_ORIGIN', 'Origin transaction failed'],
  ] as [XSwapOrderStatus, string][]) {
    test(`ends on ${status}`, async ({ swap, api }) => {
      serveQuote(api, xchainQuote(), { statuses: [status] })
      await swap.goto()
      await swap.quote('USDC', USDC_TO_ARB, '100')
      await swap.execute()

      await expect(swap.tracker).toContainText(label)
      await expect(swap.tracker).not.toContainText('Updating…')
    })
  }

  test('lists past orders in the activity tab', async ({ swap, api }) => {
    const past = order(xchainQuote(), `0x${'a'.repeat(64)}`, 'FILLED')
    api.set({ orders: () => ({ orders: [past], nextCursor: null }) })
    await swap.goto()

    await swap.page.getByTestId('web3-status-connected').click()
    await swap.page.getByText('Activity', { exact: true }).click()
    await expect(swap.page.getByTestId('activity-content')).toContainText('Swapped cross-chain')
  })
})
