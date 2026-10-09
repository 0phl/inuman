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

test('the install banner floats on Home, explains the steps, and stays in Settings once closed', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  const banner = page.getByTestId('install-banner');
  await expect(banner).toBeVisible();
  // It never covers Home: the last thing on the page (the footer) stays fully above it.
  const footer = await page.getByTestId('home').locator('p').last().boundingBox();
  const box = await banner.boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(box!.y);

  // No browser install dialog here (headless): the steps sheet for this phone opens instead.
  await page.getByTestId('install-banner-button').click();
  const steps = page.getByTestId('install-steps');
  await expect(steps).toBeVisible();
  await expect(steps.locator('li')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(steps).toBeHidden();

  // Closed for good on this device…
  await page.getByTestId('install-banner-close').click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('home')).toBeVisible();
  await expect(banner).toBeHidden();

  // …but Settings still offers it, right after the language.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-install')).toBeVisible();
  await page.getByTestId('settings-install-button').click();
  await expect(page.getByTestId('install-steps')).toBeVisible();
});
