import { Locator, Page, expect } from '@playwright/test'

/** Drives the swap form at `/swap`. */
export class SwapPage {
  readonly input: Locator
  readonly output: Locator
  readonly executeButton: Locator
  readonly steps: Locator
  readonly executeError: Locator
  readonly quoteError: Locator
  readonly details: Locator
  readonly tracker: Locator

  constructor(readonly page: Page) {
    this.input = page.locator('#swap-currency-input')
    this.output = page.locator('#swap-currency-output')
    this.executeButton = page.getByTestId('xswap-execute-button')
    this.steps = page.getByTestId('xswap-execute-steps')
    this.executeError = page.getByTestId('xswap-execute-error')
    this.quoteError = page.getByTestId('xswap-quote-error')
    this.details = page.getByTestId('xswap-details')
    this.tracker = page.getByTestId('xswap-order-tracker')
  }

  /** Opens the swap page connected to the mock wallet. */
  async goto(query = '') {
    await this.page.goto(`/swap${query}`)
    await expect(this.page.getByTestId('web3-status-connected')).toBeVisible()
  }

  /** Picks `symbol` in a panel's token modal; `chainName` picks the chain in the x-swap chain picker first. */
  async selectToken(panel: 'input' | 'output', symbol: string, chainName?: string) {
    await (panel === 'input' ? this.input : this.output).locator('.open-currency-select-button').click()
    if (chainName) {
      await this.chainChip(chainName).click()
    }
    await this.page.getByTestId('token-search-input').fill(symbol)
    await this.tokenRow(symbol).click()
  }

  /** A chain of the token modal's x-swap chain picker, by its API name (the chip's label also holds the logo's alt). */
  chainChip(name: string): Locator {
    return this.page
      .getByTestId('xswap-chain-picker')
      .getByRole('radio')
      .filter({ hasText: new RegExp(`^${name}$`) })
  }

  /** A row of the open token modal's list. */
  tokenRow(symbol: string): Locator {
    return this.page
      .locator('[class*="token-item-"]')
      .filter({ has: this.page.getByText(symbol, { exact: true }) })
      .first()
  }

  /** Types key by key: `fill()` sets the value without the input events NumericalInput listens to. */
  async typeAmount(amount: string) {
    const field = this.input.locator('.token-amount-input')
    await field.click()
    await field.pressSequentially(amount)
  }

  /** Selects the pair and amount, then waits for the execute button. */
  async quote(input: string, output: { symbol: string; chain?: string }, amount: string) {
    await this.selectToken('input', input)
    await this.selectToken('output', output.symbol, output.chain)
    await this.typeAmount(amount)
  }

  /** Expands the route details once a quote is back (the header ignores clicks until then). */
  async openDetails(): Promise<Locator> {
    const header = this.page.getByTestId('xswap-details-header-row')
    await expect(header).toContainText(' = ')
    await header.click()
    const details = this.page.getByTestId('xswap-advanced-details')
    await expect(details).toBeVisible()
    return details
  }

  async execute() {
    await expect(this.executeButton).toBeEnabled()
    await this.executeButton.click()
  }

  /**
   * Waits for the order tracker after a held receipt was mined: the app polls receipts on wagmi's 12 s interval, so the
   * next poll may be that far off.
   */
  async expectTrackerAfterMined() {
    await expect(this.tracker).toBeVisible({ timeout: 30_000 })
  }

  step(index: number): Locator {
    return this.steps.locator('li').nth(index)
  }
}
