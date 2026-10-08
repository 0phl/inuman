import { create } from 'zustand';
import { createJSONStorage, persist, type PersistStorage } from 'zustand/middleware';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { BUILTIN_PACKS } from '@/core/content/builtin';
import {
  LOCALES,
  PACK_GAMES,
  PromptItemSchema,
  PromptPackSchema,
  type Locale,
  type PackGame,
  type PromptItem,
  type PromptPack,
} from '@/core/content/schemas';

// Custom prompt packs ("Gawa ng barkada"). Stored in IndexedDB; every pack in memory is valid
// against PromptPackSchema, so a pack can always be dealt, shared or exported as-is.

export const MAX_ITEMS = 1000;
export const MAX_TEXT = 280;
export const MAX_PACK_NAME = 60;
export const MAX_CUSTOM_PACKS = 200;
/** Largest `.dgpack.json` the file importer reads. */
export const PACK_FILE_MAX_BYTES = 1024 * 1024;
export const PLACEHOLDERS = ['{player}', '{random}', '{left}', '{right}'] as const;
export const PACK_LOCALES = [...LOCALES, 'any'] as const;
export type PackLocale = (typeof PACK_LOCALES)[number];
export type ItemKind = NonNullable<PromptItem['kind']>;
export const ITEM_KINDS: readonly ItemKind[] = ['truth', 'dare', 'prompt'];

/** What the editor hands the store for a new or changed item. */
export interface ItemDraft {
  text: string;
  spice?: number;
  kind?: ItemKind;
  /** null clears it (the game's default applies). */
  sips?: number | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ── ids ──────────────────────────────────────────────────────────────────────

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function randomId(len: number): string {
  let out = '';
  for (const b of crypto.getRandomValues(new Uint8Array(len))) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const CUSTOM_ID = /^custom-[a-z0-9]{8}$/;
export const newPackId = (): string => `custom-${randomId(8)}`;
/**
 * Item ids are unique across packs too: `collectPrompts` keeps the first item per id, so a copy of
 * a built-in must not reuse the built-in's ids or its edits would be shadowed.
 */
export const newItemId = (): string => `c${randomId(9)}`;

const isPackGame = (v: unknown): v is PackGame => (PACK_GAMES as readonly unknown[]).includes(v);
const isPackLocale = (v: unknown): v is PackLocale =>
  (PACK_LOCALES as readonly unknown[]).includes(v);

// ── validation ───────────────────────────────────────────────────────────────

export function nameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'packs.error.emptyName';
  if (name.length > MAX_PACK_NAME) return 'packs.error.nameTooLong';
  return null;
}

export function textError(raw: string): string | null {
  const text = raw.trim();
  if (!text) return 'packs.error.emptyText';
  if (text.length > MAX_TEXT) return 'packs.error.textTooLong';
  return null;
}

/** `{...}` tokens that the games don't fill in (likely typos like `{plyer}`). */
export function unknownPlaceholders(text: string): string[] {
  const found = text.match(/\{[^{}\s]{0,20}\}/g) ?? [];
  return [...new Set(found.filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p)))];
}

const clampSpice = (n: unknown, fallback = 1): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(3, Math.max(0, Math.round(n))) : fallback;

function buildItem(draft: ItemDraft, id: string, game: PackGame): Result<PromptItem> {
  const err = textError(draft.text);
  if (err) return fail(err);
  const kind = draft.kind ?? (game === 'truth-or-dare' ? 'truth' : undefined);
  const parsed = PromptItemSchema.safeParse({
    id,
    text: draft.text.trim(),
    spice: clampSpice(draft.spice),
    ...(kind ? { kind } : {}),
    ...(typeof draft.sips === 'number' ? { sips: draft.sips } : {}),
  });
  return parsed.success ? { ok: true, value: parsed.data } : fail('packs.error.badItem');
}

/** Drops anything that isn't a valid custom pack; reports how many were dropped. */
export function sanitizePacks(raw: unknown): { packs: PromptPack[]; dropped: number } {
  if (raw === undefined || raw === null) return { packs: [], dropped: 0 };
  if (!Array.isArray(raw)) return { packs: [], dropped: 1 };
  const builtinIds = new Set(BUILTIN_PACKS.map((p) => p.id));
  const seen = new Set<string>();
  const packs: PromptPack[] = [];
  let dropped = 0;
  for (const item of raw) {
    const parsed = PromptPackSchema.safeParse(item);
    if (
      !parsed.success ||
      builtinIds.has(parsed.data.id) ||
      seen.has(parsed.data.id) ||
      packs.length >= MAX_CUSTOM_PACKS
    ) {
      dropped++;
      continue;
    }
    seen.add(parsed.data.id);
    packs.push({ ...parsed.data, builtin: false });
  }
  return { packs, dropped };
}

// ── pure pack edits ──────────────────────────────────────────────────────────

/** A fresh custom copy: new pack id, new item ids, never marked built-in. */
export function copyPack(src: PromptPack, name?: string): PromptPack {
  const ids = new Set<string>();
  const items = src.items.map((item) => {
    let id = newItemId();
    while (ids.has(id)) id = newItemId();
    ids.add(id);
    return { ...item, id };
  });
  const finalName = (name ?? src.name).trim().slice(0, MAX_PACK_NAME) || src.name;
  return { ...src, id: newPackId(), name: finalName, builtin: false, items };
}

function freshIds(pack: PromptPack, count: number): string[] {
  const taken = new Set(pack.items.map((i) => i.id));
  const out: string[] = [];
  while (out.length < count) {
    const id = newItemId();
    if (taken.has(id)) continue;
    taken.add(id);
    out.push(id);
  }
  return out;
}

/** Adds items at the top (newest first, in the given order). */
export function withItemsAdded(pack: PromptPack, drafts: readonly ItemDraft[]): Result<PromptPack> {
  if (drafts.length === 0) return fail('packs.error.emptyText');
  if (pack.items.length + drafts.length > MAX_ITEMS) return fail('packs.error.tooMany');
  const ids = freshIds(pack, drafts.length);
  const items: PromptItem[] = [];
  for (const [i, d] of drafts.entries()) {
    const built = buildItem(d, ids[i] as string, pack.game);
    if (!built.ok) return built;
    items.push(built.value);
  }
  return { ok: true, value: { ...pack, items: [...items, ...pack.items] } };
}

export function withItemUpdated(
  pack: PromptPack,
  itemId: string,
  patch: Partial<ItemDraft>,
): Result<PromptPack> {
  const idx = pack.items.findIndex((i) => i.id === itemId);
  const cur = pack.items[idx];
  if (!cur) return fail('packs.error.notFound');
  const { sips: curSips, kind: curKind, ...rest } = cur;
  const sips = patch.sips === undefined ? curSips : (patch.sips ?? undefined);
  const kind = patch.kind ?? curKind;
  const parsed = PromptItemSchema.safeParse({
    ...rest,
    text: (patch.text ?? cur.text).trim(),
    spice: patch.spice === undefined ? cur.spice : clampSpice(patch.spice),
    ...(kind ? { kind } : {}),
    ...(sips !== undefined ? { sips } : {}),
  });
  if (!parsed.success) return fail(textError(patch.text ?? cur.text) ?? 'packs.error.badItem');
  const items = pack.items.slice();
  items[idx] = parsed.data;
  return { ok: true, value: { ...pack, items } };
}

export function withItemRemoved(pack: PromptPack, itemId: string): Result<PromptPack> {
  if (!pack.items.some((i) => i.id === itemId)) return fail('packs.error.notFound');
  if (pack.items.length <= 1) return fail('packs.error.lastItem');
  return { ok: true, value: { ...pack, items: pack.items.filter((i) => i.id !== itemId) } };
}

export function withItemMoved(pack: PromptPack, itemId: string, dir: -1 | 1): PromptPack {
  const i = pack.items.findIndex((x) => x.id === itemId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= pack.items.length) return pack;
  const items = pack.items.slice();
  [items[i], items[j]] = [items[j] as PromptItem, items[i] as PromptItem];
  return { ...pack, items };
}

/** "Paste many lines": one item per non-empty line; common list bullets are stripped. */
export function parseLines(text: string): { lines: string[]; tooLong: string[] } {
  const lines: string[] = [];
  const tooLong: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•–]|\d{1,3}[.)])\s+/, '').trim();
    if (!line) continue;
    (line.length > MAX_TEXT ? tooLong : lines).push(line);
  }
  return { lines, tooLong };
}

/** How many items sit at each spice level 0..3. */
export function spiceSpread(
  items: readonly Pick<PromptItem, 'spice'>[],
): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (const i of items) {
    const level = clampSpice(i.spice) as 0 | 1 | 2 | 3;
    out[level] += 1;
  }
  return out;
}

// ── files ────────────────────────────────────────────────────────────────────

/** The shareable shape of a pack (no `builtin` flag). */
export function exportable(pack: PromptPack): PromptPack {
  const { builtin: _builtin, ...rest } = pack;
  return rest;
}

export const packFileJson = (pack: PromptPack): string =>
  `${JSON.stringify(exportable(pack), null, 2)}\n`;

/** `<name>.dgpack.json`, with characters that file systems reject removed. */
export function packFileName(name: string): string {
  const printable = [...name].map((c) => ((c.codePointAt(0) ?? 0) < 32 ? ' ' : c)).join('');
  const base = printable
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, MAX_PACK_NAME);
  return `${base || 'pack'}.dgpack.json`;
}

/** Validates a `.dgpack.json` file's text. Error keys match the share codec's. */
export function parsePackFile(text: string): Result<PromptPack> {
  if (new Blob([text]).size > PACK_FILE_MAX_BYTES) return fail('share.tooLarge');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('share.corrupt');
  }
  const parsed = PromptPackSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : fail('share.invalid');
}

// ── store ────────────────────────────────────────────────────────────────────

interface PacksData {
  packs: PromptPack[];
  /** navigator.storage.persist() is asked for once, when the first custom pack is made. */
  persistAsked: boolean;
}

export interface PacksState extends PacksData {
  /** True once IndexedDB has been read. Edits wait for it so they can't clobber stored packs. */
  hydrated: boolean;
  /** Returns the new pack's id. */
  create(input: {
    name: string;
    game: PackGame;
    locale: PackLocale;
    items: readonly ItemDraft[];
  }): Result<string>;
  /** Name / game / locale. */
  update(id: string, patch: { name?: string; game?: PackGame; locale?: PackLocale }): string | null;
  remove(id: string): void;
  /** Copies a built-in or custom pack into a new editable custom pack; returns its id. */
  duplicate(id: string, name: string): Result<string>;
  /** Saves a shared/imported pack as a new custom pack (never overwrites); returns its id. */
  importPack(pack: PromptPack): Result<string>;
  addItems(id: string, drafts: readonly ItemDraft[]): string | null;
  updateItem(id: string, itemId: string, patch: Partial<ItemDraft>): string | null;
  removeItem(id: string, itemId: string): string | null;
  moveItem(id: string, itemId: string, dir: -1 | 1): void;
}

const warnWrite = (e: unknown) => console.warn('[packs] could not write to IndexedDB', e);

/**
 * Plain-object IndexedDB storage (structured clone, no JSON round-trip). Write failures (private
 * mode, quota) are logged instead of surfacing as unhandled rejections on every edit.
 */
const idbStorage: PersistStorage<PacksData> = {
  getItem: async (name) => (await idbGet(name)) ?? null,
  setItem: async (name, value) => {
    try {
      await idbSet(name, value);
    } catch (e) {
      warnWrite(e);
    }
  },
  removeItem: async (name) => {
    try {
      await del(name);
    } catch (e) {
      warnWrite(e);
    }
  },
};

function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // Not supported (or not a secure context): packs still save, just evictable.
  }
}

export const PACKS_VERSION = 1;

/** Migrates any stored shape to the current one. v0 never shipped. */
export function migratePacks(persisted: unknown, _version: number): PacksData {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<
    Record<keyof PacksData, unknown>
  >;
  const { packs, dropped } = sanitizePacks(p.packs);
  if (dropped > 0) console.warn(`[packs] dropped ${dropped} invalid custom pack(s) from storage`);
  return { packs, persistAsked: p.persistAsked === true };
}

export const usePacks = create<PacksState>()(
  persist(
    (set, get) => {
      /** Applies a pure edit to one custom pack. */
      const edit = (id: string, fn: (p: PromptPack) => Result<PromptPack>): string | null => {
        if (!get().hydrated) return 'packs.error.loading';
        const pack = get().packs.find((p) => p.id === id);
        if (!pack) return 'packs.error.notFound';
        const res = fn(pack);
        if (!res.ok) return res.error;
        set((s) => ({ packs: s.packs.map((p) => (p.id === id ? res.value : p)) }));
        return null;
      };

      /** Adds a new, already-valid custom pack. */
      const add = (pack: PromptPack): Result<string> => {
        const s = get();
        if (!s.hydrated) return fail('packs.error.loading');
        if (s.packs.length >= MAX_CUSTOM_PACKS) return fail('packs.error.tooManyPacks');
        const parsed = PromptPackSchema.safeParse(pack);
        if (!parsed.success) return fail('share.invalid');
        const first = !s.persistAsked && s.packs.length === 0;
        if (first) requestPersistentStorage();
        set({
          packs: [{ ...parsed.data, builtin: false }, ...s.packs],
          persistAsked: s.persistAsked || first,
        });
        return { ok: true, value: parsed.data.id };
      };

      return {
        packs: [],
        persistAsked: false,
        hydrated: false,

        create({ name, game, locale, items }) {
          const err = nameError(name);
          if (err) return fail(err);
          if (!isPackGame(game) || !isPackLocale(locale)) return fail('packs.error.badItem');
          const shell: PromptPack = {
            schema: 1,
            kind: 'pack',
            id: newPackId(),
            name: name.trim(),
            game,
            locale,
            builtin: false,
            items: [],
          };
          if (items.length === 0) return fail('packs.error.needItem');
          const filled = withItemsAdded(shell, items);
          return filled.ok ? add(filled.value) : filled;
        },

        update(id, patch) {
          if (patch.name !== undefined) {
            const err = nameError(patch.name);
            if (err) return err;
          }
          if (patch.game !== undefined && !isPackGame(patch.game)) return 'packs.error.badItem';
          if (patch.locale !== undefined && !isPackLocale(patch.locale))
            return 'packs.error.badItem';
          return edit(id, (p) => ({
            ok: true,
            value: {
              ...p,
              ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
              ...(patch.game !== undefined ? { game: patch.game } : {}),
              ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
            },
          }));
        },

        remove(id) {
          if (!get().hydrated) return;
          set((s) => ({ packs: s.packs.filter((p) => p.id !== id) }));
        },

        duplicate(id, name) {
          const src = findPack(get().packs, id);
          if (!src) return fail('packs.error.notFound');
          const err = nameError(name);
          return add(copyPack(src, err ? undefined : name));
        },

        importPack(pack) {
          const parsed = PromptPackSchema.safeParse(pack);
          if (!parsed.success) return fail('share.invalid');
          return add(copyPack(parsed.data));
        },

        addItems: (id, drafts) => edit(id, (p) => withItemsAdded(p, drafts)),
        updateItem: (id, itemId, patch) => edit(id, (p) => withItemUpdated(p, itemId, patch)),
        removeItem: (id, itemId) => edit(id, (p) => withItemRemoved(p, itemId)),
        moveItem: (id, itemId, dir) => {
          edit(id, (p) => ({ ok: true, value: withItemMoved(p, itemId, dir) }));
        },
      };
    },
    {
      name: 'inuman.packs',
      version: PACKS_VERSION,
      storage: idbStorage,
      partialize: (s): PacksData => ({ packs: s.packs, persistAsked: s.persistAsked }),
      migrate: migratePacks,
      merge: (persisted, current) => {
        const data = migratePacks(persisted, PACKS_VERSION);
        // First load only: keep anything made before storage was read (edits are gated on
        // `hydrated`, so this is belt and braces). A later rehydrate takes storage as the truth.
        const ids = new Set(data.packs.map((p) => p.id));
        const early = current.hydrated ? [] : current.packs.filter((p) => !ids.has(p.id));
        return {
          ...current,
          packs: [...early, ...data.packs],
          persistAsked: data.persistAsked || current.persistAsked,
        };
      },
      onRehydrateStorage: () => () => {
        // Also runs when IndexedDB is unavailable: the app keeps working in memory.
        usePacks.setState({ hydrated: true });
      },
    },
  ),
);

// ── selectors ────────────────────────────────────────────────────────────────

/** A built-in or custom pack by id. */
export function findPack(custom: readonly PromptPack[], id: string): PromptPack | undefined {
  return BUILTIN_PACKS.find((p) => p.id === id) ?? custom.find((p) => p.id === id);
}

const EMPTY: PromptPack[] = [];
const selectorCache = new Map<string, { src: PromptPack[]; out: PromptPack[] }>();

/**
 * Selector: built-in packs (`BUILTIN_PACKS`) then custom packs for a game, optionally only those
 * in `locale` (or language-neutral). Memoized per game+locale so zustand sees a stable result.
 */
export const allPacksFor =
  (game: PackGame | undefined, locale?: PackLocale) =>
  (s: Pick<PacksState, 'packs'>): PromptPack[] => {
    if (!game) return EMPTY;
    const key = `${game}|${locale ?? ''}`;
    const hit = selectorCache.get(key);
    if (hit && hit.src === s.packs) return hit.out;
    const match = (p: PromptPack) =>
      p.game === game && (!locale || p.locale === locale || p.locale === 'any');
    const out = [...BUILTIN_PACKS.filter(match), ...s.packs.filter(match)];
    selectorCache.set(key, { src: s.packs, out });
    return out;
  };

// ── lobby picks ──────────────────────────────────────────────────────────────

/** Built-in packs that match the UI language (or are language-neutral); all of them if none do. */
export function defaultPackIds(packs: readonly PromptPack[], locale: Locale): string[] {
  const builtin = packs.filter((p) => p.builtin);
  const pool = builtin.length ? builtin : packs;
  const local = pool.filter((p) => p.locale === locale || p.locale === 'any');
  return (local.length ? local : pool).map((p) => p.id);
}

/**
 * The packs to preselect in a lobby: the last pick for this game, minus packs that no longer exist.
 * Falls back to the defaults when nothing was ever picked or every picked pack is gone.
 * Before custom packs have loaded, the stored pick is returned untouched.
 */
export function resolvePicks(
  stored: readonly string[] | undefined,
  packs: readonly PromptPack[],
  locale: Locale,
  hydrated: boolean,
): string[] {
  if (!stored) return defaultPackIds(packs, locale);
  if (!hydrated) return [...stored];
  const valid = stored.filter((id) => packs.some((p) => p.id === id));
  if (stored.length > 0 && valid.length === 0) return defaultPackIds(packs, locale);
  return valid;
}

interface PicksState {
  /** Last selected pack ids per prompt game. (The spice level lives in the rules store.) */
  byGame: Partial<Record<PackGame, string[]>>;
  setPicks(game: PackGame, ids: readonly string[]): void;
}

export function sanitizePicks(raw: unknown): PicksState['byGame'] {
  const out: PicksState['byGame'] = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [game, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPackGame(game) || !Array.isArray(ids)) continue;
    out[game] = [
      ...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length <= 40)),
    ].slice(0, 50);
  }
  return out;
}

/** Synchronous (localStorage) so the lobby renders the remembered choice on first paint. */
export const usePackPicks = create<PicksState>()(
  persist(
    (set) => ({
      byGame: {},
      setPicks: (game, ids) =>
        set((s) => ({ byGame: { ...s.byGame, [game]: [...new Set(ids)].slice(0, 50) } })),
    }),
    {
      name: 'inuman.packPicks',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byGame: s.byGame }),
      migrate: (persisted) => ({
        byGame: sanitizePicks((persisted as { byGame?: unknown } | null)?.byGame),
      }),
      merge: (persisted, current) => ({
        ...current,
        byGame: sanitizePicks((persisted as { byGame?: unknown } | null)?.byGame),
      }),
    },
  ),
);
