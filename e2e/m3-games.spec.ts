import { expect, test, type Page } from '@playwright/test';

// M3 table views: Spin the Bottle, Truth or Dare, Most Likely To and Ride the Bus. Spins are
// animated in the scene (2.5–5 s), so turns wait on the HUD rather than on fixed delays.
test.setTimeout(150_000);

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

/** Opens a game's lobby and checks it has a table view and its house rules. */
async function lobby(page: Page, id: string, field: string) {
  await page.goto(`/games/${id}`);
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expect(page.getByTestId('rules-editor')).toBeVisible();
  await expect(page.locator(`[data-field="${field}"]`)).toBeVisible();
  await expect(page.getByTestId('start-game')).toBeEnabled();
}

async function start(page: Page) {
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
}

/**
 * Pass the phone: a public pass is a banner over the turn indicator (tap it away; the table stays
 * usable underneath), a private one the opaque full-screen cover (tap low, clear of any toasts).
 */
async function passPhone(page: Page) {
  const cover = page.getByTestId('pass-cover');
  const banner = page.getByTestId('pass-banner');
  await expect(cover.or(banner).first()).toBeVisible({ timeout: 8_000 });
  if (await cover.isVisible()) {
    const box = await cover.boundingBox();
    await cover.click({ position: { x: 24, y: (box?.height ?? 600) - 24 } });
    await expect(cover).toBeHidden();
  } else {
    await banner.click();
    await expect(banner).toBeHidden();
  }
}
test('Spin the Bottle: flick-free spin, the bottle lands, truth, done, next spin', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await lobby(page, 'spin-the-bottle', 'outcome');
  await start(page);

  // The first visit to /play lazy-loads the 3D stage and the game's HUD.
  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('stb-round')).toHaveText('Round 1');
  const spin = page.getByTestId('stb-spin');
  await spin.click();
  // Nobody is picked until the bottle has stopped.
  await expect(spin).toBeDisabled();
  await expect(page.getByTestId('stb-choose')).toBeHidden();

  await expect(page.getByTestId('stb-choose')).toBeVisible({ timeout: 15_000 });
  const picked = (await page.getByTestId('turn-name').textContent())?.trim() ?? '';
  expect(['Bea', 'Jun']).toContain(picked);
  await passPhone(page);

  await page.getByTestId('stb-truth').click();
  const prompt = page.getByTestId('stb-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).not.toContainText('{');
  await expect(page.getByTestId('stb-refuse')).toContainText('2');
  await page.getByTestId('stb-done').click();
  await expect(page.getByTestId('stb-result')).toHaveAttribute('data-result', 'done');

  await page.getByTestId('stb-next').click();
  await expect(page.getByTestId('stb-round')).toHaveText('Round 2');
  // Whoever got picked spins next.
  await expect(page.getByTestId('turn-name')).toHaveText(picked);
  await passPhone(page);
  await expect(page.getByTestId('stb-spin')).toBeEnabled();
});

test('Truth or Dare: the wheel picks, refusing costs a drink', async ({ page }) => {
  await seat(page, ['Migs', 'Bea']);
  await lobby(page, 'truth-or-dare', 'choice');
  // Starts with the built-in pack through the content picker.
  await expect(page.getByTestId('pack-builtin-tod-taglish')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('prompt-count')).not.toContainText(/^0 /);
  await page.locator('[data-field="choice"]').getByRole('radio', { name: 'Ang wheel' }).click();
  await start(page);

  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('tod-truth')).toHaveCount(0);
  await page.getByTestId('tod-spin').click();
  await expect(page.getByTestId('tod-spin')).toBeDisabled();

  const prompt = page.getByTestId('tod-prompt');
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await expect(prompt.locator('[data-kind]')).toHaveAttribute('data-kind', /^(truth|dare)$/);
  await expect(prompt).not.toContainText('{');

  await page.getByTestId('tod-refuse').click();
  const toast = page.getByTestId('toast-drinks');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toContainText('Migs');
  // A public pass is a banner, not a cover: the table and the HUD stay in view and usable.
  const banner = page.getByTestId('pass-banner');
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText('Bea');
  await expect(page.getByTestId('pass-cover')).toHaveCount(0);
  await expect(toast).toBeVisible();

  await passPhone(page);
  await expect(page.getByTestId('turn-name')).toHaveText('Bea');
  await expect(page.getByTestId('tod-round')).toHaveText('Round 2');
  await expect(page.getByTestId('tod-spin')).toBeEnabled();
});

test('Most Likely To: point mode, pick who got pointed at, then skip', async ({ page }) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await lobby(page, 'most-likely-to', 'voting');
  await expect(page.getByTestId('pack-builtin-mlt-taglish')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await start(page);

  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('mlt-round')).toHaveText('Round 1');
  await expect(page.getByTestId('mlt-prompt')).not.toContainText('{');
  const pick = page.getByTestId('mlt-pick');
  await expect(pick).toBeDisabled();
  await page.getByTestId('mlt-player').filter({ hasText: 'Bea' }).click();
  await pick.click();

  const toast = page.getByTestId('toast-drinks');
  await expect(toast).toBeVisible({ timeout: 5_000 });
  await expect(toast).toContainText('Bea');
  await passPhone(page);
  await expect(page.getByTestId('mlt-round')).toHaveText('Round 2');
  await expect(page.getByTestId('turn-name')).toHaveText('Bea');
  await expect(page.locator('[data-testid="mlt-player"][aria-pressed="true"]')).toHaveCount(0);

  await expect(page.getByTestId('mlt-skip')).toBeEnabled();
  await page.getByTestId('mlt-skip').click();
  await passPhone(page);
  await expect(page.getByTestId('mlt-round')).toHaveText('Round 3');
  await expect(page.getByTestId('turn-name')).toHaveText('Jun');
});

test('Most Likely To: secret vote with 3 players, past the pass covers, then the tallies', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea', 'Jun']);
  await lobby(page, 'most-likely-to', 'voting');
  await page
    .locator('[data-field="voting"]')
    .getByRole('radio', { name: 'Secret na botohan' })
    .click();
  await start(page);

  const ballot: [string, string][] = [
    ['Migs', 'Bea'],
    ['Bea', 'Bea'],
    ['Jun', 'Migs'],
  ];
  for (const [i, [voter, choice]] of ballot.entries()) {
    await expect(page.getByTestId('turn-name')).toHaveText(voter, { timeout: 15_000 });
    await expect(page.getByTestId('mlt-vote-ask')).toContainText(voter);
    await expect(page.getByTestId('mlt-voted')).toContainText(`${i}/3`);
    // Nothing of the previous ballot is on screen.
    await expect(page.locator('[data-testid="mlt-choice"][aria-checked="true"]')).toHaveCount(0);
    await expect(page.getByTestId('mlt-vote')).toBeDisabled();
    await page.getByTestId('mlt-choice').filter({ hasText: choice }).click();
    await page.getByTestId('mlt-vote').click();
    if (i < ballot.length - 1) await passPhone(page);
  }

  await expect(page.getByTestId('mlt-reveal')).toBeVisible();
  const rows = page.getByTestId('mlt-tally');
  await expect(rows).toHaveCount(3);
  const bea = rows.filter({ hasText: 'Bea' });
  await expect(bea).toHaveAttribute('data-votes', '2');
  await expect(bea).toHaveAttribute('data-most', 'true');
  await expect(rows.filter({ hasText: 'Migs' })).toHaveAttribute('data-votes', '1');
  await expect(rows.filter({ hasText: 'Jun' })).toHaveAttribute('data-most', 'false');
  await expect(page.getByTestId('turn-name')).toHaveText('Bea');
  await expect(page.getByTestId('toast-drinks')).toContainText('Bea', { timeout: 5_000 });

  await page.getByTestId('mlt-next').click();
  await passPhone(page);
  await expect(page.getByTestId('mlt-round')).toHaveText('Round 2');
  await expect(page.getByTestId('turn-name')).toHaveText('Bea');
});

test('Ride the Bus: 2 players deal, flip the pyramid, board, ride until it ends', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await seat(page, ['Migs', 'Bea']);
  await lobby(page, 'ride-the-bus', 'busMaxAttempts');
  // One bus run only, to keep it short.
  const attempts = page.locator('[data-field="busMaxAttempts"]');
  for (let i = 0; i < 4; i++) await attempts.getByRole('button').first().click();
  await expect(attempts.locator('output')).toHaveText('1');
  await start(page);

  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  const questions = ['RED_BLACK', 'HIGHER_LOWER', 'INSIDE_OUTSIDE', 'SUIT'];
  for (const [p, name] of ['Migs', 'Bea'].entries()) {
    for (const [q, question] of questions.entries()) {
      await expect(page.getByTestId('turn-name')).toHaveText(name);
      await expect(page.getByTestId('rtb-question')).toHaveAttribute('data-question', question);
      const answer = page.getByTestId('rtb-answer').first();
      await expect(answer).toBeEnabled({ timeout: 5_000 });
      await answer.click();
      if (q < 3)
        await expect(page.getByTestId('rtb-question')).toHaveAttribute(
          'data-question',
          questions[q + 1] as string,
        );
    }
    if (p === 0) await passPhone(page);
  }

  // Pyramid: ten face-down cards, flipped one at a time.
  const flip = page.getByTestId('rtb-flip');
  await expect(flip).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('rtb-flipped')).toContainText(`${i}/10`);
    await expect(flip).toBeEnabled({ timeout: 5_000 });
    await flip.click();
  }

  // Whoever holds the most cards boards the bus.
  await expect(page.getByTestId('rtb-board')).toBeVisible({ timeout: 5_000 });
  await passPhone(page);
  const rider = (await page.getByTestId('turn-name').textContent())?.trim() ?? '';
  expect(['Migs', 'Bea']).toContain(rider);
  await page.getByTestId('rtb-board').click();
  await expect(page.getByTestId('rtb-attempt')).toContainText('1');

  // Four right in a row gets off; with one attempt allowed, the first miss ends it too.
  // The game ends on the last answer; the results cover follows a moment later.
  const over = page.getByTestId('game-over');
  const ended = page.getByTestId('see-results').or(over);
  for (let i = 0; i < 4 && !(await ended.first().isVisible()); i++) {
    const answer = page.getByTestId('rtb-answer').first();
    await expect(answer.or(ended).first()).toBeVisible();
    if (await ended.first().isVisible()) break;
    await expect(answer).toBeEnabled({ timeout: 5_000 });
    await answer.click();
    await page.waitForTimeout(300);
  }
  await expect(over).toBeVisible({ timeout: 5_000 });
});
