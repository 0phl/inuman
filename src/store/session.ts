import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import {
  sessionReducer,
  startSession,
  type SessionAction,
  type SessionState,
} from '@/core/engine/session';
import type { GameContent, GameId } from '@/core/engine/types';
import { getLogic, hasLogic } from '@/core/games/registry';
import { useFx } from './fx';
import { usePlayers } from './players';
import { rulesFor, useRules } from './rules';
import { useSettings } from './settings';

/** The prompts a content game was last started with, so "Isa pa!" can deal them again. */
export interface LastContent {
  gameId: GameId;
  content: GameContent;
}

interface SessionData {
  session: SessionState | null;
  lastContent: LastContent | null;
  /** When the current game started (ms epoch); UI-only. */
  startedAt: number;
  /** Last time the group was reminded to drink water (ms epoch). */
  waterAt: number;
}

interface SessionStore extends SessionData {
  /** True once IndexedDB has been read, so routes know whether a game can resume. */
  hydrated: boolean;
  /**
   * Returns an i18n error key, or null when the game started. Games with `meta.needsContent`
   * take their prompts here; without `content` they reuse what they were last started with.
   */
  startGame(gameId: GameId, content?: GameContent): string | null;
  /**
   * The local GameHost seam: every session action goes through here. Runs the core reducer,
   * stores the new state (autosaved to IndexedDB) and queues the effects for the play UI.
   * Returns the reducer's i18n error key, or null.
   */
  dispatch(action: SessionAction): string | null;
  markWater(): void;
  clear(): void;
}

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: (name, value) => idbSet(name, value),
  removeItem: (name) => del(name),
};

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;

/** A stored session is only resumable if its game still exists at the same logic version. */
export function isResumable(raw: unknown): raw is SessionState {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Partial<SessionState>;
  if (s.v !== 1 || typeof s.gameId !== 'string' || !hasLogic(s.gameId)) return false;
  if (s.gameVersion !== getLogic(s.gameId).version) return false;
  return (
    Array.isArray(s.players) && Array.isArray(s.drinks) && typeof s.seq === 'number' && 'game' in s
  );
}

export const useSession = create<SessionStore>()(
  persist(
    (set, get) => ({
      session: null,
      lastContent: null,
      startedAt: 0,
      waterAt: 0,
      hydrated: false,

      startGame(gameId, content) {
        if (!hasLogic(gameId)) return 'error.badAction';
        const logic = getLogic(gameId);
        const players = usePlayers.getState().players;
        const seated = players.filter((p) => !p.sittingOut);
        if (seated.length < logic.meta.min) return 'error.noPlayers';
        const last = get().lastContent;
        const dealt = content ?? (last?.gameId === gameId ? last.content : undefined);
        if (logic.meta.needsContent && !dealt?.prompts?.length) return 'lobby.packs.none';
        const session = startSession(logic, {
          rules: rulesFor(useRules.getState().byGame, gameId),
          players,
          intensity: useSettings.getState().intensity,
          seed: randomSeed(),
          content: dealt,
        });
        const now = Date.now();
        useFx.getState().clear();
        set({
          session,
          startedAt: now,
          waterAt: now,
          lastContent:
            logic.meta.needsContent && dealt ? { gameId, content: dealt } : get().lastContent,
        });
        return null;
      },

      dispatch(action) {
        const { session } = get();
        if (!session) return 'error.gameOver';
        const step = sessionReducer(getLogic(session.gameId), session, action);
        if (step.error) {
          useFx.getState().push([{ type: 'error', msg: { key: step.error } }]);
          return step.error;
        }
        set({ session: step.state });
        useFx.getState().push(step.effects);
        return null;
      },

      markWater: () => set({ waterAt: Date.now() }),

      clear() {
        useFx.getState().clear();
        set({ session: null, startedAt: 0, waterAt: 0 });
      },
    }),
    {
      name: 'inuman.session',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s): SessionData => ({
        session: s.session,
        lastContent: s.lastContent,
        startedAt: s.startedAt,
        waterAt: s.waterAt,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SessionData>;
        if (!isResumable(p.session)) return current;
        const lc = p.lastContent;
        return {
          ...current,
          session: p.session,
          lastContent:
            lc &&
            typeof lc === 'object' &&
            typeof lc.gameId === 'string' &&
            Array.isArray(lc.content?.prompts)
              ? lc
              : null,
          startedAt: typeof p.startedAt === 'number' ? p.startedAt : Date.now(),
          waterAt: typeof p.waterAt === 'number' ? p.waterAt : Date.now(),
        };
      },
      onRehydrateStorage: () => () => {
        useSession.setState({ hydrated: true });
      },
    },
  ),
);

/** The table view of the running game (`logic.project(state, 'table')`). The UI renders only this. */
export function useGameView<V>(): V | null {
  const session = useSession((s) => s.session);
  return useMemo(
    () => (session ? (getLogic(session.gameId).project(session.game, 'table') as V) : null),
    [session],
  );
}

/** Keeps the running session's intensity in sync with the settings screen. */
useSettings.subscribe((s, prev) => {
  if (s.intensity === prev.intensity) return;
  const { session, dispatch } = useSession.getState();
  if (session && !session.over) dispatch({ type: 'SET_INTENSITY', intensity: s.intensity });
});

/** Roster edits made mid-game (rename, non-alcoholic, sitting out) flow into the session. */
usePlayers.subscribe((s, prev) => {
  if (s.players === prev.players) return;
  const { session, dispatch } = useSession.getState();
  if (!session || session.over) return;
  for (const p of session.players) {
    const next = s.players.find((x) => x.id === p.id);
    if (!next) continue;
    if (
      next.name !== p.name ||
      next.nonAlcoholic !== p.nonAlcoholic ||
      next.sittingOut !== p.sittingOut
    ) {
      dispatch({
        type: 'UPDATE_PLAYER',
        playerId: p.id,
        patch: { name: next.name, nonAlcoholic: next.nonAlcoholic, sittingOut: next.sittingOut },
      });
    }
  }
});
