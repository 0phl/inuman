import { expect, test, type CDPSession, type Page } from '@playwright/test';

// Skill games (Beer Pong, Quarters, Flip Cup). Throws are pre-simulated with Rapier and replayed
// in real time, so every turn waits on the HUD's result (shown only once the throw has landed).
// Gestures under SwiftShader arrive too far apart to read as flicks, so the tests use each game's
// accessible fallback: the "Tumira" hold-to-throw meter (held for the power it marks as ideal,
// with CDP-timestamped presses so a slow frame doesn't change the hold) and Flip Cup's tap meter.
test.setTimeout(240_000);
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'CDP input timestamps are Chromium-only',
);

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

async function openLobby(page: Page, id: string) {
  await page.goto(`/games/${id}`);
  await expect(page.getByTestId('lobby')).toBeVisible();
  await expect(page.getByTestId('rules-editor')).toBeVisible();
}

async function start(page: Page) {
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
}

/** Clicks a rules stepper's + or − `times` times. */
async function step(page: Page, field: string, dir: '+' | '−', times: number) {
  const btn = page.locator(`[data-field="${field}"] button[aria-label$="${dir}"]`);
  for (let i = 0; i < times; i++) await btn.click();
}

/** A public pass banner sits over the turn indicator; tap it away if it's up. */
async function dismissPass(page: Page) {
  const banner = page.getByTestId('pass-banner');
  if (await banner.isVisible()) await banner.click({ timeout: 2_000 }).catch(() => {});
}

/**
 * Holds a "Tumira" button for `power` (default: the power it marks as ideal), with the press and
 * release stamped `power × 1100 ms` apart so the meter reads exactly that.
 */
async function holdThrow(page: Page, cdp: CDPSession, testId: string, power?: number) {
  const btn = page.getByTestId(testId);
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  const ideal = Number((await btn.getAttribute('data-ideal')) || '0.45');
  const p = power ?? ideal;
  const box = await btn.boundingBox();
  if (!box) throw new Error(`${testId} has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const t0 = Date.now() / 1000;
  const held = Math.max(0.02, p * 1.1);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, timestamp: t0 - 0.05 });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
    timestamp: t0,
  });
  await page.waitForTimeout(held * 1000);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
    timestamp: t0 + held,
  });
}

const attr = async (page: Page, testId: string, name: string) =>
  page.getByTestId(testId).getAttribute(name);

test('Skill games are in the catalog, show their rules, and start with two players', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea']);
  for (const [id, field] of [
    ['beer-pong', 'aimAssist'],
    ['quarters', 'mustBounce'],
    ['flip-cup', 'difficulty'],
  ] as const) {
    await page.goto('/games');
    const tile = page.getByTestId(`game-${id}`);
    await expect(tile).not.toHaveAttribute('aria-disabled', 'true');
    await tile.click();
    await expect(page.getByTestId('lobby')).toBeVisible();
    await expect(page.locator(`[data-field="${field}"]`)).toBeVisible();
    await expect(page.getByTestId('start-game')).toBeEnabled();
  }
  // Aim assist is a 0 … 3 stepper with its help text.
  await openLobby(page, 'beer-pong');
  const assist = page.locator('[data-field="aimAssist"]');
  await expect(assist.getByRole('group')).toBeVisible();
  await expect(assist.locator('output')).toHaveText('2');
  await expect(assist.locator('.text-sm').first()).not.toBeEmpty();
  await step(page, 'aimAssist', '+', 1);
  await expect(assist.locator('output')).toHaveText('3');
  await expect(assist.locator('button[aria-label$="+"]')).toBeDisabled();
  await start(page);
  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('bp-cups-0')).toHaveAttribute('data-left', '6');
});

test('Beer Pong: Tumira until cups fall, the racks swap, and a team wins', async ({ page }) => {
  await seat(page, ['Migs', 'Bea', 'Jun', 'Tess']);
  await openLobby(page, 'beer-pong');
  // 6 cups (the default), full aim help, and no balls back so every turn is two throws.
  await expect(page.locator('[data-field="cups"] [aria-checked="true"]')).toHaveText(/6/);
  await step(page, 'aimAssist', '+', 1);
  const ballsBack = page.locator('[data-field="ballsBack"] [role="switch"]');
  await ballsBack.click();
  await expect(ballsBack).toHaveAttribute('aria-checked', 'false');
  await start(page);
  const cdp = await page.context().newCDPSession(page);

  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('bp-throws-left')).toHaveAttribute('data-left', '2');
  const controls = page.getByTestId('bp-controls');
  const team = () => controls.getAttribute('data-turn-team');

  let hits = 0;
  let swaps = 0;
  let reracked = false;
  let lastTeam = await team();
  for (let n = 1; n <= 30; n++) {
    if (await page.getByTestId('bp-winner').isVisible()) break;
    await dismissPass(page);
    // Spend the re-rack once it's offered (from 3 cups down).
    if (!reracked && (await page.getByTestId('bp-rerack').isVisible())) {
      await page.getByTestId('bp-rerack').click();
      await expect(page.getByTestId('bp-rerack-sheet')).toBeVisible();
      await page.locator('[data-testid^="bp-formation-"]').first().click();
      await expect(page.getByTestId('bp-rerack-sheet')).toBeHidden();
      await expect(page.getByTestId('bp-rerack')).toBeHidden();
      reracked = true;
    }
    const before = [
      Number(await attr(page, 'bp-cups-0', 'data-left')),
      Number(await attr(page, 'bp-cups-1', 'data-left')),
    ];
    await holdThrow(page, cdp, 'bp-shoot');
    const result = page.locator(`[data-testid="bp-result"][data-throw-id="${n}"]`);
    await expect(result.or(page.getByTestId('bp-winner')).first()).toBeVisible({
      timeout: 30_000,
    });
    if (await page.getByTestId('bp-winner').isVisible()) {
      hits++;
      break;
    }
    if ((await result.getAttribute('data-hit')) === 'true') {
      hits++;
      // The cup comes off the rack being shot at.
      await expect
        .poll(async () =>
          [
            Number(await attr(page, 'bp-cups-0', 'data-left')),
            Number(await attr(page, 'bp-cups-1', 'data-left')),
          ].reduce((a, b) => a + b),
        )
        .toBe(before[0]! + before[1]! - 1);
    }
    // The throw is reported once the ball has landed (and a sunk cup sat in its cup a moment).
    await expect(controls.or(page.getByTestId('bp-winner')).first()).toBeVisible();
    if (await page.getByTestId('bp-winner').isVisible()) break;
    await expect(controls).toHaveAttribute('data-last-throw', String(n), { timeout: 10_000 });
    const now = await team();
    if (now !== null && now !== lastTeam) swaps++;
    lastTeam = now ?? lastTeam;
  }

  expect(hits).toBeGreaterThan(0);
  expect(swaps).toBeGreaterThan(0);
  await expect(page.getByTestId('bp-winner')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bp-losers')).not.toBeEmpty();
  await expect(page.getByTestId('see-results')).toBeVisible();
  await page.getByTestId('see-results').click();
  await expect(page.getByTestId('game-over')).toBeVisible();
  await expect(page.getByTestId('bp-winner-line')).toBeVisible();
});

test('Quarters: a make, the shooter picks who drinks, then misses pass the coin', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea', 'Jun', 'Tess']);
  await openLobby(page, 'quarters');
  await start(page);
  const cdp = await page.context().newCDPSession(page);
  await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
  await expect(page.getByTestId('qt-misses')).toHaveAttribute('data-left', '1');

  // Shoot (at the marked power) until one goes in; a miss passes the coin, which is fine.
  const pending = page.getByTestId('qt-pending');
  let shot = 0;
  for (let i = 0; i < 16 && !(await pending.isVisible()); i++) {
    await dismissPass(page);
    await holdThrow(page, cdp, 'qt-shoot');
    shot++;
    await expect(
      page.locator(`[data-testid="qt-result"][data-shot-id="${shot}"]`).or(pending).first(),
    ).toBeVisible({ timeout: 30_000 });
  }
  await expect(pending).toBeVisible();
  await expect(pending).toHaveAttribute('data-kind', 'pick');
  const shooter = await page.getByTestId('turn-name').textContent();

  // Pick who drinks: the toast names them.
  await expect(page.getByTestId('qt-resolve')).toBeDisabled();
  const target = page.getByTestId('qt-target').first();
  const picked = (await target.textContent()) ?? '';
  await target.click();
  await page.getByTestId('qt-resolve').click();
  await expect(pending).toBeHidden();
  await expect(page.getByTestId('toast-drinks')).toContainText(picked, { timeout: 8_000 });
  // A make keeps the coin.
  await expect(page.getByTestId('turn-name')).toHaveText(shooter ?? '');
  await expect(page.getByTestId('qt-streak')).toContainText('1');

  // Weak throws until one misses and the coin passes (a lucky make is skipped).
  for (let i = 0; i < 10; i++) {
    if ((await page.getByTestId('turn-name').textContent()) !== shooter) break;
    if (await pending.isVisible()) {
      await page.getByTestId('qt-skip').click();
      continue;
    }
    await holdThrow(page, cdp, 'qt-shoot', 0.02);
    shot++;
    await expect(
      page.locator(`[data-testid="qt-result"][data-shot-id="${shot}"]`).or(pending).first(),
    ).toBeVisible({ timeout: 30_000 });
  }
  await expect(page.getByTestId('turn-name')).not.toHaveText(shooter ?? '');
  await expect(page.getByTestId('pass-banner')).toBeVisible();
  await expect(page.getByTestId('qt-streak')).toContainText('0');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Flip Cup: drink, flip every leg until a team wins (or it is a draw)', async ({ page }) => {
    await seat(page, ['Migs', 'Bea', 'Jun', 'Tess']);
    await openLobby(page, 'flip-cup');
    // Three tries a leg keeps the race short.
    await step(page, 'maxAttemptsPerLeg', '−', 5);
    await expect(page.locator('[data-field="maxAttemptsPerLeg"] output')).toHaveText('3');
    await start(page);
    await expect(page.getByTestId('turn-name')).toHaveText('Migs', { timeout: 15_000 });
    await expect(page.getByTestId('fc-drink')).toBeVisible();
    await expect(page.getByTestId('fc-flip')).toBeHidden();

    const winner = page.getByTestId('fc-winner');
    let flips = 0;
    let drinks = 0;
    for (let i = 0; i < 120; i++) {
      if (await winner.isVisible()) break;
      await dismissPass(page);
      const drank = page.getByTestId('fc-drank');
      if (await drank.isVisible()) {
        await drank.click();
        drinks++;
        await expect(page.getByTestId('fc-flip')).toBeEnabled();
        continue;
      }
      const flip = page.getByTestId('fc-flip');
      if (await flip.isEnabled().catch(() => false)) {
        await flip.click();
        flips++;
        // Each try lands (scripted) and is reported before the next one.
        await expect(
          page.locator(`[data-testid="fc-result"][data-flip-id="${flips}"]`).or(winner).first(),
        ).toBeVisible({ timeout: 15_000 });
        continue;
      }
      await page.waitForTimeout(200);
    }

    await expect(winner).toBeVisible();
    // Every leg started with a drink, and nobody went past the cap.
    expect(drinks).toBeGreaterThanOrEqual(4);
    expect(flips).toBeGreaterThanOrEqual(4);
    const tries =
      Number(await attr(page, 'fc-team-0', 'data-tries')) +
      Number(await attr(page, 'fc-team-1', 'data-tries'));
    expect(tries).toBeGreaterThanOrEqual(4);
    await page.getByTestId('see-results').click();
    await expect(page.getByTestId('game-over')).toBeVisible();
    await expect(page.getByTestId('fc-winner-line')).toBeVisible();
  });
});
