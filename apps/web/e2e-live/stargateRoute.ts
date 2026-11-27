import { Page, expect, test } from '@playwright/test'

import { SwapPage } from '../e2e/support/swapPage'
import { liveWallet } from './liveWallet'

/** Each test's budget, from loading the page to a terminal order: an order still running after it is a failure. */
const LIVE_BUDGET_MS = 5 * 60_000
/** Kept at the end of the budget for the final screenshot and the log. */
const WRAP_UP_MS = 20_000

/**
 * A token of the swap form. `address` picks an ERC-20 by address: Sepolia lists two USDC (Circle's and Stargate's test
 * token) and two USDT, Arbitrum Sepolia two USDC, under one symbol.
 */
type Side = { symbol: string; address?: string; chain?: string }

type LiveRoute = {
  name: string
  startChainId: number
  /** `chain` switches the wallet to the input chain with the token modal's network selector. */
  input: Side
  output: Side & { chain: string }
  amount: string
  /** The bridge leg's text, e.g. `Sepolia → Arbitrum Sepolia via Stargate`. */
  bridgeLeg: string
  /** Pays this address instead of the wallet ("Send to a different address"). */
  recipient?: string
  /** Turns on "Show testnets" in the account drawer first: the network selector lists testnets only then. */
  showTestnets?: boolean
}

async function showTestnets(page: Page) {
  await page.getByTestId('web3-status-connected').click()
  await page.getByTestId('wallet-settings').click()
  const toggle = page.getByTestId('testnets-toggle')
  if ((await toggle.getAttribute('aria-selected')) !== 'true') {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
}

async function pickToken(page: Page, swap: SwapPage, panel: 'input' | 'output', side: Side) {
  await (panel === 'input' ? swap.input : swap.output).locator('.open-currency-select-button').click()
  if (side.chain && panel === 'output') {
    await swap.chainChip(side.chain).click()
  } else if (side.chain) {
    // The input side lists the wallet chain's tokens. The modal's network selector comes after the navbar's.
    await page.getByRole('button', { name: 'chain-selector' }).last().click()
    await page.getByTestId(`${side.chain}-selector`).first().click()
  }
  await page.getByTestId('token-search-input').fill(side.symbol)
  const row = side.address
    ? page.locator(`[class*="token-item-"][class*="${side.address}" i]`).first()
    : swap.tokenRow(side.symbol)
  await row.click()
}

/** Picks the Stargate route; the route list shows only when the api returns more than one route. */
async function pickStargate(page: Page) {
  const choice = page.getByTestId('xswap-route-stargate')
  if (await choice.isVisible().catch(() => false)) {
    await choice.click()
    await expect(choice).toHaveAttribute('aria-pressed', 'true')
  }
}

/**
 * Quotes `route` on the UI, picks the Stargate route, executes it with the live wallet and expects the order to end
 * `Completed` within `LIVE_BUDGET_MS`. Logs the wallet's txs, the quote and order calls, and the tracker's text.
 * With `LIVE_QUOTE_ONLY` set it stops once the route is checked, and sends nothing.
 */
export async function runStargateRoute(page: Page, route: LiveRoute) {
  test.setTimeout(LIVE_BUDGET_MS)
  const started = Date.now()
  const left = () => Math.max(1_000, started + LIVE_BUDGET_MS - WRAP_UP_MS - Date.now())
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
      const req = r.request().postData() ?? ''
      const body = (await r.json().catch(() => null)) as {
        best?: { provider: string; shape?: string; recipient?: string }
        candidates?: { provider: string }[]
        code?: string
      } | null
      apiLog.push(
        `POST ${path} ${r.status()} req=${req} best=${body?.best?.provider}:${body?.best?.shape} recipient=${
          body?.best?.recipient
        } candidates=${body?.candidates?.map((c) => c.provider).join(',')}${body?.code ? ` code=${body.code}` : ''}`,
      )
    }
  })

  const swap = new SwapPage(page)
  const shot = (step: string) =>
    page.screenshot({ path: test.info().outputPath(`${route.name}-${step}.png`), fullPage: true })
  try {
    await swap.goto()
    if (route.showTestnets) {
      await showTestnets(page)
    }
    await pickToken(page, swap, 'input', route.input)
    await pickToken(page, swap, 'output', route.output)
    if (route.recipient) {
      await swap.setRecipient(route.recipient)
    }
    await swap.typeAmount(route.amount)

    await swap.openDetails()
    await pickStargate(page)
    const bridge = page.getByTestId('xswap-route-leg-bridge')
    await expect(bridge).toContainText(route.bridgeLeg)
    await expect(bridge).toContainText('LayerZero fee')
    await shot('1-route')
    if (process.env.LIVE_QUOTE_ONLY) {
      await expect(swap.executeButton).toBeEnabled()
      test.info().annotations.push({ type: 'quote-only', description: 'LIVE_QUOTE_ONLY: not executed' })
      return
    }

    // A refresh that fails after an approval (testnet dex timeouts answer 410) drops the panel back to the quote; the
    // user clicks again, and with the allowance on chain the second try goes straight to the deposit.
    for (let attempt = 1; ; attempt++) {
      await swap.execute()
      const shown = await swap.tracker
        .waitFor({ state: 'visible', timeout: Math.min(180_000, left()) })
        .then(() => true)
        .catch(() => false)
      if (shown) {
        break
      }
      wallet.log.push(`attempt ${attempt}: no order yet`)
      if (attempt === 3 || left() <= 1_000) {
        throw new Error(`no order after ${attempt} attempts`)
      }
      await swap.openDetails().catch(() => undefined)
      await pickStargate(page).catch(() => undefined)
    }
    await expect(swap.tracker).toContainText('Stargate')
    await shot('2-submitted')

    // The timeline always lists "Completed" as a step; the order is terminal once "Updating…" is gone.
    await expect(swap.tracker, 'the order is not terminal within the 5-min budget').not.toContainText('Updating…', {
      timeout: left(),
    })
    const header = swap.tracker.getByText('Order', { exact: true }).locator('..')
    const badge = (await header.innerText()).replace(/^Order\s*/, '').trim()
    expect(badge).toBe('Completed')
  } finally {
    await shot('3-final').catch(() => undefined)
    // A short timeout: without an order there is no tracker to wait for.
    const tracker = (await swap.tracker.innerText({ timeout: 1_000 }).catch(() => '')).replace(/\s+/g, ' ')
    const elapsed = Math.round((Date.now() - started) / 1000)
    const summary = [`== ${route.name} (${elapsed} s)`, ...wallet.log, ...apiLog, `tracker: ${tracker}`].join('\n')
    await test.info().attach('live-log', { body: summary, contentType: 'text/plain' })
    // eslint-disable-next-line no-console -- the tx hashes and order ids are what a live run reports
    console.log(summary)
  }
}
