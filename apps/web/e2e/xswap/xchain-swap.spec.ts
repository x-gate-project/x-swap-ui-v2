import {
  ACCOUNT,
  ARB_SEPOLIA,
  SEPOLIA,
  SPOKE_POOL,
  USDC_ARB,
  USDC_SEPOLIA,
  xchainPermitQuote,
  xchainQuote,
} from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'
import { ApiError } from '../support/xswapApi'

const USDC_TO_ARB = { symbol: 'USDC', chain: 'Arbitrum Sepolia' }

test.describe('cross-chain swap', () => {
  test('quotes the pair, approves, deposits and registers the order', async ({ swap, api, chain }) => {
    const quote = xchainQuote()
    serveQuote(api, quote)
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')

    await expect(swap.output.locator('.token-amount-input')).toHaveValue('99.5')
    expect(api.calls('POST /quote').at(-1)?.body).toMatchObject({
      tokenIn: USDC_SEPOLIA,
      tokenInChainId: SEPOLIA,
      tokenOut: USDC_ARB,
      tokenOutChainId: ARB_SEPOLIA,
      amount: '100000000',
      swapper: ACCOUNT,
    })

    await swap.execute()
    await expect(swap.tracker).toBeVisible()

    const [approve, deposit] = chain.sent()
    expect(approve).toMatchObject({ kind: 'approve', to: USDC_SEPOLIA, chainId: SEPOLIA })
    expect(deposit).toMatchObject({ kind: 'deposit', to: SPOKE_POOL, chainId: SEPOLIA })
    expect(api.calls('POST /orders').map((r) => r.body)).toEqual([{ quoteId: quote.quoteId, txHash: deposit.hash }])
  })

  test('waits for the approval to be mined before the deposit', async ({ swap, api, chain }) => {
    serveQuote(api, xchainQuote())
    chain.hold('approve')
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    const approve = await chain.waitForSend('approve')
    await expect(swap.step(0)).toContainText('Approve the input amount')
    await expect(swap.step(1)).toContainText('Send the order')
    // The app asks for the receipt and gets none while the approval is pending. viem polls it again only on a new block,
    // and none is mined while the approval is held, so the first ask may come before or after the send resolves here.
    await expect.poll(() => chain.calls('eth_getTransactionReceipt')).toBeGreaterThan(0)
    expect(chain.sent('deposit')).toHaveLength(0)
    await expect(swap.executeButton).toHaveText('Confirm in your wallet…')

    chain.mine(approve.hash)
    await swap.expectTrackerAfterMined()
    expect(chain.sent('deposit')).toHaveLength(1)
  })

  test('signs a Permit2 allowance instead of sending permit2-approve', async ({ swap, api, chain }) => {
    const quote = xchainPermitQuote()
    serveQuote(api, quote)
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()
    await expect(swap.tracker).toBeVisible()

    expect(chain.sent().map((tx) => tx.kind)).toEqual(['approve', 'deposit'])
    expect(chain.signatures).toHaveLength(1)
    const [, typedData] = chain.signatures[0].params as [string, string]
    expect(JSON.parse(typedData)).toMatchObject({
      primaryType: 'PermitSingle',
      domain: { name: 'Permit2', chainId: SEPOLIA },
    })
    expect(JSON.parse(typedData).message.spender.toLowerCase()).toBe(SPOKE_POOL.toLowerCase())
    expect(api.calls(`POST /quote/${quote.quoteId}/permit`)).toHaveLength(1)
    // The order is registered with the quote the signature produced.
    expect(api.calls('POST /orders')[0].body).toMatchObject({ quoteId: `${quote.quoteId}-signed` })
  })

  test('retries the order registration until the API sees the deposit', async ({ swap, api, chain }) => {
    const quote = xchainQuote()
    serveQuote(api, quote, {
      registerError: (attempt) => (attempt === 0 ? new ApiError(404, 'tx_not_found') : undefined),
    })
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    await expect(swap.page.getByText('Transaction confirmed, registering the order…')).toBeVisible()
    await expect(swap.tracker).toBeVisible()
    const [deposit] = chain.sent('deposit')
    expect(api.calls('POST /orders').map((r) => r.body)).toEqual([
      { quoteId: quote.quoteId, txHash: deposit.hash },
      { quoteId: quote.quoteId, txHash: deposit.hash },
    ])
  })

  test('shows the deposit tx when the order cannot be registered', async ({ swap, api, chain }) => {
    // A definite answer: not retried.
    serveQuote(api, xchainQuote(), { registerError: () => new ApiError(409, 'tx_sender_mismatch') })
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.execute()

    await expect(swap.executeError).toContainText('Your deposit went through, but tracking the order failed')
    const [deposit] = chain.sent('deposit')
    await expect(swap.executeError.getByRole('link')).toHaveAttribute('href', new RegExp(deposit.hash))
    expect(api.calls('POST /orders')).toHaveLength(1)
    await expect(swap.tracker).toBeHidden()
  })
})
