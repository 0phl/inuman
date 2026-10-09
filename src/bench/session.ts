import type { Player } from '@/core/content/schemas';
import { DEFAULT_INTENSITY } from '@/core/content/schemas';
import {
  sessionReducer,
  startSession,
  type SessionAction,
  type SessionState,
} from '@/core/engine/session';
import type { GameContent, GameId } from '@/core/engine/types';
import { getLogic } from '@/core/games/registry';

// The bench's game host: an in-memory session driven by the same core reducer as real play. It
// never touches the persisted session store (useSession), the effect queue (useFx) or the roster.

/** Four made-up players. Ids are bench-only so they can never match a real roster. */
export const BENCH_PLAYERS: readonly Player[] = [
  { id: 'bench-ana', name: 'Ana', nonAlcoholic: false, sittingOut: false },
  { id: 'bench-ben', name: 'Ben', nonAlcoholic: false, sittingOut: false },
  { id: 'bench-cai', name: 'Cai', nonAlcoholic: false, sittingOut: false },
  { id: 'bench-dee', name: 'Dee', nonAlcoholic: false, sittingOut: false },
];

export interface BenchHost {
  readonly gameId: GameId;
  getState(): SessionState;
  /** The table view the UI renders (`project(state, 'table')`), memoised per state. */
  getView(): unknown;
  /** Runs the core reducer; returns its i18n error key, or null. */
  dispatch(action: SessionAction): string | null;
  /** Tries GAME actions in order and applies the first one the reducer accepts. */
  tryGame(...actions: unknown[]): boolean;
  subscribe(listener: () => void): () => void;
  /** Actions accepted / rejected so far. */
  readonly stats: { accepted: number; rejected: number };
}

export interface BenchHostInput {
  gameId: GameId;
  seed: number;
  rules?: unknown;
  content?: GameContent;
}

export function createBenchHost({ gameId, seed, rules, content }: BenchHostInput): BenchHost {
  const logic = getLogic(gameId);
  let state = startSession(logic, {
    rules: rules ?? {},
    players: [...BENCH_PLAYERS],
    intensity: DEFAULT_INTENSITY,
    seed,
    content,
  });
  let view: { of: SessionState; value: unknown } | null = null;
  const listeners = new Set<() => void>();
  const stats = { accepted: 0, rejected: 0 };

  const dispatch = (action: SessionAction): string | null => {
    const step = sessionReducer(logic, state, action);
    if (step.error) {
      stats.rejected++;
      return step.error;
    }
    stats.accepted++;
    state = step.state;
    for (const l of listeners) l();
    return null;
  };

  return {
    gameId,
    stats,
    getState: () => state,
    getView: () => {
      if (view?.of !== state) view = { of: state, value: logic.project(state.game, 'table') };
      return view.value;
    },
    dispatch,
    tryGame: (...actions) => actions.some((action) => dispatch({ type: 'GAME', action }) === null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
