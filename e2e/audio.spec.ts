import { expect, test, type Page } from '@playwright/test';

// Sound, music and haptics. `?audioDebug=1` makes the engine keep window.__audioLog: every sound id
// it schedules, in call order (a sound scheduled ahead is logged when it's scheduled).
test.setTimeout(120_000);
// The service worker would answer the audio manifest and files from its precache, out of reach of
// page.route (and the precache is from the build, not this test's fixtures).
test.use({ serviceWorkers: 'block' });

const log = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...((globalThis as unknown as { __audioLog?: string[] }).__audioLog ?? [])]);

/** Waits until every id in `ids` shows up in the log in this order (after `from`). */
async function expectInOrder(page: Page, ids: string[], from = 0) {
  await expect
    .poll(
      async () => {
        const l = (await log(page)).slice(from);
        let at = -1;
        for (const id of ids) {
          at = l.indexOf(id, at + 1);
          if (at < 0) return `missing ${id} in ${l.join(',')}`;
        }
        return 'ok';
      },
      { timeout: 20_000 },
    )
    .toBe('ok');
}

async function seat(page: Page, names: string[]) {
  await page.goto('/?audioDebug=1');
  await page.getByTestId('age-yes').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('nav-players').click();
  for (const name of names) {
    await page.getByTestId('player-name').fill(name);
    await page.getByTestId('add-player').click();
  }
  await expect(page.getByTestId('player-row')).toHaveCount(names.length);
}

/**
 * Opens the lobby (a full page load, so the log starts over) and starts the game. Returns the log
 * length just before the start tap.
 */
async function startGame(page: Page, id: string): Promise<number> {
  await page.goto(`/games/${id}`);
  await expect(page.getByTestId('lobby')).toBeVisible();
  const from = (await log(page)).length;
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
  // A move made before the scene is mounted lands without animation (and so without the
  // animation's sounds): wait until the stage says the scene is compiled and showing.
  await expect(page.getByTestId('stage')).toHaveAttribute('data-scene', 'ready', {
    timeout: 20_000,
  });
  return from;
}

/** Console errors and uncaught exceptions, minus the browser's own network lines for blocked files. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

test('start, card flip, dice roll and a drink toast play their sounds in order', async ({
  page,
}) => {
  await seat(page, ['Migs', 'Bea']);

  // Higher or Lower: the cap pops, the deck shuffles, then every guess is a card flight.
  const before = await startGame(page, 'higher-lower');
  await expectInOrder(page, ['ui.tapPrimary', 'ui.gameStart', 'card.shuffle'], before);

  // Guess until someone has to drink (a wrong guess, or a tie under the default "lose" rule).
  let drank = false;
  for (let i = 0; i < 12 && !drank; i++) {
    const from = (await log(page)).length;
    await expect(page.getByTestId('guess-higher')).toBeEnabled({ timeout: 8_000 });
    await page.getByTestId('guess-higher').click();
    await expectInOrder(page, ['card.slide', 'card.flip', 'card.place'], from);
    const outcome = page.getByTestId('hl-outcome');
    await expect(outcome).toBeVisible({ timeout: 5_000 });
    const kind = await outcome.getAttribute('data-outcome');
    if (kind === 'correct') {
      await expect
        .poll(async () =>
          (await log(page)).slice(from).some((id) => id === 'game.correct' || id === 'game.streak'),
        )
        .toBe(true);
    } else {
      // Mali / tabla: the sting as the card lands, then the toast clinks.
      await expectInOrder(page, ['card.place', `game.${kind}`], from);
      await expect(page.getByTestId('toast-drinks').first()).toBeVisible({ timeout: 5_000 });
      await expectInOrder(page, ['card.place', 'drink.cheers'], from);
      drank = true;
    }
    const banner = page.getByTestId('pass-banner');
    if (await banner.isVisible()) await banner.click();
  }
  expect(drank).toBe(true);

  // Mexico: the cup scoops and rattles, the dice leave it and knock round the tray.
  const from = await startGame(page, 'mexico');
  await page.getByTestId('mx-roll').click();
  await expectInOrder(
    page,
    ['ui.gameStart', 'dice.grab', 'dice.shake', 'dice.throw', 'dice.hitTable'],
    from,
  );
  await expect(page.locator('[data-testid="mx-result"][data-roll-id="1"]')).toBeVisible({
    timeout: 25_000,
  });
});

test('volume and music choices persist across reloads', async ({ page }) => {
  await page.goto('/?audioDebug=1');
  await page.getByTestId('age-yes').click();
  await page.goto('/settings');
  await expect(page.getByTestId('sound-settings')).toBeVisible();

  const master = page.getByTestId('fader-master');
  await master.fill('40');
  await expect(page.getByTestId('fader-master-value')).toHaveText('40%');
  await page.getByTestId('fader-sfx').fill('65');
  await page.getByTestId('music-track-lofi-lounge').click();
  await expect(page.getByTestId('music-track-lofi-lounge')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('fader-music').fill('15');
  await page.getByTestId('toggle-ambience').click();
  await expect(page.getByTestId('fader-ambience')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('fader-master-value')).toHaveText('40%');
  await expect(page.getByTestId('fader-sfx-value')).toHaveText('65%');
  await expect(page.getByTestId('fader-music-value')).toHaveText('15%');
  await expect(page.getByTestId('music-track-lofi-lounge')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('toggle-ambience')).toHaveAttribute('aria-checked', 'true');

  // "Off" turns the music off and survives a reload too; "Halo-halo" turns it back on.
  await page.getByTestId('music-track-off').click();
  await page.reload();
  await expect(page.getByTestId('music-track-off')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('toggle-music')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('music-track-shuffle').click();
  await expect(page.getByTestId('toggle-music')).toHaveAttribute('aria-checked', 'true');

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('inuman.settings') ?? '{}'),
  );
  expect(stored.version).toBe(2);
  expect(stored.state).toMatchObject({
    masterVolume: 0.4,
    sfxVolume: 0.65,
    musicVolume: 0.15,
    musicTrack: 'shuffle',
    music: true,
    ambience: true,
  });

  // The test button plays its sample.
  const from = (await log(page)).length;
  await page.getByTestId('sound-test').click();
  await expectInOrder(page, ['card.flip', 'dice.hitTable', 'drink.cheers'], from);
});

test('muting from the Play top bar stops new sounds', async ({ page }) => {
  await seat(page, ['Migs', 'Bea']);
  await startGame(page, 'higher-lower');
  const speaker = page.getByTestId('speaker');
  await expect(speaker).toHaveAttribute('aria-checked', 'true');
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-checked', 'false');

  const muted = (await log(page)).length;
  await page.getByTestId('guess-higher').click();
  await expect(page.getByTestId('hl-outcome')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1_500);
  expect((await log(page)).slice(muted)).toEqual([]);

  // Unmute: the switch confirms, and the next guess is heard again.
  await speaker.click();
  await expect(speaker).toHaveAttribute('aria-checked', 'true');
  const banner = page.getByTestId('pass-banner');
  if (await banner.isVisible()) await banner.click();
  const from = (await log(page)).length;
  await expect(page.getByTestId('guess-higher')).toBeEnabled({ timeout: 8_000 });
  await page.getByTestId('guess-higher').click();
  await expectInOrder(page, ['card.slide', 'card.flip', 'card.place'], from);

  // A long press opens the music sheet instead of muting.
  const box = await speaker.boundingBox();
  if (!box) throw new Error('no speaker');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.getByTestId('sound-sheet')).toBeVisible({ timeout: 3_000 });
  await page.mouse.up();
  await expect(speaker).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('quick-track-opm-acoustic')).toBeVisible();
});

test.describe('missing audio files', () => {
  test('no console errors when the manifest is missing', async ({ page }) => {
    const errors = watchErrors(page);
    await page.route('**/assets/audio/**', (r) => r.abort());
    await seat(page, ['Migs', 'Bea']);
    await startGame(page, 'higher-lower');
    await page.getByTestId('guess-higher').click();
    await expect(page.getByTestId('hl-outcome')).toBeVisible({ timeout: 5_000 });
    expect(await log(page)).toEqual(expect.arrayContaining(['ui.gameStart', 'card.flip']));
    // UI sounds fall back to synthesized clicks; everything else stays silent, quietly.
    await page.getByTestId('open-menu').click();
    await expect(page.getByTestId('play-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/settings');
    await page.getByTestId('sound-test').click();
    await page.getByTestId('music-track-retro-videoke').click();
    await page.waitForTimeout(2_500);
    expect(await log(page)).toContain('drink.cheers');
    expect(errors).toEqual([]);
  });

  test('no console errors when the manifest lists files that are gone', async ({ page }) => {
    const errors = watchErrors(page);
    await page.route('**/assets/audio/manifest.json', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          version: 1,
          sfx: {
            'ui.tap': { files: ['sfx/ui.tap_1.mp3', 'sfx/ui.tap_2.mp3'], gainDb: 0, loop: false },
            'card.flip': { files: ['sfx/card.flip_1.mp3'], gainDb: -2, loop: false },
            'dice.hitTable': { files: ['sfx/dice.hitTable_1.mp3'], gainDb: 0, loop: false },
            'bottle.spin': { files: ['sfx/bottle.spin_1.mp3'], gainDb: 0, loop: true },
          },
          music: {
            'opm-acoustic': {
              file: 'music/opm-acoustic.mp3',
              title: 'Test Track',
              artist: 'Test Artist',
              license: 'CC BY 4.0',
              url: 'https://example.com/track',
              loopStart: null,
              loopEnd: null,
              durationSec: 120,
            },
          },
          credits: [
            { what: 'Card sounds', author: 'Someone', license: 'CC0', url: 'https://example.com' },
          ],
        }),
      }),
    );
    await page.route('**/assets/audio/**/*.mp3', (r) => r.fulfill({ status: 404, body: '' }));
    await seat(page, ['Migs', 'Bea']);
    await startGame(page, 'higher-lower');
    await page.getByTestId('guess-higher').click();
    await expect(page.getByTestId('hl-outcome')).toBeVisible({ timeout: 5_000 });
    await page.goto('/settings');
    // Titles and credits come from the manifest.
    await expect(page.getByTestId('music-track-opm-acoustic')).toContainText('Test Track');
    await page.getByTestId('credits').click();
    await expect(page.getByTestId('audio-credits')).toContainText('Test Artist');
    await page.getByTestId('sound-test').click();
    await page.waitForTimeout(2_500);
    expect(errors).toEqual([]);
  });
});

/** A mono 16-bit WAV: `lead` seconds of silence, then a soft sine for `seconds`. */
function wav(seconds: number, lead = 0, freq = 440, rate = 22050): Buffer {
  const n = Math.round((lead + seconds) * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  const start = Math.round(lead * rate);
  for (let i = start; i < n; i++)
    b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000), 44 + i * 2);
  return b;
}

const state = (page: Page) =>
  page.evaluate(() =>
    (globalThis as unknown as { __audioState: () => Record<string, unknown> }).__audioState(),
  );

test('music starts after the first tap, follows the picker, and decoded effects play', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.route('**/assets/audio/manifest.json', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        sfx: {
          'ui.tap': { files: ['sfx/ui.tap_1.wav', 'sfx/ui.tap_2.wav'], gainDb: 0, loop: false },
          'ui.tapPrimary': { files: ['sfx/ui.tapPrimary_1.wav'], gainDb: -3, loop: false },
          'card.flip': { files: ['sfx/card.flip_1.wav'], gainDb: 0, loop: false },
        },
        music: {
          'opm-acoustic': {
            file: 'music/opm-acoustic.wav',
            title: 'Gabi sa Kanto',
            artist: 'Test Band',
            license: 'CC BY 4.0',
            url: 'https://example.com/gabi',
            loopStart: null,
            loopEnd: null,
            durationSec: 6,
          },
          'lofi-lounge': {
            file: 'music/lofi-lounge.wav',
            title: 'Lounge',
            artist: 'Test Band',
            license: 'CC BY 4.0',
            url: '',
            loopStart: 1,
            loopEnd: 5,
            durationSec: 6,
          },
        },
        credits: [],
      }),
    }),
  );
  await page.route('**/assets/audio/sfx/*.wav', (r) =>
    r.fulfill({ contentType: 'audio/wav', body: wav(0.12, 0.05, 900) }),
  );
  await page.route('**/assets/audio/music/*.wav', (r) =>
    r.fulfill({ contentType: 'audio/wav', body: wav(6, 0, 330) }),
  );

  await page.goto('/?audioDebug=1');
  // Nothing plays before the first tap.
  expect(await state(page)).toMatchObject({ context: 'none', music: null });
  await page.getByTestId('age-yes').click();
  await expect
    .poll(async () => (await state(page)).music, { timeout: 10_000 })
    .toBe('opm-acoustic');
  await expect
    .poll(async () => (await state(page)).musicTime, { timeout: 10_000 })
    .toBeGreaterThan(0.3);

  // The jukebox switches tracks (crossfade) and keeps playing across routes.
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('music-track-opm-acoustic')).toContainText('Gabi sa Kanto');
  await page.getByTestId('music-track-lofi-lounge').click();
  await expect.poll(async () => (await state(page)).music, { timeout: 10_000 }).toBe('lofi-lounge');
  // A 6 s track keeps going past its end (loop points 1 → 5 s).
  await page.waitForTimeout(6_500);
  expect((await state(page)).music).toBe('lofi-lounge');
  expect((await state(page)).musicPaused).toBe(false);

  // Off stops it.
  await page.getByTestId('music-track-off').click();
  await expect.poll(async () => (await state(page)).music, { timeout: 5_000 }).toBeNull();

  // Taps decode the real files (the trimmed lead-in is unit-tested).
  await page.getByTestId('toggle-haptics').click();
  await page.getByTestId('toggle-haptics').click();
  await expect.poll(async () => (await state(page)).ready, { timeout: 5_000 }).toBeGreaterThan(0);
  expect(await log(page)).toEqual(expect.arrayContaining(['ui.toggleOff', 'ui.toggleOn']));
  expect(errors).toEqual([]);
});
