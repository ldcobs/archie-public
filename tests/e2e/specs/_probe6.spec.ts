import { test } from '@playwright/test';
import { login } from '../fixtures';
test('find row structure', async ({ page }) => {
  await login(page);
  await page.goto('/v3/vpn-users');
  await page.waitForTimeout(2500);
  // Dump the grid: find clickable elements
  const clickable = await page.locator('[role="button"], [role="gridcell"], [role="row"], [onclick], a').all();
  console.log('semantic clickables:', clickable.length);
  // What does the key list container look like? Find divs with cursor pointer
  const pointers = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div'));
    return els.filter(e => getComputedStyle(e).cursor === 'pointer' && e.textContent && e.textContent.length < 200)
      .slice(0,10)
      .map(e => ({text: (e.textContent||'').slice(0,60), cls: e.className.slice(0,40)}));
  });
  console.log('POINTER DIVS:', JSON.stringify(pointers, null, 0));
});
