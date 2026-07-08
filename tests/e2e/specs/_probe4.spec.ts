import { test } from '@playwright/test';
import { login } from '../fixtures';
test('snapshot new-key panel + a row click', async ({ page }) => {
  await login(page);
  await page.goto('/v3/vpn-users');
  await page.waitForTimeout(2000);
  // open new key panel
  await page.getByRole('button', { name: '+ New Access Key' }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'newkey-panel.png' });
  const btns = await page.getByRole('button').allTextContents();
  const inputs = await page.locator('input').evaluateAll(els => els.map(e => ({type:e.getAttribute('type'), placeholder:e.getAttribute('placeholder')})));
  console.log('PANEL BUTTONS:', JSON.stringify(btns.filter(b=>b.trim())));
  console.log('PANEL INPUTS:', JSON.stringify(inputs));
  // close panel, click a row
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.getByText('roberto').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'row-panel.png' });
  const panelBtns = await page.getByRole('button').allTextContents();
  const panelHeads = await page.getByRole('heading').allTextContents();
  console.log('ROW PANEL BUTTONS:', JSON.stringify(panelBtns.filter(b=>b.trim())));
  console.log('ROW PANEL HEADINGS:', JSON.stringify(panelHeads));
});
