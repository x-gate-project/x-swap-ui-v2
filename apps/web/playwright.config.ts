import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)

/**
 * x-swap e2e suite (e2e/README.md): the dev server serves the app with the x-swap API on `/api/xswap/v1`, and every
 * test stubs that API, the chain RPCs and the wallet, so nothing reaches the network.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // The CRA dev server compiles on first load; later loads are fast.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  outputDir: 'e2e/.results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Tall enough for the expanded x-swap details (route list, legs) without scrolling inside the animated dropdown.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1400 } } }],
  webServer: {
    command: 'yarn start',
    url: `http://localhost:${PORT}/swap`,
    // Locally a running server is reused (start it with the env below, see e2e/README.md); CI always starts its own so a
    // server without the x-swap env can never be picked up.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      PORT: String(PORT),
      BROWSER: 'none',
      REACT_APP_XSWAP_API_URL: '/api/xswap/v1',
      // The CSP meta would block the stubbed RPC hosts; the stubs answer before any request leaves anyway.
      REACT_APP_SKIP_CSP: '1',
      // Skips craco's dev-time ESLint and type-check plugins.
      CI: 'true',
    },
  },
})
