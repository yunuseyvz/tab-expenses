import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against a real server, real Postgres, and Mailpit. `pnpm serve`
 * (scripts/dev-serve.sh) picks a free port and records it; these tests read
 * that so they never collide with anything else on the machine.
 */
const PORT = process.env.SWL_PORT ?? process.env.PORT ?? '3000'
const BASE_URL = process.env.SWL_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // One authenticated session, shared. Better Auth rate-limits the OTP
  // endpoints to 3 requests per 60s, so signing in per test would fight the
  // protection rather than disable it.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    storageState: 'test-results/auth.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      // The entry point for this app is a phone at a checkout.
      use: { ...devices['Pixel 7'] },
    },
  ],
})
