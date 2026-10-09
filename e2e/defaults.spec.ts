import { expect, test } from '@playwright/test';

// A real first open: no seeded settings (playwright.config seeds Low for every other test).
test.use({ storageState: { cookies: [], origins: [] } });

test('a fresh install starts on High graphics', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'High', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('inuman.settings') ?? '{}'),
  );
  expect(stored.state.quality).toBe('high');
});
