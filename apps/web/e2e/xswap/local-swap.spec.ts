import { SEPOLIA, USDC_SEPOLIA, XSWAP_ROUTER, localQuote } from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'
import { ApiError } from '../support/xswapApi'

test.describe('same-chain swap', () => {
  test('approves Permit2, signs the permit and swaps through the router', async ({ swap, api, chain }) => {
    const quote = localQuote()
    serveQuote(api, quote)
    await swap.goto()
    await swap.quote('USDC', { symbol: 'ETH' }, '100')

    await expect(swap.output.locator('.token-amount-input')).toHaveValue('0.04')
    expect(api.calls('POST /quote').at(-1)?.body).toMatchObject({ tokenOutChainId: SEPOLIA, amount: '100000000' })

    // Hold the approval to read the steps: the panel clears them once the order is registered.
    chain.hold('approve')
    await swap.execute()
    const pending = await chain.waitForSend('approve')
    await expect(swap.step(0)).toContainText('Approve the input amount')
    await expect(swap.step(1)).toContainText('Sign the Permit2 allowance (no gas)')
    await expect(swap.step(2)).toContainText('Swap')
    chain.mine(pending.hash)
    await swap.expectTrackerAfterMined()

    // permit2-approve is replaced by the signature; the swap goes to the router with the signed quote.
    const [approve, deposit] = chain.sent()
    expect(chain.sent().map((tx) => tx.kind)).toEqual(['approve', 'deposit'])
    expect(approve.to.toLowerCase()).toBe(USDC_SEPOLIA.toLowerCase())
    expect(deposit.to.toLowerCase()).toBe(XSWAP_ROUTER.toLowerCase())
    expect(chain.signatures).toHaveLength(1)
    expect(api.calls(`POST /quote/${quote.quoteId}/permit`)).toHaveLength(1)
    expect(api.calls('POST /orders').map((r) => r.body)).toEqual([
      { quoteId: `${quote.quoteId}-signed`, txHash: deposit.hash },
    ])
  })

  test('stops when the API refuses the signed swap', async ({ swap, api, chain }) => {
    serveQuote(api, localQuote())
    api.set({ permit: () => new ApiError(422, 'validator_failed') })
    await swap.goto()
    await swap.quote('USDC', { symbol: 'ETH' }, '100')
    await swap.execute()

    await expect(swap.executeError).toContainText('The signed swap did not pass the safety checks')
    expect(chain.sent('deposit')).toHaveLength(0)
  })

  test('rejects a signed quote that carries more than the deposit', async ({ swap, api, chain }) => {
    serveQuote(api, localQuote())
    api.set({ permit: (quoteId) => ({ ...localQuote({ quoteId: `${quoteId}-signed` }), permit: undefined }) })
    await swap.goto()
    await swap.quote('USDC', { symbol: 'ETH' }, '100')
    await swap.execute()

    await expect(swap.executeError).toContainText('This route returned transactions that cannot be sent safely')
    expect(chain.sent('deposit')).toHaveLength(0)
  })
})
