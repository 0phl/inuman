import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GameId } from '@/core/engine/types';
import { getLogic, hasLogic } from '@/core/games/registry';

export const MAX_PRESETS = 12;
export const MAX_PRESET_NAME = 30;

export interface RulesPreset {
  name: string;
  rules: unknown;
}

export interface GameRules {
  current: unknown;
  presets: RulesPreset[];
}

type ByGame = Partial<Record<GameId, GameRules>>;

interface RulesState {
  byGame: ByGame;
  setRules(id: GameId, rules: unknown): void;
  reset(id: GameId): void;
  savePreset(id: GameId, name: string): string | null;
  applyPreset(id: GameId, name: string): void;
  deletePreset(id: GameId, name: string): void;
  /**
   * Saves given rules (e.g. from a share link) as a preset without touching the current rules.
   * Never overwrites: a name clash gets a " (2)" suffix. Returns the saved name, or an error key.
   */
  addPreset(id: GameId, name: string, rules: unknown): { name: string } | { error: string };
}

/** `name`, or `name (2)`, `name (3)`… — the first one not in `taken`, within MAX_PRESET_NAME. */
export function uniquePresetName(raw: string, taken: readonly string[]): string {
  const name = raw.trim().slice(0, MAX_PRESET_NAME);
  if (!taken.includes(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const next = `${name.slice(0, MAX_PRESET_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!taken.includes(next)) return next;
  }
}

export const defaultRules = (id: GameId): unknown => getLogic(id).rulesSchema.parse({});

/** Parses rules with the game's schema; anything invalid falls back to defaults. */
export function validRules(id: GameId, raw: unknown): unknown {
  const parsed = getLogic(id).rulesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultRules(id);
}

/** Current rules for a game, always valid against its schema. */
export function rulesFor(byGame: ByGame, id: GameId): unknown {
  return validRules(id, byGame[id]?.current);
}

export function sanitizeRules(raw: unknown): ByGame {
  const out: ByGame = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key as GameId;
    if (!hasLogic(id) || !value || typeof value !== 'object') continue;
    const v = value as { current?: unknown; presets?: unknown };
    const presets: RulesPreset[] = [];
    if (Array.isArray(v.presets)) {
      for (const p of v.presets as { name?: unknown; rules?: unknown }[]) {
        if (typeof p?.name !== 'string' || !p.name.trim()) continue;
        const parsed = getLogic(id).rulesSchema.safeParse(p.rules);
        if (parsed.success) presets.push({ name: p.name.slice(0, MAX_PRESET_NAME), rules: parsed.data });
      }
    }
    out[id] = { current: validRules(id, v.current), presets: presets.slice(0, MAX_PRESETS) };
  }
  return out;
}

const entry = (byGame: ByGame, id: GameId): GameRules => byGame[id] ?? { current: defaultRules(id), presets: [] };

export const useRules = create<RulesState>()(
  persist(
    (set, get) => ({
      byGame: {},
      setRules: (id, rules) =>
        set((s) => ({ byGame: { ...s.byGame, [id]: { ...entry(s.byGame, id), current: rules } } })),
      reset: (id) =>
        set((s) => ({ byGame: { ...s.byGame, [id]: { ...entry(s.byGame, id), current: defaultRules(id) } } })),
      savePreset(id, raw) {
        const name = raw.trim().slice(0, MAX_PRESET_NAME);
        if (!name) return 'error.emptyName';
        const e = entry(get().byGame, id);
        const parsed = getLogic(id).rulesSchema.safeParse(e.current);
        if (!parsed.success) return 'rulesUi.invalid';
        const presets = [{ name, rules: parsed.data }, ...e.presets.filter((p) => p.name !== name)].slice(
          0,
          MAX_PRESETS,
        );
        set((s) => ({ byGame: { ...s.byGame, [id]: { ...e, presets } } }));
        return null;
      },
      applyPreset(id, name) {
        const e = entry(get().byGame, id);
        const preset = e.presets.find((p) => p.name === name);
        if (!preset) return;
        set((s) => ({ byGame: { ...s.byGame, [id]: { ...e, current: validRules(id, preset.rules) } } }));
      },
      addPreset(id, raw, rules) {
        if (!hasLogic(id)) return { error: 'import.unknownGame' };
        if (!raw.trim()) return { error: 'error.emptyName' };
        const parsed = getLogic(id).rulesSchema.safeParse(rules);
        if (!parsed.success) return { error: 'share.invalid' };
        const e = entry(get().byGame, id);
        const name = uniquePresetName(raw, e.presets.map((p) => p.name));
        const presets = [{ name, rules: parsed.data }, ...e.presets].slice(0, MAX_PRESETS);
        set((s) => ({ byGame: { ...s.byGame, [id]: { ...e, presets } } }));
        return { name };
      },
      deletePreset: (id, name) =>
        set((s) => {
          const e = entry(s.byGame, id);
          return { byGame: { ...s.byGame, [id]: { ...e, presets: e.presets.filter((p) => p.name !== name) } } };
        }),
    }),
    {
      name: 'inuman.rules',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ byGame: s.byGame }),
      migrate: (persisted) => ({ byGame: sanitizeRules((persisted as { byGame?: unknown } | null)?.byGame) }),
      merge: (persisted, current) => ({
        ...current,
        byGame: sanitizeRules((persisted as { byGame?: unknown } | null)?.byGame),
      }),
    },
  ),
);
