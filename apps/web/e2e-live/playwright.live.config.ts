import { defineConfig, devices } from '@playwright/test'

/** Live smoke runs against a deployed UI, the testnet x-swap API and a funded wallet: no stubs, no dev server (README.md). */
export default defineConfig({
  testDir: '.',
  testMatch: '*.live.spec.ts',
  retries: 0,
  workers: 1,
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: process.env.LIVE_OUT_DIR ?? '.results',
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? 'http://35.239.192.88:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 1400 } } }],
})
