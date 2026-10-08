import { expect, test } from '@playwright/test';

test('age gate → players → Higher or Lower → guess → reload → resume', async ({ page }) => {
  await page.goto('/');

  // 18+ gate
  await expect(page.getByTestId('age-gate')).toBeVisible();
  await page.getByTestId('age-yes').click();
  await expect(page.getByTestId('home')).toBeVisible();

  // Add three players
  await page.getByTestId('nav-players').click();
  for (const name of ['Migs', 'Bea', 'Jun']) {
    await page.getByTestId('player-name').fill(name);
    await page.getByTestId('add-player').click();
  }
  await expect(page.getByTestId('player-row')).toHaveCount(3);

  // Pick Higher or Lower and start
  await page.getByTestId('players-next').click();
  await expect(page.getByTestId('games')).toBeVisible();
  await page.getByTestId('game-higher-lower').click();
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expect(page.getByTestId('rules-editor')).toBeVisible();
  await page.getByTestId('start-game').click();

  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('turn-name')).toHaveText('Migs');
  await expect(page.getByTestId('deck-count')).toContainText('51');

  // One guess: a drink toast, notice or the outcome banner must show up
  await page.getByTestId('guess-higher').click();
  await expect(page.getByTestId('deck-count')).toContainText('50');
  await expect(
    page.locator('[data-testid^="toast-"], [data-testid="hl-outcome"]').first(),
  ).toBeVisible({
    timeout: 5_000,
  });

  // Reload on /play: the session comes back from IndexedDB
  await page.reload();
  await expect(page.getByTestId('play')).toBeVisible();
  await expect(page.getByTestId('deck-count')).toContainText('50');

  // From a cold start on Home, "Resume" returns to the same game
  await page.goto('/');
  await expect(page.getByTestId('resume-card')).toBeVisible();
  await page.getByTestId('resume').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('deck-count')).toContainText('50');
});
