/**
 * Shared fixtures and helpers for the Archie acceptance suite.
 *
 * TEST_SPEC mapping:
 *  - authedTest: an already-authenticated page (for §2, §4, §5...)
 *  - freshPage: a logged-out browser (for §1 auth tests)
 *
 * Auth: the suite logs in via the real UI once per test file (slow but
 * realistic). If AUTH_USERNAME/AUTH_PASSWORD env vars are set they're used;
 * otherwise it assumes first-run setup is NOT required and uses admin/changeme.
 */
import { test as base, expect, type Page } from '@playwright/test';

export const AUTH_USER = process.env.AUTH_USERNAME ?? 'admin';
export const AUTH_PASS = process.env.AUTH_PASSWORD ?? 'changeme';

// All dashboard routes live under the /v3 basePath (next.config.ts).
const BASE = '/v3';

/** Log in through the real /login form. Assumes setup already completed. */
export async function login(page: Page) {
  await page.goto(`${BASE}/login`);
  // The login inputs have no associated label or aria-label — labels are plain
  // <div> text. Username is the first text input, password is type=password.
  await page.locator('input').first().fill(AUTH_USER);
  await page.locator('input[type="password"]').first().fill(AUTH_PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for redirect to dashboard root
  await page.waitForURL(/\/v3\/?$/, { timeout: 15_000 });
}

/** Accept the native confirm() dialog that disable/rotate/delete trigger. */
export function autoAcceptDialogs(page: Page) {
  page.on('dialog', (d) => d.accept());
}

/** Navigate to a sidebar section by its English label. */
export async function goTo(page: Page, navLabel: string) {
  await page.getByRole('link', { name: navLabel }).click();
}

/** Open the Access Keys page. */
export async function openAccessKeys(page: Page) {
  await goTo(page, 'Access Keys');
  await expect(page.getByRole('heading', { name: 'ACCESS KEYS', level: 1 })).toBeVisible();
}

/**
 * Test fixture variants.
 * `authed` hands you a logged-in page; `fresh` is logged out.
 */
export const test = base.extend<{ authedPage: Page; freshPage: Page }>({
  authedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
  freshPage: async ({ page }, use) => {
    // Ensure logged out: clear cookies by visiting login
    await page.goto(`${BASE}/login`);
    await use(page);
  },
});

export { expect };
