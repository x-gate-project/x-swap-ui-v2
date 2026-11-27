import { ALL_TOKENS, ARB_SEPOLIA, SEPOLIA, TOKENS, USDC_SEPOLIA } from '../support/fixtures'
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

  test('names a token by its API name and keeps the symbol when the API sends none', async ({ swap, api }) => {
    // Sepolia lists two USDC: Circle's (no name here) and Stargate's test token.
    const sgUsdc = { ...TOKENS.usdcSepolia, address: '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590', name: 'Stargate USDC' }
    api.set({ tokens: [...ALL_TOKENS, sgUsdc] })
    await swap.goto()
    await swap.input.locator('.open-currency-select-button').click()

    const row = (address: string) => swap.page.locator(`[class*="token-item-"][class*="${address}" i]`)
    // The name line, then the symbol line.
    await expect(row(sgUsdc.address)).toContainText(/Stargate USDC\s*USDC/)
    await expect(row(USDC_SEPOLIA)).toContainText(/USDC\s*USDC/)
    await expect(row(USDC_SEPOLIA)).not.toContainText('Stargate')

    await swap.page.getByTestId('token-search-input').fill('stargate')
    await expect(row(sgUsdc.address)).toBeVisible()
    await expect(row(USDC_SEPOLIA)).toBeHidden()
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
