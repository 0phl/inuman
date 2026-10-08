import { expect, test, type Page } from '@playwright/test';

/** Through the 18+ gate and seat a few players. */
async function seat(page: Page, names: string[]) {
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('nav-players').click();
  for (const name of names) {
    await page.getByTestId('player-name').fill(name);
    await page.getByTestId('add-player').click();
  }
  await expect(page.getByTestId('player-row')).toHaveCount(names.length);
}

/** The persisted theme store (what the 3D table reads). */
const storedTheme = (page: Page) =>
  page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('inuman.theme') ?? '{}') as { state?: { theme?: unknown } })
        .state?.theme as Record<string, string> | undefined,
  );

test('Table look: pick a card back and felt in Settings, see it in the Lobby, play with it', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea']);
  await page.goto('/settings');
  const picker = page.getByTestId('theme-picker');
  await expect(picker).toBeVisible();
  const preview = page.getByTestId('theme-preview');
  await expect(preview).toHaveAttribute('data-back', 'classic-red');
  await expect(page.getByTestId('theme-reset')).toBeDisabled();

  await page.getByTestId('theme-back-jeepney').click();
  await page.getByTestId('theme-felt-ube').click();
  await expect(page.getByTestId('theme-back-jeepney')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('theme-felt-ube')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('theme-back-classic-red')).toHaveAttribute('aria-checked', 'false');
  // The live preview redraws with the new look.
  await expect(preview).toHaveAttribute('data-back', 'jeepney');
  await expect(preview).toHaveAttribute('data-felt', '#3d2a5c');

  // Any colour through the custom picker.
  await page.getByTestId('theme-cup-custom').fill('#3366ff');
  await expect(page.getByTestId('theme-cup-custom-row')).toContainText('#3366FF');
  await expect(preview).toHaveAttribute('data-cup', '#3366ff');

  expect(await storedTheme(page)).toMatchObject({
    cardBack: 'jeepney',
    feltColor: '#3d2a5c',
    cupColor: '#3366ff',
  });

  // The Lobby shows the current look and opens the same picker.
  await page.goto('/games/higher-lower');
  const row = page.getByTestId('lobby-theme');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Jeepney');
  await expect(row).toContainText('Ube');
  await expect(row.locator('canvas')).toHaveAttribute('data-felt', '#3d2a5c');
  await row.click();
  const sheet = page.getByTestId('theme-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('theme-back-jeepney')).toHaveAttribute('aria-checked', 'true');
  await sheet.getByTestId('theme-dice-wood').click();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('stage-canvas')).toBeVisible();
  expect(await storedTheme(page)).toMatchObject({
    cardBack: 'jeepney',
    feltColor: '#3d2a5c',
    diceMaterialId: 'wood',
  });
  await page.getByTestId('guess-higher').click();
  await expect(page.getByTestId('deck-count')).toContainText('50');

  // Survives a reload.
  await page.reload();
  await expect(page.getByTestId('play')).toBeVisible();
  expect(await storedTheme(page)).toMatchObject({ cardBack: 'jeepney', feltColor: '#3d2a5c' });
});

test('Share look: the link opens an import preview that applies (and undoes) the look', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  await page.goto('/settings');
  await page.getByTestId('theme-env-procedural-bar').click();
  await page.getByTestId('theme-back-banig').click();
  await page.getByTestId('theme-dice-red-casino').click();
  await page.getByTestId('theme-cup-bottle').click();
  await page.getByTestId('theme-felt-maroon').click();

  await page.getByTestId('theme-share').click();
  const share = page.getByTestId('share-sheet');
  await expect(share.getByTestId('share-body')).toHaveAttribute('data-method', 'qr');
  const link = await share.getByTestId('share-link').inputValue();
  expect(link).toMatch(/\/import#s=1\./);
  await page.keyboard.press('Escape');

  // Someone else's table: back to the defaults before opening the link.
  await page.getByTestId('theme-reset').click();
  await expect(page.getByTestId('theme-back-classic-red')).toHaveAttribute('aria-checked', 'true');

  await page.goto(link);
  const preview = page.getByTestId('import-preview');
  await expect(preview).toHaveAttribute('data-kind', 'theme');
  await expect(page.getByTestId('import-name')).not.toBeEmpty();
  const canvas = page.getByTestId('import-theme-preview');
  await expect(canvas).toHaveAttribute('data-back', 'banig');
  await expect(canvas).toHaveAttribute('data-env', 'procedural-bar');
  await expect(canvas).toHaveAttribute('data-felt', '#5a1a24');
  await expect(
    page.locator('[data-testid="import-theme-rows"] li[data-changed="true"]'),
  ).toHaveCount(5);

  await page.getByTestId('import-save').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  expect(await storedTheme(page)).toMatchObject({
    environmentId: 'procedural-bar',
    cardBack: 'banig',
    diceMaterialId: 'red-casino',
    cupColor: '#1e6b3f',
    feltColor: '#5a1a24',
  });

  await page.getByTestId('import-theme-undo').click();
  await expect(page.getByTestId('import-theme-undo')).toBeHidden();
  expect(await storedTheme(page)).toMatchObject({
    environmentId: 'dive-bar',
    cardBack: 'classic-red',
  });
});
