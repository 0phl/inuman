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

/** Tap the pass-the-phone cover low down, clear of any drink toasts stacked near the top. */
async function dismissCover(page: Page) {
  const cover = page.getByTestId('pass-cover');
  const box = await cover.boundingBox();
  await cover.click({ position: { x: 24, y: (box?.height ?? 600) - 24 } });
  await expect(cover).toBeHidden();
}

test('Kings Cup: draw until a card needs settling, then settle it', async ({ page }) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await page.goto('/games/kings-cup');
  await expect(page.getByTestId('lobby')).toBeVisible();
  await page.getByTestId('start-game').click();

  await expect(page).toHaveURL(/\/play$/);
  // The first visit to /play lazy-loads the 3D stage and the game's HUD.
  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('deck-count')).toContainText('52');
  await expect(page.getByTestId('kc-kings')).toContainText('4');

  const pending = page.getByTestId('kc-pending');
  const cover = page.getByTestId('pass-cover');
  const draw = page.getByTestId('kc-draw');

  for (let i = 0; i < 10; i++) {
    await expect(draw).toBeEnabled({ timeout: 5_000 });
    await draw.click();
    await expect(page.getByTestId('deck-count')).toContainText(String(51 - i));
    await expect(page.getByTestId('kc-meaning')).toHaveAttribute('data-rank', /.+/);
    // Either the table has to settle the card, or the phone goes to the next player.
    await expect(pending.or(cover).first()).toBeVisible({ timeout: 6_000 });
    if (await pending.isVisible()) break;
    await dismissCover(page);
  }

  // ~10 draws without a single pending card is possible but very unlikely (<0.1%).
  if (await pending.isVisible()) {
    // The pass-the-phone cover waits until the card is settled.
    await expect(cover).toBeHidden();
    const kind = await pending.getAttribute('data-kind');
    if (kind === 'rule') {
      await expect(page.getByTestId('kc-resolve')).toBeDisabled();
      await page.getByTestId('kc-rule-input').fill('Bawal mag-English');
    } else {
      await page.getByTestId('kc-target').first().click();
    }
    await page.getByTestId('kc-resolve').click();
    await expect(pending).toBeHidden();
    if (kind === 'rule') await expect(page.getByTestId('kc-house-rules')).toContainText('1');
    if (kind === 'mate') await expect(page.getByTestId('kc-mates')).toBeVisible();
    await expect(cover).toBeVisible({ timeout: 5_000 });
    await dismissCover(page);
    await expect(draw).toBeEnabled();
  }
});

test('Never Have I Ever: mark who did it, next prompt, drink toast below the reader', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await page.goto('/games/never-have-i-ever');
  await expect(page.getByTestId('content-picker')).toBeVisible();
  // The Taglish pack is picked by default for the Taglish UI.
  await expect(page.getByTestId('pack-builtin-nhie-taglish')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('prompt-count')).not.toContainText(/^0 /);
  await page.getByTestId('start-game').click();

  await expect(page).toHaveURL(/\/play$/);
  // The first visit to /play lazy-loads the 3D stage and the game's HUD.
  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('nhie-round')).toHaveText('Round 1');
  const prompt = page.getByTestId('nhie-prompt');
  await expect(prompt).not.toBeEmpty();
  await expect(prompt).not.toContainText('{');

  const bea = page.getByTestId('nhie-player').filter({ hasText: 'Bea' });
  await bea.click();
  await expect(bea).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('nhie-next').click();

  await expect(page.getByTestId('nhie-round')).toHaveText('Round 2');
  await expect(page.getByTestId('turn-name')).toHaveText('Bea');
  await expect(page.locator('[data-testid="nhie-player"][aria-pressed="true"]')).toHaveCount(0);

  const toast = page.getByTestId('toast-drinks');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toContainText('Bea');
  // The toast sits under the turn indicator instead of covering it.
  const toastBox = await toast.boundingBox();
  const nameBox = await page.getByTestId('turn-name').boundingBox();
  expect(toastBox && nameBox).toBeTruthy();
  expect(toastBox!.y).toBeGreaterThanOrEqual(nameBox!.y + nameBox!.height);
});

test('Non-alcoholic mode: the drink toast drops the "tagay" wording', async ({ page }) => {
  await seat(page, ['Migs', 'Bea']);
  await page.goto('/games/never-have-i-ever');
  await page.getByTestId('quick-nonalc').click();
  await expect(page.getByTestId('quick-nonalc')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('nhie-round')).toHaveText('Round 1', { timeout: 15_000 });
  await page.getByTestId('nhie-player').filter({ hasText: 'Migs' }).click();
  await page.getByTestId('nhie-next').click();
  const toast = page.getByTestId('toast-drinks');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast.getByTestId('drink-soft-reason')).toBeVisible();
  await expect(toast).not.toContainText(/tagay/i);
});
