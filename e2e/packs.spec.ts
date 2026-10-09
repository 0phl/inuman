import { expect, test, type Page } from '@playwright/test';

/** Through the 18+ gate; optionally seat a few players. */
async function enter(page: Page, names: string[] = []) {
  await page.goto('/');
  await page.getByTestId('age-yes').click();
  await expect(page.getByTestId('home')).toBeVisible();
  if (!names.length) return;
  await page.getByTestId('nav-players').click();
  for (const name of names) {
    await page.getByTestId('player-name').fill(name);
    await page.getByTestId('add-player').click();
  }
  await expect(page.getByTestId('player-row')).toHaveCount(names.length);
}

/** Packs → "Gumawa ng sariling pack" → name + NHIE + one prompt per line → editor. */
async function createNhiePack(page: Page, name: string, prompts: string[]) {
  await page.goto('/');
  await page.getByTestId('nav-packs').click();
  await expect(page.getByTestId('packs')).toBeVisible();
  await page.getByTestId('new-pack').click();
  await page.getByTestId('new-pack-name').fill(name);
  await page.getByTestId('new-pack-game-never-have-i-ever').click();
  await page.getByTestId('new-pack-lines').fill(prompts.join('\n'));
  await page.getByTestId('new-pack-create').click();
  await expect(page.getByTestId('pack-editor')).toBeVisible();
  await expect(page.getByTestId('item-row')).toHaveCount(prompts.length);
  await expect(page.getByTestId('pack-name')).toHaveValue(name);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('custom NHIE pack: create 3 prompts, then play with only that pack', async ({ page }) => {
  const prompts = [
    'Never have I ever kumain ng balut sa Tagaytay.',
    'Never have I ever nag-videoke ng Bohemian Rhapsody nang buo.',
    'Never have I ever nawalan ng tsinelas sa baha.',
  ];
  await enter(page, ['Migs', 'Bea', 'Jun']);
  await createNhiePack(page, 'Pang-GC namin', prompts);

  await page.goto('/games/never-have-i-ever');
  const picker = page.getByTestId('content-picker');
  const custom = picker.getByTestId('custom-packs').locator('[data-testid^="pack-custom-"]');
  await expect(custom).toHaveCount(1);
  await expect(custom).toContainText('Pang-GC namin');

  // Only our pack: drop the default built-in, pick ours.
  const builtin = page.getByTestId('pack-builtin-nhie');
  await expect(builtin).toHaveAttribute('aria-pressed', 'true');
  await builtin.click();
  await custom.click();
  await expect(builtin).toHaveAttribute('aria-pressed', 'false');
  await expect(custom).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('prompt-count')).toContainText('3');

  // The pick is remembered when the lobby is opened again.
  await page.reload();
  await expect(custom).toHaveAttribute('aria-pressed', 'true');
  await expect(builtin).toHaveAttribute('aria-pressed', 'false');

  await page.getByTestId('start-game').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('nhie-prompt')).toContainText(
    new RegExp(prompts.map(escape).join('|')),
    { timeout: 15_000 },
  );
});

test('share link: preview on a friend’s phone, save as a new pack, listed', async ({
  page,
  browser,
}) => {
  await enter(page);
  await createNhiePack(page, 'Pasa-pasa pack', [
    'Never have I ever nag-{random} ng sorry.',
    'Never have I ever nakalimutan ang birthday ni {left}.',
    'Never have I ever natulog sa inuman.',
  ]);

  await page.getByTestId('share-pack').click();
  const sheet = page.getByTestId('share-sheet');
  await expect(sheet.getByTestId('share-body')).toHaveAttribute('data-method', 'qr');
  await expect(sheet.getByTestId('share-qr')).toHaveAttribute('data-state', 'ready');
  const url = await sheet.getByTestId('share-link').inputValue();
  expect(url).toMatch(/\/import#s=1\.[A-Za-z0-9_-]+$/);

  // A fresh browser profile stands in for a friend's phone.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const friend = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  try {
    const p2 = await friend.newPage();
    await p2.goto(url);
    await p2.getByTestId('age-yes').click();
    await expect(p2.getByTestId('import-preview')).toBeVisible();
    await expect(p2.getByTestId('import-name')).toHaveText('Pasa-pasa pack');
    await expect(p2.getByTestId('import-count')).toContainText('3');
    await expect(p2.getByTestId('import-items').locator('li')).toHaveCount(3);
    await p2.getByTestId('import-save').click();
    await expect(p2.getByTestId('import-done')).toBeVisible();
    await p2.getByTestId('import-to-packs').click();

    const mine = p2.getByTestId('packs-group-never-have-i-ever').locator('[data-builtin="false"]');
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('Pasa-pasa pack');
    await expect(mine).toContainText('3 prompts');
  } finally {
    await friend.close();
  }
});

test('a corrupted or wrong-version link shows a friendly error', async ({ page }) => {
  await enter(page);
  await page.goto('/import#s=1.H4sIAAAA_putol-na-link');
  const error = page.getByTestId('import-error');
  await expect(error).toHaveAttribute('data-error', 'share.corrupt');
  await expect(error).toContainText('Sira ang link');
  await expect(page.getByTestId('import-save')).toHaveCount(0);

  await page.goto('/');
  await page.goto('/import#s=9.abc');
  await expect(error).toHaveAttribute('data-error', 'share.badVersion');
});

test('download .dgpack.json, then import the file on another phone', async ({ page, browser }) => {
  await enter(page);
  await createNhiePack(page, 'Pang/File: "Inuman"', ['Never have I ever nag-file transfer.']);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-pack').click(),
  ]);
  expect(download.suggestedFilename()).toBe('Pang File Inuman.dgpack.json');
  const file = test.info().outputPath('pack.dgpack.json');
  await download.saveAs(file);

  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const friend = await browser.newContext({
    viewport,
    userAgent,
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  try {
    const p2 = await friend.newPage();
    await p2.goto('/');
    await p2.getByTestId('age-yes').click();
    await p2.goto('/packs');
    await p2.getByTestId('import-file').setInputFiles(file);
    await expect(p2.getByTestId('import-name')).toHaveText('Pang/File: "Inuman"');
    await p2.getByTestId('import-save').click();
    await p2.getByTestId('import-to-packs').click();
    await expect(p2.getByTestId('file-import-sheet')).toBeHidden();
    await expect(
      p2.getByTestId('packs-group-never-have-i-ever').locator('[data-builtin="false"]'),
    ).toContainText('Pang/File');

    // A file that isn't a pack gets the same friendly errors as a bad link.
    await p2.getByTestId('import-file').setInputFiles({
      name: 'sira.dgpack.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"kind":"pack"'),
    });
    await expect(p2.getByTestId('import-error')).toHaveAttribute('data-error', 'share.corrupt');
  } finally {
    await friend.close();
  }
});
