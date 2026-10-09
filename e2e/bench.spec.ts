import { expect, test, type Page } from '@playwright/test';

// The on-device bench (/bench): it plays all 13 scenes on an in-memory session and produces the
// JSON users paste back to us. It must never touch the user's saved game, roster or settings.
// Short windows (?window=2500) keep this under a few minutes under SwiftShader.
test.setTimeout(8 * 60_000);
test.skip(({ browserName }) => browserName !== 'chromium', 'WebGL bench runs on Chromium here');

/**
 * The persisted session as stored (a JSON string in idb-keyval's default store), or null. Page-side
 * code as a string: the e2e tsconfig has no DOM lib.
 */
const savedSession = (page: Page) =>
  page.evaluate<string | null>(`new Promise((resolve, reject) => {
    const open = indexedDB.open('keyval-store');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('keyval')) return resolve(null);
      const get = db.transaction('keyval', 'readonly').objectStore('keyval').get('inuman.session');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result ?? null);
    };
  })`);

const storedApp = (page: Page) =>
  page.evaluate(() =>
    ['inuman.players', 'inuman.settings', 'inuman.rules', 'inuman.theme'].map((k) =>
      localStorage.getItem(k),
    ),
  );

test('bench runs all 13 scenes, produces results JSON, and leaves the saved game alone', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // A real game in progress: the bench must not change it.
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('nav-players').click();
  for (const name of ['Migs', 'Bea', 'Jun']) {
    await page.getByTestId('player-name').fill(name);
    await page.getByTestId('add-player').click();
  }
  await page.goto('/games/higher-lower');
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('deck-count')).toContainText('51');
  await page.getByTestId('guess-higher').click();
  await expect(page.getByTestId('deck-count')).toContainText('50');
  // The guess has reached IndexedDB (persist writes are async).
  await expect.poll(() => savedSession(page)).toContain('"seq":1');
  const sessionBefore = await savedSession(page);
  const appBefore = await storedApp(page);
  expect(sessionBefore).not.toBeNull();

  await page.goto('/bench?window=2500');
  await expect(page.getByTestId('bench-device')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('bench-start')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('bench-start').click();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-state', 'running');
  await expect(page.getByTestId('bench-progress')).toContainText('/13');
  await expect(page.getByTestId('bench')).toHaveAttribute('data-state', 'idle', {
    timeout: 7 * 60_000,
  });

  // Results: the table and the compact JSON (one row per scene, all 13 games).
  await expect(page.getByTestId('bench-row')).toHaveCount(13);
  const json = JSON.parse(await page.getByTestId('bench-json').inputValue()) as {
    inumanBench: number;
    cols: string[];
    scenes: unknown[][];
    device: { ua: string; gpu: string | null; appTier: string | null };
  };
  expect(json.inumanBench).toBe(1);
  expect(json.device.ua).toContain('Mozilla');
  const col = (name: string) => json.cols.indexOf(name);
  expect(new Set(json.scenes.map((r) => r[0])).size).toBe(13);
  for (const row of json.scenes) {
    expect(
      row.length,
      `${String(row[0])} reported an error: ${String(row[json.cols.length])}`,
    ).toBe(json.cols.length);
    expect(row[col('firstRenderMs')], `${String(row[0])} first render`).not.toBeNull();
    expect(row[col('fps')] as number, `${String(row[0])} frames`).toBeGreaterThan(0);
    expect(row[col('calls')] as number, `${String(row[0])} draw calls`).toBeGreaterThan(0);
    expect(row[col('actions')] as number, `${String(row[0])} played`).toBeGreaterThan(0);
  }
  // Kept for the next visit.
  expect(await page.evaluate(() => localStorage.getItem('inuman.bench.last'))).toContain(
    '"scenes"',
  );

  // The saved game, roster and settings are exactly as they were.
  expect(await savedSession(page)).toBe(sessionBefore);
  expect(await storedApp(page)).toEqual(appBefore);

  // Leaving the bench (full reload) resumes the real game where it was.
  await page.goto('/');
  await page.getByTestId('resume').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('deck-count')).toContainText('50');
  expect(errors).toEqual([]);
});

test('?perf=1 shows the frame overlay during play and ?perf=0 turns it off', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  await page.getByTestId('nav-players').click();
  await page.getByTestId('player-name').fill('Migs');
  await page.getByTestId('add-player').click();
  await page.goto('/games/higher-lower?perf=1');
  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
  // Remembered across navigation (the flag lives in localStorage), and it shows live numbers.
  await expect(page.getByTestId('perf-overlay')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('guess-higher').click();
  await expect(page.getByTestId('perf-overlay')).toContainText(/calls/);
  await page.goto('/?perf=0');
  await expect(page.getByTestId('home')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('inuman.perf'))).toBeNull();
  await expect(page.getByTestId('perf-overlay')).toHaveCount(0);
});
