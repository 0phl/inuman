import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { PlayerSchema, type Player } from '@/core/content/schemas';

export const MAX_PLAYERS = 20;
export const MAX_NAME = 20;

export const newPlayerId = (): string => crypto.randomUUID().slice(0, 8);

interface PlayersState {
  players: Player[];
  /** Returns an i18n error key, or null on success. */
  add(name: string): string | null;
  rename(id: string, name: string): string | null;
  remove(id: string): void;
  move(id: string, dir: -1 | 1): void;
  toggleNonAlcoholic(id: string): void;
  toggleSittingOut(id: string): void;
}

const clean = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

function nameError(name: string, players: Player[], selfId?: string): string | null {
  if (!name) return 'error.emptyName';
  const lower = name.toLocaleLowerCase();
  if (players.some((p) => p.id !== selfId && p.name.toLocaleLowerCase() === lower)) return 'players.error.duplicate';
  return null;
}

export function sanitizePlayers(raw: unknown): Player[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const item of raw) {
    const p = PlayerSchema.safeParse(item);
    if (!p.success || seen.has(p.data.id)) continue;
    seen.add(p.data.id);
    out.push(p.data);
    if (out.length >= MAX_PLAYERS) break;
  }
  return out;
}

export const usePlayers = create<PlayersState>()(
  persist(
    (set, get) => ({
      players: [],
      add(raw) {
        const name = clean(raw);
        const { players } = get();
        if (players.length >= MAX_PLAYERS) return 'players.error.full';
        const err = nameError(name, players);
        if (err) return err;
        set({ players: [...players, { id: newPlayerId(), name, nonAlcoholic: false, sittingOut: false }] });
        return null;
      },
      rename(id, raw) {
        const name = clean(raw);
        const err = nameError(name, get().players, id);
        if (err) return err;
        set((s) => ({ players: s.players.map((p) => (p.id === id ? { ...p, name } : p)) }));
        return null;
      },
      remove: (id) => set((s) => ({ players: s.players.filter((p) => p.id !== id) })),
      move(id, dir) {
        const players = get().players.slice();
        const i = players.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= players.length) return;
        [players[i], players[j]] = [players[j] as Player, players[i] as Player];
        set({ players });
      },
      toggleNonAlcoholic: (id) =>
        set((s) => ({ players: s.players.map((p) => (p.id === id ? { ...p, nonAlcoholic: !p.nonAlcoholic } : p)) })),
      toggleSittingOut: (id) =>
        set((s) => ({ players: s.players.map((p) => (p.id === id ? { ...p, sittingOut: !p.sittingOut } : p)) })),
    }),
    {
      name: 'inuman.players',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ players: s.players }),
      migrate: (persisted) => ({ players: sanitizePlayers((persisted as { players?: unknown } | null)?.players) }),
      merge: (persisted, current) => ({
        ...current,
        players: sanitizePlayers((persisted as { players?: unknown } | null)?.players),
      }),
    },
  ),
);
