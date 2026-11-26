import { Page, expect, test } from '@playwright/test'

import { SwapPage } from '../e2e/support/swapPage'
import { liveWallet } from './liveWallet'

type LiveRoute = {
  name: string
  startChainId: number
  input: { symbol: string; chain?: string }
  output: { symbol: string; chain: string }
  amount: string
  /** The bridge leg's text, e.g. `Sepolia → Arbitrum Sepolia via Stargate`. */
  bridgeLeg: string
}

/**
 * Quotes `route` on the deployed UI, picks the Stargate route when the details list several, executes it with the live
 * wallet and waits for the order to end. Returns the final badge and the tracker text; logs the wallet and api calls.
 */
export async function runStargateRoute(page: Page, route: LiveRoute) {
  const wallet = liveWallet(route.startChainId)
  await wallet.install(page)
  const apiLog: string[] = []
  page.on('response', async (r) => {
    const url = r.url()
    if (!url.includes('/api/xswap/v1/')) {
      return
    }
    const path = url.slice(url.indexOf('/api/xswap/v1/') + 13)
    const method = r.request().method()
    if (method === 'POST' && path.startsWith('/orders')) {
      const o = (await r.json().catch(() => null)) as { id?: string; provider?: string; status?: string } | null
      apiLog.push(`POST ${path} ${r.status()} id=${o?.id} provider=${o?.provider} status=${o?.status}`)
    } else if (method === 'POST' && path.startsWith('/quote')) {
      const body = (await r.json().catch(() => null)) as {
        best?: { provider: string; shape?: string }
        candidates?: { provider: string }[]
        code?: string
      } | null
      apiLog.push(
        `POST ${path} ${r.status()} best=${body?.best?.provider}:${body?.best?.shape} candidates=${body?.candidates
          ?.map((c) => c.provider)
          .join(',')}${body?.code ? ` code=${body.code}` : ''}`,
      )
    }
  })

  const swap = new SwapPage(page)
  const shot = (step: string) =>
    page.screenshot({ path: test.info().outputPath(`${route.name}-${step}.png`), fullPage: true })
  try {
    await swap.goto()
    await swap.selectToken('input', route.input.symbol, route.input.chain)
    await swap.selectToken('output', route.output.symbol, route.output.chain)
    await swap.typeAmount(route.amount)

    await swap.openDetails()
    // The route list shows only when the api returns more than one route.
    const choice = page.getByTestId('xswap-route-stargate')
    if (await choice.isVisible().catch(() => false)) {
      await choice.click()
      await expect(choice).toHaveAttribute('aria-pressed', 'true')
    }
    const bridge = page.getByTestId('xswap-route-leg-bridge')
    await expect(bridge).toContainText(route.bridgeLeg)
    await expect(bridge).toContainText('LayerZero fee')
    await shot('1-route')

    // A refresh that fails after an approval (testnet dex timeouts answer 410) drops the panel back to the quote; the
    // user clicks again, and with the allowance on chain the second try goes straight to the deposit.
    for (let attempt = 1; ; attempt++) {
      await swap.execute()
      const shown = await swap.tracker
        .waitFor({ state: 'visible', timeout: 180_000 })
        .then(() => true)
        .catch(() => false)
      if (shown) {
        break
      }
      wallet.log.push(`attempt ${attempt}: no tracker after 180 s`)
      if (attempt === 3) {
        throw new Error('no order after 3 attempts')
      }
      await swap.openDetails().catch(() => undefined)
      const choice = page.getByTestId('xswap-route-stargate')
      if (await choice.isVisible().catch(() => false)) {
        await choice.click()
      }
    }
    await expect(swap.tracker).toContainText('Stargate')
    await shot('2-submitted')

    // The timeline always lists "Completed" as a step; the order is terminal once "Updating…" is gone.
    await expect(swap.tracker).not.toContainText('Updating…', { timeout: 15 * 60_000 })
    const header = swap.tracker.getByText('Order', { exact: true }).locator('..')
    return {
      badge: (await header.innerText()).replace(/^Order\s*/, '').trim(),
      tracker: (await swap.tracker.innerText()).replace(/\s+/g, ' '),
    }
  } finally {
    await shot('3-final').catch(() => undefined)
    const tracker = (await swap.tracker.innerText().catch(() => '')).replace(/\s+/g, ' ')
    const summary = [`== ${route.name}`, ...wallet.log, ...apiLog, `tracker: ${tracker}`].join('\n')
    await test.info().attach('live-log', { body: summary, contentType: 'text/plain' })
    // eslint-disable-next-line no-console -- the tx hashes and order ids are what a live run reports
    console.log(summary)
  }
}
