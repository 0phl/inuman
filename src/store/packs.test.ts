import 'fake-indexeddb/auto';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PACKS } from '@/core/content/builtin';
import { PromptPackSchema, type PromptPack } from '@/core/content/schemas';
import {
  allPacksFor,
  copyPack,
  CUSTOM_ID,
  defaultPackIds,
  MAX_TEXT,
  migratePacks,
  newItemId,
  packFileJson,
  packFileName,
  parseLines,
  parsePackFile,
  resolvePicks,
  sanitizePacks,
  sanitizePicks,
  spiceSpread,
  unknownPlaceholders,
  usePacks,
  withItemMoved,
  withItemRemoved,
  withItemsAdded,
  withItemUpdated,
} from './packs';

const persistSpy = vi.fn(async () => true);
beforeAll(() => {
  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { persist: persistSpy },
    configurable: true,
  });
});

const pack = (over: Partial<PromptPack> = {}): PromptPack => ({
  schema: 1,
  kind: 'pack',
  id: 'custom-abcd1234',
  name: 'Pang-GC',
  game: 'never-have-i-ever',
  locale: 'taglish',
  builtin: false,
  items: [
    { id: 'a1', text: 'Never have I ever nag-ghost.', spice: 0 },
    { id: 'a2', text: 'Never have I ever nag-drunk text.', spice: 2 },
  ],
  ...over,
});

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('ids and parsing helpers', () => {
  it('makes custom-<8> pack ids and short unique item ids', () => {
    const copy = copyPack(BUILTIN_PACKS[0] as PromptPack);
    expect(copy.id).toMatch(CUSTOM_ID);
    expect(newItemId().length).toBeLessThanOrEqual(12);
    const ids = copy.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => BUILTIN_PACKS[0]?.items.some((b) => b.id === id))).toBe(false);
    expect(copy.builtin).toBe(false);
    expect(PromptPackSchema.safeParse(copy).success).toBe(true);
  });

  it('splits pasted lines, strips bullets, flags long ones', () => {
    const long = 'x'.repeat(MAX_TEXT + 1);
    const { lines, tooLong } = parseLines(`- uno\n\n  2. dos \r\n• tres\n${long}\n   \n`);
    expect(lines).toEqual(['uno', 'dos', 'tres']);
    expect(tooLong).toEqual([long]);
  });

  it('counts the spice spread', () => {
    expect(spiceSpread([{ spice: 0 }, { spice: 2 }, { spice: 2 }, { spice: 3 }])).toEqual([
      1, 0, 2, 1,
    ]);
  });

  it('spots unknown placeholders', () => {
    expect(unknownPlaceholders('Si {player} at {plyer} at {right}')).toEqual(['{plyer}']);
  });

  it('builds a safe .dgpack.json file name', () => {
    expect(packFileName('Pang/GC: "Inuman"?')).toBe('Pang GC Inuman.dgpack.json');
    expect(packFileName('...')).toBe('pack.dgpack.json');
    expect(packFileName('Barkada 🍻')).toBe('Barkada 🍻.dgpack.json');
  });

  it('round-trips the pack file and maps errors to codec keys', () => {
    const p = pack();
    const json = packFileJson(p);
    expect(json).toContain('\n  "name"');
    expect(json).not.toContain('builtin');
    expect(unwrap(parsePackFile(json)).name).toBe('Pang-GC');
    expect(parsePackFile('{nope')).toEqual({ ok: false, error: 'share.corrupt' });
    expect(parsePackFile('{"kind":"pack"}')).toEqual({ ok: false, error: 'share.invalid' });
    expect(parsePackFile(' '.repeat(1024 * 1024 + 1))).toEqual({
      ok: false,
      error: 'share.tooLarge',
    });
  });
});

describe('pure pack edits', () => {
  it('adds items at the top with defaults per game', () => {
    const p = unwrap(withItemsAdded(pack(), [{ text: '  bago  ' }, { text: 'isa pa', spice: 3 }]));
    expect(p.items.map((i) => i.text)).toEqual([
      'bago',
      'isa pa',
      'Never have I ever nag-ghost.',
      'Never have I ever nag-drunk text.',
    ]);
    expect(p.items[0]?.spice).toBe(1);
    expect(p.items[0]?.kind).toBeUndefined();
    const tod = unwrap(withItemsAdded(pack({ game: 'truth-or-dare' }), [{ text: 'Truth?' }]));
    expect(tod.items[0]?.kind).toBe('truth');
  });

  it('rejects empty and over-long text', () => {
    expect(withItemsAdded(pack(), [{ text: '   ' }])).toEqual({
      ok: false,
      error: 'packs.error.emptyText',
    });
    expect(withItemsAdded(pack(), [{ text: 'x'.repeat(MAX_TEXT + 1) }])).toEqual({
      ok: false,
      error: 'packs.error.textTooLong',
    });
  });

  it('updates text, spice, kind and sips (null clears sips)', () => {
    let p = unwrap(withItemUpdated(pack(), 'a1', { text: 'bago ', spice: 3, sips: 4 }));
    expect(p.items[0]).toEqual({ id: 'a1', text: 'bago', spice: 3, sips: 4 });
    p = unwrap(withItemUpdated(p, 'a1', { sips: null, kind: 'dare' }));
    expect(p.items[0]).toEqual({ id: 'a1', text: 'bago', spice: 3, kind: 'dare' });
    expect(withItemUpdated(p, 'a1', { text: '' })).toEqual({
      ok: false,
      error: 'packs.error.emptyText',
    });
    expect(withItemUpdated(p, 'zz', { text: 'x' })).toMatchObject({ ok: false });
  });

  it('removes (never the last item) and reorders', () => {
    const p = unwrap(withItemRemoved(pack(), 'a1'));
    expect(p.items.map((i) => i.id)).toEqual(['a2']);
    expect(withItemRemoved(p, 'a2')).toEqual({ ok: false, error: 'packs.error.lastItem' });
    expect(withItemMoved(pack(), 'a2', -1).items.map((i) => i.id)).toEqual(['a2', 'a1']);
    expect(withItemMoved(pack(), 'a1', -1).items.map((i) => i.id)).toEqual(['a1', 'a2']);
  });
});

describe('sanitizePacks / migrate', () => {
  it('drops invalid, duplicate and built-in-id packs and counts them', () => {
    const good = pack();
    const res = sanitizePacks([
      good,
      { ...good },
      { ...good, id: 'custom-zzzz9999', items: [] },
      { ...good, id: BUILTIN_PACKS[0]?.id },
      'garbage',
    ]);
    expect(res.packs).toHaveLength(1);
    expect(res.dropped).toBe(4);
    expect(sanitizePacks(undefined)).toEqual({ packs: [], dropped: 0 });
    expect(sanitizePacks({})).toEqual({ packs: [], dropped: 1 });
  });

  it('migrates anything to the current shape and warns about drops', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(migratePacks({ packs: [pack(), { bad: true }], persistAsked: true }, 0)).toEqual({
      packs: [pack()],
      persistAsked: true,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(migratePacks(null, 0)).toEqual({ packs: [], persistAsked: false });
    warn.mockRestore();
  });
});

describe('selectors and lobby picks', () => {
  it('allPacksFor = built-ins + custom for a game, memoized', () => {
    const custom = [pack(), pack({ id: 'custom-tod00000', game: 'truth-or-dare' })];
    const state = { packs: custom };
    const sel = allPacksFor('never-have-i-ever');
    const out = sel(state);
    expect(out.map((p) => p.id)).toEqual([
      ...BUILTIN_PACKS.filter((p) => p.game === 'never-have-i-ever').map((p) => p.id),
      'custom-abcd1234',
    ]);
    expect(allPacksFor('never-have-i-ever')(state)).toBe(out);
    expect(allPacksFor('never-have-i-ever', 'en')(state).every((p) => p.locale !== 'taglish')).toBe(
      true,
    );
    expect(allPacksFor(undefined)(state)).toEqual([]);
  });

  it('remembers picks, drops deleted packs, and falls back to defaults', () => {
    const packs = allPacksFor('never-have-i-ever')({ packs: [pack()] });
    const defaults = defaultPackIds(packs, 'taglish');
    expect(defaults).toEqual(['builtin-nhie']);
    expect(resolvePicks(undefined, packs, 'taglish', true)).toEqual(defaults);
    expect(resolvePicks(['custom-abcd1234', 'custom-gone0000'], packs, 'taglish', true)).toEqual([
      'custom-abcd1234',
    ]);
    expect(resolvePicks(['custom-gone0000'], packs, 'taglish', true)).toEqual(defaults);
    expect(resolvePicks([], packs, 'taglish', true)).toEqual([]);
    // Custom packs not loaded yet: keep the stored pick as-is.
    expect(resolvePicks(['custom-later000'], packs, 'taglish', false)).toEqual(['custom-later000']);
  });

  it('sanitizes stored picks', () => {
    expect(
      sanitizePicks({ 'never-have-i-ever': ['a', 'a', 3, 'b'], 'kings-cup': ['x'], nope: 1 }),
    ).toEqual({ 'never-have-i-ever': ['a', 'b'] });
  });

  it('turns picks of the old Filipino / English built-in packs into the bilingual one', () => {
    expect(
      sanitizePicks({
        'never-have-i-ever': ['builtin-nhie-taglish', 'builtin-nhie-en', 'custom-abcd1234'],
        'truth-or-dare': ['builtin-tod-en'],
      }),
    ).toEqual({
      'never-have-i-ever': ['builtin-nhie', 'custom-abcd1234'],
      'truth-or-dare': ['builtin-tod'],
    });
  });
});

describe('usePacks store (IndexedDB)', () => {
  const ready = async () => {
    await usePacks.persist.rehydrate();
    expect(usePacks.getState().hydrated).toBe(true);
  };
  const stored = async () =>
    (await idbGet<{ state: { packs: PromptPack[]; persistAsked: boolean } }>('inuman.packs'))
      ?.state;

  beforeEach(async () => {
    await idbSet('inuman.packs', { state: { packs: [], persistAsked: false }, version: 1 });
    await ready();
    persistSpy.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates a valid custom pack, persists it, and asks for persistent storage once', async () => {
    const s = usePacks.getState();
    const id = unwrap(
      s.create({
        name: ' Pang-GC ',
        game: 'never-have-i-ever',
        locale: 'taglish',
        items: [{ text: 'isa' }, { text: 'dalawa' }, { text: 'tatlo' }],
      }),
    );
    expect(id).toMatch(CUSTOM_ID);
    const created = usePacks.getState().packs[0];
    expect(created).toMatchObject({ name: 'Pang-GC', builtin: false });
    expect(created?.items.map((i) => i.text)).toEqual(['isa', 'dalawa', 'tatlo']);
    expect(persistSpy).toHaveBeenCalledOnce();

    unwrap(
      usePacks.getState().create({
        name: 'Isa pa',
        game: 'most-likely-to',
        locale: 'any',
        items: [{ text: 'x' }],
      }),
    );
    expect(persistSpy).toHaveBeenCalledOnce();

    await vi.waitFor(async () => expect((await stored())?.packs).toHaveLength(2));
    expect((await stored())?.persistAsked).toBe(true);
  });

  it('validates create input', () => {
    const { create } = usePacks.getState();
    const base = { game: 'never-have-i-ever', locale: 'en', items: [{ text: 'x' }] } as const;
    expect(create({ ...base, name: '  ' })).toEqual({ ok: false, error: 'packs.error.emptyName' });
    expect(create({ ...base, name: 'x'.repeat(61) })).toEqual({
      ok: false,
      error: 'packs.error.nameTooLong',
    });
    expect(create({ ...base, name: 'ok', items: [] })).toEqual({
      ok: false,
      error: 'packs.error.needItem',
    });
    expect(usePacks.getState().packs).toHaveLength(0);
  });

  it('duplicates a built-in into an editable copy, then edits, renames and deletes it', () => {
    const builtin = BUILTIN_PACKS[0] as PromptPack;
    const id = unwrap(usePacks.getState().duplicate(builtin.id, `${builtin.name} (kopya)`));
    const s = usePacks.getState();
    const copy = s.packs.find((p) => p.id === id) as PromptPack;
    expect(copy.items).toHaveLength(builtin.items.length);
    expect(copy.name).toBe(`${builtin.name} (kopya)`);

    const first = copy.items[0]?.id as string;
    expect(s.updateItem(id, first, { text: 'Binago ko', spice: 0 })).toBeNull();
    expect(s.addItems(id, [{ text: 'Bago' }])).toBeNull();
    s.moveItem(id, first, -1);
    expect(s.update(id, { name: 'Amin na', locale: 'any' })).toBeNull();
    expect(s.update(id, { name: '' })).toBe('packs.error.emptyName');
    const after = usePacks.getState().packs.find((p) => p.id === id) as PromptPack;
    expect(after.name).toBe('Amin na');
    expect(after.locale).toBe('any');
    expect(after.items[0]?.text).toBe('Binago ko');
    expect(after.items[1]?.text).toBe('Bago');
    expect(s.removeItem(id, first)).toBeNull();
    expect(usePacks.getState().packs[0]?.items).toHaveLength(builtin.items.length);

    // Built-ins themselves are read-only.
    expect(s.updateItem(builtin.id, builtin.items[0]?.id as string, { text: 'x' })).toBe(
      'packs.error.notFound',
    );

    usePacks.getState().remove(id);
    expect(usePacks.getState().packs).toHaveLength(0);
  });

  it('imports as a new copy every time (never overwrites)', () => {
    const shared = pack();
    const a = unwrap(usePacks.getState().importPack(shared));
    const b = unwrap(usePacks.getState().importPack(shared));
    expect(a).not.toBe(b);
    expect(a).not.toBe(shared.id);
    expect(usePacks.getState().packs.map((p) => p.name)).toEqual(['Pang-GC', 'Pang-GC']);
  });

  it('drops invalid stored packs on load with a console warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await idbSet('inuman.packs', {
      state: { packs: [pack(), { ...pack({ id: 'custom-bad00000' }), items: [] }] },
      version: 1,
    });
    await ready();
    expect(usePacks.getState().packs.map((p) => p.id)).toEqual(['custom-abcd1234']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1'));
  });

  it('migrates an older stored version', async () => {
    await idbSet('inuman.packs', { state: { packs: [pack()] }, version: 0 });
    await ready();
    expect(usePacks.getState().packs).toHaveLength(1);
    await vi.waitFor(async () =>
      expect(await idbGet<{ version: number }>('inuman.packs')).toMatchObject({ version: 1 }),
    );
  });
});
