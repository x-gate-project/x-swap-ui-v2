import { ARB_SEPOLIA, SEPOLIA, TOKENS, USDC_SEPOLIA } from '../support/fixtures'
import { expect, test } from '../support/test'

test.describe('token and chain selection', () => {
  test('lists the API tokens of the wallet chain and filters them by search', async ({ swap, api }) => {
    await swap.goto()
    await swap.input.locator('.open-currency-select-button').click()

    await expect(swap.tokenRow('USDC')).toBeVisible()
    await expect(swap.tokenRow('USDT')).toBeVisible()
    expect(api.calls('GET /tokens').map((r) => r.query.get('chainId'))).toContain(String(SEPOLIA))

    await swap.page.getByTestId('token-search-input').fill('USDT')
    await expect(swap.tokenRow('USDT')).toBeVisible()
    await expect(swap.tokenRow('USDC')).toBeHidden()
  })

  test('offers the API chains as output chains and lists their tokens', async ({ swap }) => {
    await swap.goto()
    await swap.selectToken('input', 'USDC')
    await swap.output.locator('.open-currency-select-button').click()

    for (const name of ['Sepolia', 'Arbitrum Sepolia', 'JOC Testnet']) {
      await expect(swap.chainChip(name)).toBeVisible()
    }
    await swap.chainChip('JOC Testnet').click()
    await expect(swap.chainChip('JOC Testnet')).toHaveAttribute('aria-checked', 'true')
    await expect(swap.tokenRow('USDTX')).toBeVisible()
    await expect(swap.tokenRow('USDCX')).toBeVisible()
  })

  test('hides destinations the input token cannot reach', async ({ swap, api }) => {
    // From USDC on Sepolia only USDC on Arbitrum Sepolia is reachable.
    api.set({
      routes: (chainId, tokenIn) => ({
        tokenIn: { chainId, address: tokenIn },
        destinations:
          tokenIn.toLowerCase() === USDC_SEPOLIA.toLowerCase()
            ? [{ chainId: ARB_SEPOLIA, address: TOKENS.usdcArb.address, routeClass: 'evm-native', executable: true }]
            : [],
      }),
    })
    await swap.goto()
    await swap.selectToken('input', 'USDC')
    await swap.output.locator('.open-currency-select-button').click()
    await swap.chainChip('Arbitrum Sepolia').click()

    await expect(swap.tokenRow('USDC')).toBeVisible()
    await expect(swap.tokenRow('JOCX')).toBeHidden()
  })
})
