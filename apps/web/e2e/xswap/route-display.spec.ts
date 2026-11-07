import { SEPOLIA, compositeQuote, jocEthStableQuote, xchainQuote } from '../support/fixtures'
import { NATIVE } from '../support/mockChain'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'

test.describe('route display', () => {
  test('names a composite route by its swap venues and lists its legs', async ({ swap, api }) => {
    serveQuote(api, compositeQuote())
    await swap.goto()
    await swap.selectToken('output', 'JOCX', 'Arbitrum Sepolia')
    await swap.typeAmount('1')

    const details = await swap.openDetails()
    await expect(details).toContainText('Uniswap v3 → Across → Uniswap v2')
    const legs = swap.page.getByTestId('xswap-route-legs').getByRole('listitem')
    await expect(legs).toHaveCount(3)
    await expect(legs.nth(0)).toHaveAttribute('data-testid', 'xswap-route-leg-swap')
    await expect(legs.nth(0)).toContainText('Sepolia · Uniswap v3 · 1 ETH → 2500 USDC (min 2487.5 USDC)')
    await expect(legs.nth(1)).toHaveAttribute('data-testid', 'xswap-route-leg-bridge')
    await expect(legs.nth(1)).toContainText('Sepolia → Arbitrum Sepolia via Across')
    await expect(legs.nth(2)).toContainText('→ 5000 JOCX (min 4975 JOCX)')
  })

  test('lists every route and switches to the one picked', async ({ swap, api }) => {
    const across = xchainQuote()
    const other = xchainQuote({ provider: 'relay', outputAmount: '99000000', etaSec: 120 })
    serveQuote(api, across, { candidates: [other] })
    await swap.goto()
    await swap.quote('USDC', { symbol: 'USDC', chain: 'Arbitrum Sepolia' }, '100')

    await swap.openDetails()
    const best = swap.page.getByTestId('xswap-route-across')
    const relay = swap.page.getByTestId('xswap-route-relay')
    await expect(best).toContainText('Best')
    await expect(best).toHaveAttribute('aria-pressed', 'true')

    await relay.click()
    await expect(relay).toHaveAttribute('aria-pressed', 'true')
    await expect(swap.output.locator('.token-amount-input')).toHaveValue('99.0')
  })

  test('shows the X-Gate lock and its LayerZero fee, and sends the fee with the deposit', async ({
    swap,
    api,
    chain,
  }) => {
    const quote = jocEthStableQuote()
    serveQuote(api, quote)
    await swap.goto()
    await swap.quote('USDT', { symbol: 'USDTX', chain: 'JOC Testnet' }, '10')

    const details = await swap.openDetails()
    await expect(details).toContainText('0.0025 ETH')
    const [leg] = await swap.page.getByTestId('xswap-route-legs').getByRole('listitem').all()
    await expect(leg).toContainText('USDT → USDTX')
    await expect(leg).toContainText('Sepolia → JOC Testnet via X-Gate · out 10 USDTX')
    await expect(leg).toContainText('LayerZero fee 0.0025 ETH')

    await swap.execute()
    await expect(swap.tracker).toBeVisible()
    expect(chain.sent('deposit')[0].value).toBe(2_500_000_000_000_000n)
  })

  test('blocks the swap without enough native token for the bridge fee', async ({ swap, api, chain }) => {
    chain.setBalance(SEPOLIA, NATIVE, 0n)
    serveQuote(api, jocEthStableQuote())
    await swap.goto()
    await swap.quote('USDT', { symbol: 'USDTX', chain: 'JOC Testnet' }, '10')

    await expect(swap.executeButton).toHaveText('Insufficient ETH for the bridge fee')
    await expect(swap.executeButton).toBeDisabled()
  })
})
