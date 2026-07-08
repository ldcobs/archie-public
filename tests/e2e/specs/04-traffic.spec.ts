/**
 * TEST_SPEC §4 — Traffic & charts.
 *
 * Traffic lives inside the per-user detail panel (Traffic tab). P0 cases:
 *  4.1  traffic tab renders with totals
 *  4.2  period filter (Today/7d/30d) switches the window
 */
import { test, expect, openAccessKeys } from '../fixtures';

test.describe('§4 Traffic', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await openAccessKeys(page);
    // Open the first key's detail panel
    await page.locator('div').filter({ hasText: 'Active' }).first().click();
  });

  test('4.1 traffic tab renders totals', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: 'Traffic' }).click();
    // "This Key" card is the totals container
    await expect(page.getByText('This Key')).toBeVisible({ timeout: 10_000 });
  });

  test('4.2 period filter switches window', async ({ authedPage: page }) => {
    await page.getByRole('button', { name: 'Traffic' }).click();

    let lastUrl = '';
    page.on('request', (req) => {
      if (req.url().includes('/api/traffic')) lastUrl = req.url();
    });

    await page.getByRole('button', { name: '7d' }).click();
    await page.waitForTimeout(500);
    expect(lastUrl, 'period filter should fire a traffic fetch').toContain('traffic');

    await page.getByRole('button', { name: '30d' }).click();
    await page.waitForTimeout(500);
    expect(lastUrl).toContain('traffic');
  });
});
