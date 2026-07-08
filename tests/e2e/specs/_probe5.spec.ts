import { test, expect } from '@playwright/test';
import { login } from '../fixtures';
test('click roberto row, snapshot panel', async ({ page }) => {
  await login(page);
  await page.goto('/v3/vpn-users');
  await page.waitForTimeout(2500);
  // Find the clickable row - roberto display name. Try the row container.
  const rows = await page.locator('div').filter({ hasText: 'roberto' }).count();
  console.log('roberto matches:', rows);
  await page.getByText('roberto', { exact: false }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'roberto-panel.png' });
  const btns = await page.getByRole('button').allTextContents();
  const tabs = await page.getByRole('tab').allTextContents();
  console.log('PANEL BTNS:', JSON.stringify(btns.filter(b=>b.trim()).slice(-15)));
  console.log('TABS:', JSON.stringify(tabs));
});
