import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Archie dashboard acceptance tests.
 *
 * baseURL is http://localhost:4321/v3 (dev server, port 4321, basePath /v3).
 * The suite does NOT start the dev server — run it yourself first:
 *   cd dashboard && npm run dev
 * or point PLAYWRIGHT_BASE_URL at an already-running instance.
 *
 * Reports: tests/e2e/playwright-report/index.html
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4321';

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // shared dev-server state; run serially
  retries: 0,
  workers: 1,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // No webServer block — we never start the app from the test runner, to avoid
  // colliding with an in-progress dev session.
});
