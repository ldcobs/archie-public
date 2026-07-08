/**
 * TEST_SPEC §2 — Access Keys / VPN Users.
 *
 * The critical regression-guard cases are 2.5 and 2.6: a single disable/enable
 * must produce exactly one validated config write + one restart, never a loop.
 * These run against the dashboard + host apply script — the layer where the
 * restart-loop bug lives. They go red→green as the fix lands and stay green
 * thereafter.
 *
 * P0 cases covered:
 *  2.1  page lists keys with correct status
 *  2.2  add a key, it appears, unique
 *  2.5  disable → status flips, exactly ONE disable API call
 *  2.6  re-enable → status flips back, exactly ONE enable API call
 *  2.3  copy subscription URL → "Copied" feedback
 *  2.8  delete → removed from list (single confirmation)
 */
import { test, expect, openAccessKeys, autoAcceptDialogs } from '../fixtures';

test.describe('§2 Access Keys', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    await openAccessKeys(page);
  });

  test('2.1 lists keys with ACCESS KEYS heading and status tabs', async ({ authedPage: page }) => {
    await expect(page.getByRole('heading', { name: 'ACCESS KEYS', level: 1 })).toBeVisible();
    // Status filter tabs exist
    await expect(page.getByRole('button', { name: /All Keys/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Active/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Disabled/ })).toBeVisible();
  });

  test('2.2 add a key: appears in list after creation', async ({ authedPage: page }) => {
    const name = `e2e-${Date.now()}`;
    await page.getByRole('button', { name: '+ New Access Key' }).click();
    await page.getByPlaceholder('e.g. alex').fill(name);
    await page.getByRole('button', { name: 'Create Key' }).click();
    await expect(page.getByText('KEY CREATED')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    // Key appears in the list
    await expect(page.getByText(name)).toBeVisible();
  });

  test('2.3 copy subscription URL shows Copied feedback', async ({ authedPage: page }) => {
    // Use the first key in the list (seeded by fixtures)
    const firstRow = page.locator('div').filter({ hasText: 'Active' }).first();
    await firstRow.click();
    // In the detail panel, Copy button
    const copyBtn = page.getByRole('button', { name: /Copy Subscription/ }).first();
    await copyBtn.click();
    await expect(page.getByText('Copied').first()).toBeVisible({ timeout: 3_000 });
  });

  test('2.5 disable a key: status flips to Disabled, exactly ONE disable call', async ({ authedPage: page, context }) => {
    autoAcceptDialogs(page);

    // Record disable API calls so we can assert exactly one (the restart-loop guard).
    let disableCalls = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/users/') && req.url().endsWith('/disable')) {
        disableCalls++;
      }
    });

    // Pick an active key and disable it
    await page.getByRole('button', { name: /Active/ }).first().click();
    const row = page.locator('div').filter({ hasText: 'Active' }).first();
    await row.click();
    await page.getByRole('button', { name: /^⏸ Disable Key$/ }).click();

    // Status chip flips to Disabled
    await expect(page.getByText('Disabled').first()).toBeVisible({ timeout: 10_000 });

    // THE regression assertion: exactly one disable request, not a storm.
    expect(disableCalls, 'disable must fire exactly one API call').toBe(1);
  });

  test('2.6 re-enable: status flips to Active, exactly ONE enable call', async ({ authedPage: page }) => {
    autoAcceptDialogs(page);
    let enableCalls = 0;
    page.on('request', (req) => {
      // The dashboard's disable route handles both directions; a re-enable is a
      // disable-call with {disabled:false}. We count calls that change the user
      // state — one per logical action.
      if (req.url().includes('/api/users/') && req.url().endsWith('/disable')) {
        enableCalls++;
      }
    });

    // Find a disabled key (may need to filter)
    await page.getByRole('button', { name: /Disabled/ }).first().click();
    const disabledRow = page.locator('div').filter({ hasText: 'Disabled' }).first();
    await disabledRow.click();
    await page.getByRole('button', { name: /^⏸ Re-enable Key$/ }).click();

    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10_000 });
    expect(enableCalls, 'enable must fire exactly one API call').toBe(1);
  });

  test('2.8 delete key: removed from list after confirm', async ({ authedPage: page }) => {
    autoAcceptDialogs(page);
    const name = `del-${Date.now()}`;
    // Create then delete to keep the test self-contained
    await page.getByRole('button', { name: '+ New Access Key' }).click();
    await page.getByPlaceholder('e.g. alex').fill(name);
    await page.getByRole('button', { name: 'Create Key' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByText(name).click();
    await page.getByRole('button', { name: /Delete Key/ }).click();
    // Confirm modal
    await page.getByRole('button', { name: 'Delete Key' }).last().click();
    // Gone from list
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });
  });
});
