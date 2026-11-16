import { SEPOLIA, TOKENS, XSWAP_ROUTER, sameChainBurnQuote, sameChainMintQuote } from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'

// X-Gate's 1:1 mint and burn of the real USDT / USDC on its own chain, as x-gate-ui's mint and burn pages did.
test.describe('same-chain X-Gate mint and burn', () => {
  test('shows the mint as a mint and sends it with no fee', async ({ swap, api, chain }) => {
    const quote = sameChainMintQuote()
    serveQuote(api, quote)
    await swap.goto()
    await swap.quote('USDT', { symbol: 'USDTX', chain: 'Sepolia' }, '10')

    await expect(swap.output.locator('.token-amount-input')).toHaveValue('10.0')
    expect(api.calls('POST /quote').at(-1)?.body).toMatchObject({
      tokenIn: TOKENS.usdtSepolia.address,
      tokenOut: TOKENS.usdtxSepolia.address,
      tokenOutChainId: SEPOLIA,
      amount: '10000000',
    })

    await swap.openDetails()
    const legs = swap.page.getByTestId('xswap-route-legs').getByRole('listitem')
    await expect(legs).toHaveCount(1)
    await expect(legs.nth(0)).toHaveAttribute('data-testid', 'xswap-route-leg-mint')
    await expect(legs.nth(0)).toContainText('Mint')
    await expect(legs.nth(0)).toContainText('USDT → USDTX')
    await expect(legs.nth(0)).toContainText('Sepolia · X-Gate · out 10 USDTX')
    await expect(legs.nth(0)).not.toContainText('Bridge')
    await expect(legs.nth(0)).not.toContainText('Sepolia → Sepolia')

    await swap.execute()
    await swap.expectTrackerAfterMined()

    const [approve, deposit] = chain.sent()
    expect(chain.sent().map((tx) => tx.kind)).toEqual(['approve', 'deposit'])
    expect(approve.to.toLowerCase()).toBe(TOKENS.usdtSepolia.address.toLowerCase())
    expect(deposit.to.toLowerCase()).toBe(XSWAP_ROUTER.toLowerCase())
    expect(deposit.value).toBe(0n)
    expect(api.calls('POST /orders').map((r) => r.body)).toEqual([{ quoteId: quote.quoteId, txHash: deposit.hash }])
  })

  test('shows the burn as a burn', async ({ swap, api, chain }) => {
    chain.setBalance(SEPOLIA, TOKENS.usdtxSepolia.address, 1_000_000_000n)
    serveQuote(api, sameChainBurnQuote())
    await swap.goto()
    await swap.quote('USDTX', { symbol: 'USDT', chain: 'Sepolia' }, '10')

    await swap.openDetails()
    const [leg] = await swap.page.getByTestId('xswap-route-legs').getByRole('listitem').all()
    await expect(leg).toHaveAttribute('data-testid', 'xswap-route-leg-burn')
    await expect(leg).toContainText('Burn')
    await expect(leg).toContainText('USDTX → USDT')
    await expect(leg).toContainText('Sepolia · X-Gate · out 10 USDT')
    await expect(leg).not.toContainText('Bridge')
    await expect(swap.executeButton).toBeEnabled()
  })
})
