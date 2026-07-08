import { test } from '@playwright/test';
import { login } from '../fixtures';
test('snapshot access keys page', async ({ page }) => {
  await login(page);
  await page.goto('/v3/vpn-users');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'ak-page.png', fullPage: true });
  // dump all buttons + links + headings text
  const btns = await page.getByRole('button').allTextContents();
  const links = await page.getByRole('link').allTextContents();
  const heads = await page.getByRole('heading').allTextContents();
  console.log('HEADINGS:', JSON.stringify(heads));
  console.log('BUTTONS:', JSON.stringify(btns.filter(b=>b.trim())));
  console.log('LINKS:', JSON.stringify(links.filter(l=>l.trim())));
});
