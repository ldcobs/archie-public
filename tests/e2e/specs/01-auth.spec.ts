/**
 * TEST_SPEC §1 — Auth & first-run setup.
 *
 * P0 cases:
 *  1.1  Logged-out visit redirects to /login
 *  1.4  Wrong password is rejected, no session
 *  1.2  Valid login succeeds, dashboard visible (smoke — full flow lives in fixtures)
 *  1.3  Logout clears session
 */
import { test, expect, login, AUTH_USER, AUTH_PASS } from '../fixtures';

const BASE = '/v3';

test.describe('§1 Auth', () => {
  test('1.1 unauthenticated visit redirects to /login', async ({ freshPage: page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/v3\/login$/);
  });

  test('1.4 wrong password rejected, no session', async ({ freshPage: page }) => {
    await page.goto(`${BASE}/login`);
    // Inputs have no associated labels — Username is the first input,
    // password is type=password (see fixtures.ts note).
    await page.locator('input').first().fill(AUTH_USER);
    await page.locator('input[type="password"]').first().fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid username or password')).toBeVisible();
    // Still on login page
    await expect(page).toHaveURL(/\/v3\/login$/);
  });

  test('1.2 valid login reaches dashboard', async ({ freshPage: page }) => {
    await login(page);
    // Dashboard root renders at least one nav item
    await expect(page.getByRole('link', { name: 'Access Keys' })).toBeVisible();
  });

  test('1.3 logout clears session', async ({ authedPage: page }) => {
    await page.getByTitle('Sign out').click();
    await expect(page).toHaveURL(/\/v3\/login$/);
    // Protected page now bounces back to login
    await page.goto(`${BASE}/vpn-users`);
    await expect(page).toHaveURL(/\/v3\/login$/);
  });
});
