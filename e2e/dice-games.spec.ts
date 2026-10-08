import { expect, test, type Page } from '@playwright/test';

// Dice games: physics replays take a few seconds per throw on software WebGL, so turns wait on the
// HUD's result text (shown only once the dice have settled).
test.setTimeout(180_000);

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

async function startGame(page: Page, id: string) {
  await page.goto(`/games/${id}`);
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expect(page.getByTestId('rules-editor')).toBeVisible();
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
}

/** Tap the pass-the-phone cover low down, clear of any toasts near the top. */
async function dismissCover(page: Page) {
  const cover = page.getByTestId('pass-cover');
  await expect(cover).toBeVisible({ timeout: 8_000 });
  const box = await cover.boundingBox();
  await cover.click({ position: { x: 24, y: (box?.height ?? 600) - 24 } });
  await expect(cover).toBeHidden();
}

test('Dice games are playable from the catalog, with their house rules', async ({ page }) => {
  await seat(page, ['Migs', 'Bea']);
  await page.goto('/games');
  for (const [id, field] of [
    ['mexico', 'tie'],
    ['ship-captain-crew', 'winnerGivesSips'],
    ['liars-dice', 'dicePerPlayer'],
  ] as const) {
    const tile = page.getByTestId(`game-${id}`);
    await expect(tile).not.toHaveAttribute('aria-disabled', 'true');
    await tile.click();
    await expect(page.getByTestId('lobby')).toBeVisible();
    await expect(page.locator(`[data-field="${field}"]`)).toBeVisible();
    await expect(page.getByTestId('start-game')).toBeEnabled();
    await page.goBack();
  }
});

test('Mexico: a full round with 3 players, a reload mid-turn, then the next round', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await startGame(page, 'mexico');
  await expect(page.getByTestId('turn-name')).toHaveText('Migs');
  await expect(page.getByTestId('rolls-left')).toHaveAttribute('data-left', '3');

  let rollId = 0;
  for (let turn = 0; turn < 8 && !(await page.getByTestId('mx-next').isVisible()); turn++) {
    await page.getByTestId('mx-roll').click();
    rollId++;
    // The score is never shown before the dice settle.
    await expect(page.getByTestId('mx-rolling')).toBeVisible();
    await expect(page.locator(`[data-testid="mx-result"][data-roll-id="${rollId}"]`)).toBeVisible({
      timeout: 25_000,
    });

    if (rollId === 1 && (await page.getByTestId('mx-keep').isVisible())) {
      // A reload lands the settled dice at once and doesn't report them again.
      await page.reload();
      await expect(page.locator('[data-testid="mx-result"][data-roll-id="1"]')).toBeVisible({
        timeout: 15_000,
      });
      await page.waitForTimeout(1_500);
      await expect(page.getByTestId('toast-error')).toHaveCount(0);
    }

    const keep = page.getByTestId('mx-keep');
    if (await keep.isVisible()) await keep.click();
    const next = page.getByTestId('mx-next');
    await expect(next.or(page.getByTestId('pass-cover')).first()).toBeVisible({ timeout: 8_000 });
    if (await next.isVisible()) break;
    await dismissCover(page);
  }

  await expect(page.getByTestId('mx-next')).toBeVisible();
  await expect(page.getByTestId('mx-losers')).not.toBeEmpty();
  await expect(page.getByTestId('mx-stake')).toBeVisible();
  await expect(page.getByTestId('mx-loser-mark').first()).toBeVisible();
  await page.getByTestId('mx-next').click();
  await dismissCover(page);
  await expect(page.getByTestId('mx-round')).toHaveText('Round 2');
  await expect(page.getByTestId('mx-roll')).toBeEnabled();
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Ship, Captain & Crew: a full round with 3 players; KEEP needs a full crew', async ({
    page,
  }) => {
    await seat(page, ['Migs', 'Bea', 'Jun']);
    await startGame(page, 'ship-captain-crew');
    await expect(page.getByTestId('turn-name')).toHaveText('Migs');
    await expect(page.getByTestId('scc-lineup')).toHaveAttribute('data-locked', '0');
    await expect(page.getByTestId('scc-keep')).toBeDisabled();

    let rollId = 0;
    for (let turn = 0; turn < 3; turn++) {
      const name = await page.getByTestId('turn-name').textContent();
      for (let r = 0; r < 3; r++) {
        await page.getByTestId('scc-roll').click();
        rollId++;
        await expect(
          page.locator(`[data-testid="scc-result"][data-roll-id="${rollId}"]`),
        ).toBeVisible({ timeout: 25_000 });
        if (await page.getByTestId('scc-next').isVisible()) break;
        if ((await page.getByTestId('turn-name').textContent()) !== name) break;
        const locked = Number(await page.getByTestId('scc-lineup').getAttribute('data-locked'));
        const keep = page.getByTestId('scc-keep');
        if (locked < 3) {
          await expect(keep).toBeDisabled();
          await expect(page.getByTestId('scc-need')).toBeVisible();
        } else {
          await expect(keep).toBeEnabled();
          await keep.click();
          break;
        }
      }
      const next = page.getByTestId('scc-next');
      await expect(next.or(page.getByTestId('pass-cover')).first()).toBeVisible({
        timeout: 8_000,
      });
      if (await next.isVisible()) break;
      await dismissCover(page);
    }

    await expect(page.getByTestId('scc-next')).toBeVisible();
    await expect(page.getByTestId('scc-standings')).toContainText('Migs');
    await expect(page.getByTestId('scc-standings')).toContainText('Jun');
    await page.getByTestId('scc-next').click();
    await dismissCover(page);
    await expect(page.getByTestId('scc-round')).toHaveText('Round 2');
  });
});

test("Liar's Dice: peek, bid, pass, challenge, reveal, next round", async ({ page }) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await startGame(page, 'liars-dice');
  await expect(page.getByTestId('turn-name')).toHaveText('Migs');
  await expect(page.getByTestId('ld-total')).toContainText('15');
  // Bidding opens once the cups have been shaken.
  await expect(page.getByTestId('ld-last-bid')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('ld-challenge')).toBeDisabled();

  // Peek shows only my own five dice, and hides again.
  await page.getByTestId('ld-peek').click();
  const peek = page.getByTestId('ld-peek-panel');
  await expect(peek).toBeVisible();
  await expect(peek.getByRole('img')).toHaveCount(5);
  await page.getByTestId('ld-hide').click();
  await expect(peek).toBeHidden();

  // Peek again and bid without hiding: the hand is gone the moment the bid is made.
  await page.getByTestId('ld-peek').click();
  await expect(peek).toBeVisible();
  await page.getByTestId('ld-face-4').click();
  await page.getByTestId('ld-bid').click();
  await expect(peek).toBeHidden();
  await dismissCover(page);
  await expect(page.getByTestId('turn-name')).toHaveText('Bea');
  await expect(peek).toBeHidden();
  await expect(page.getByTestId('ld-bid-chip')).toHaveCount(1);
  await expect(page.getByTestId('ld-last-bid')).toContainText('Migs');
  // The composer can't go below the smallest legal raise.
  await expect(page.getByRole('button', { name: 'Ilan −' })).toBeDisabled();

  await page.getByTestId('ld-challenge').click();
  const reveal = page.getByTestId('ld-reveal');
  await expect(reveal).toBeVisible();
  await expect(page.getByTestId('ld-count')).toHaveText(/^\d+/);
  await expect(page.getByTestId('ld-verdict')).not.toBeEmpty();
  await expect(page.getByTestId('ld-loser')).toHaveCount(1);

  await page.getByTestId('ld-next').click();
  await dismissCover(page);
  await expect(page.getByTestId('ld-round')).toHaveText('Round 2');
  await expect(page.getByTestId('ld-bid-chip')).toHaveCount(0);
  await expect(page.getByTestId('ld-peek')).toBeVisible();
});

test("Liar's Dice: losing your last die ends the game with a winner", async ({ page }) => {
  await seat(page, ['Migs', 'Bea']);
  await page.goto('/games/liars-dice');
  await expect(page.getByTestId('rules-editor')).toBeVisible();
  await page.locator('[data-field="loseDie"] [role="switch"]').click();
  const fewer = page.locator('[data-field="dicePerPlayer"] button').first();
  for (let i = 0; i < 4; i++) await fewer.click();
  await expect(page.locator('[data-field="dicePerPlayer"] output')).toHaveText('1');
  await page.getByTestId('start-game').click();

  await expect(page.getByTestId('ld-total')).toContainText('2');
  await expect(page.getByTestId('ld-last-bid')).toBeVisible({ timeout: 8_000 });
  await page.getByTestId('ld-bid').click();
  await dismissCover(page);
  await page.getByTestId('ld-challenge').click();
  await expect(page.getByTestId('game-over')).toBeVisible();
  await expect(page.getByTestId('ld-winner')).toContainText(/Panalo si (Migs|Bea)/);
});
