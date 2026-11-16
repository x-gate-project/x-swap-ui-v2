import { ACCOUNT, ARB_SEPOLIA, xchainQuote } from '../support/fixtures'
import { serveQuote } from '../support/scenario'
import { expect, test } from '../support/test'

const USDC_TO_ARB = { symbol: 'USDC', chain: 'Arbitrum Sepolia' }
// Checksummed (EIP-55): the field refuses a mixed-case address with a wrong checksum.
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

test.describe('send to another address', () => {
  test('quotes, sends and tracks an order paying the recipient', async ({ swap, api, chain }) => {
    const quote = xchainQuote({ recipient: RECIPIENT })
    serveQuote(api, quote)
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.setRecipient(RECIPIENT)

    await expect
      .poll(() => api.calls('POST /quote').at(-1)?.body)
      .toMatchObject({ swapper: ACCOUNT, recipient: RECIPIENT })
    // The recipient never sent a tx and holds nothing on the destination chain.
    await expect(swap.page.getByTestId('xswap-recipient-warning-unused')).toContainText('Arbitrum Sepolia')
    const details = await swap.openDetails()
    await expect(details.getByTestId('xswap-route-recipient')).toContainText('0x7099…79C8')

    await swap.execute()
    await expect(swap.tracker).toBeVisible()
    await expect(swap.tracker.getByTestId('xswap-order-recipient')).toContainText('0x7099…79C8')
    expect(chain.sent().map((tx) => tx.kind)).toEqual(['approve', 'deposit'])
  })

  test('warns about a contract recipient on the destination chain', async ({ swap, api, chain }) => {
    chain.setCode(ARB_SEPOLIA, RECIPIENT, '0x6080604052')
    serveQuote(api, xchainQuote({ recipient: RECIPIENT }))
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.setRecipient(RECIPIENT)

    await expect(swap.page.getByTestId('xswap-recipient-warning-contract')).toContainText(
      'This address is a contract on Arbitrum Sepolia',
    )
  })

  test('blocks the swap on an invalid address and quotes for the wallet', async ({ swap, api }) => {
    serveQuote(api, xchainQuote())
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    // A wrong EIP-55 checksum: one letter's case flipped.
    await swap.setRecipient(RECIPIENT.replace('C51812dc', 'c51812dc'))

    await expect(swap.page.getByTestId('xswap-recipient-error')).toBeVisible()
    await expect(swap.executeButton).toHaveText('Enter a valid recipient address')
    await expect(swap.executeButton).toBeDisabled()
    expect(api.calls('POST /quote').every((call) => !(call.body as { recipient?: string }).recipient)).toBe(true)
  })

  test('sends nothing when the quote pays another address', async ({ swap, api, chain }) => {
    // The API answers for the swapper although the user asked for a recipient.
    serveQuote(api, xchainQuote({ recipient: ACCOUNT }))
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.setRecipient(RECIPIENT)
    await expect.poll(() => api.calls('POST /quote').at(-1)?.body).toMatchObject({ recipient: RECIPIENT })
    await swap.execute()

    await expect(swap.executeError).toContainText('This route returned transactions that cannot be sent safely')
    expect(chain.sent()).toHaveLength(0)
  })

  test('closing the field sends to the wallet again', async ({ swap, api }) => {
    serveQuote(api, xchainQuote())
    await swap.goto()
    await swap.quote('USDC', USDC_TO_ARB, '100')
    await swap.setRecipient(RECIPIENT)
    await expect.poll(() => api.calls('POST /quote').at(-1)?.body).toMatchObject({ recipient: RECIPIENT })

    await swap.page.getByTestId('xswap-recipient-remove').click()
    await expect(swap.recipientInput).toBeHidden()
    await expect
      .poll(() => (api.calls('POST /quote').at(-1)?.body as { recipient?: string } | undefined)?.recipient)
      .toBeUndefined()
  })
})
