import type { Intensity, Player } from '../content/schemas';
import { resolveDrink, type DrinkEntry } from './drink';
import { createRng, type RngState } from './rng';
import type {
  Actor,
  AnyGameLogic,
  DrinkEffect,
  Effect,
  GameContent,
  GameId,
  Msg,
  PlayerId,
} from './types';

const MAX_DRINK_LOG = 500;

export interface SessionState {
  v: 1;
  gameId: GameId;
  gameVersion: number;
  rules: unknown;
  players: Player[];
  intensity: Intensity;
  rng: RngState;
  game: unknown;
  /** Count of accepted actions; a future remote host uses it for ordering. */
  seq: number;
  drinks: DrinkEntry[];
  over: boolean;
}

export type SessionAction =
  | { type: 'GAME'; action: unknown }
  | { type: 'MANUAL_DRINK'; to: PlayerId[]; amount: number }
  | { type: 'SET_INTENSITY'; intensity: Intensity }
  | {
      type: 'UPDATE_PLAYER';
      playerId: PlayerId;
      patch: Partial<Pick<Player, 'name' | 'nonAlcoholic' | 'sittingOut'>>;
    }
  | { type: 'END' };

export type SessionEffect =
  | { type: 'drinks'; entries: DrinkEntry[]; reason: Msg; kind: DrinkEffect['kind'] }
  | Exclude<Effect, DrinkEffect>;

export interface SessionStep {
  state: SessionState;
  effects: SessionEffect[];
  error: string | null;
}

/** The multiplayer seam: v1 implements this locally; a RemoteHost can replace it. */
export interface GameHost {
  getState(): SessionState;
  dispatch(action: SessionAction, actor?: Actor): string | null;
  view(viewer: PlayerId | 'table'): unknown;
}

export interface StartInput {
  rules: unknown;
  players: Player[];
  intensity: Intensity;
  seed: number;
  content?: GameContent;
}

export function startSession(logic: AnyGameLogic, input: StartInput): SessionState {
  const rng = createRng(input.seed);
  const rules = logic.rulesSchema.parse(input.rules ?? {});
  const game = logic.setup(rules, { players: input.players, rng }, input.content ?? {});
  return {
    v: 1,
    gameId: logic.id,
    gameVersion: logic.version,
    rules,
    players: input.players,
    intensity: input.intensity,
    rng: rng.state,
    game,
    seq: 0,
    drinks: [],
    over: logic.isOver(game),
  };
}

function applyEffects(
  state: SessionState,
  effects: Effect[],
): { drinks: DrinkEntry[]; out: SessionEffect[] } {
  const out: SessionEffect[] = [];
  const logged: DrinkEntry[] = [];
  for (const fx of effects) {
    if (fx.type !== 'drink') {
      out.push(fx);
      continue;
    }
    const entries = resolveDrink(fx, state.intensity, state.players);
    if (entries.length === 0) continue;
    logged.push(...entries);
    out.push({ type: 'drinks', entries, reason: fx.reason, kind: fx.kind });
  }
  const drinks = logged.length ? [...state.drinks, ...logged].slice(-MAX_DRINK_LOG) : state.drinks;
  return { drinks, out };
}

function reject(state: SessionState, error: string): SessionStep {
  return { state, effects: [], error };
}

export function sessionReducer(
  logic: AnyGameLogic,
  state: SessionState,
  action: SessionAction,
  actor: Actor = 'host',
): SessionStep {
  switch (action.type) {
    case 'GAME': {
      if (state.over) return reject(state, 'error.gameOver');
      const parsed = logic.actionSchema.safeParse(action.action);
      if (!parsed.success) return reject(state, 'error.badAction');
      const error = logic.validate(state.game, parsed.data, actor, state.rules);
      if (error) return reject(state, error);

      const rng = createRng(state.rng);
      const step = logic.reduce(
        state.game,
        parsed.data,
        { players: state.players, rng },
        state.rules,
      );
      const { drinks, out } = applyEffects(state, step.effects);
      return {
        state: {
          ...state,
          game: step.state,
          rng: rng.state,
          seq: state.seq + 1,
          drinks,
          over: logic.isOver(step.state),
        },
        effects: out,
        error: null,
      };
    }

    case 'MANUAL_DRINK': {
      const amount = Math.min(Math.max(Math.round(action.amount), 1), 5);
      const { drinks, out } = applyEffects(state, [
        { type: 'drink', to: action.to, amount, kind: 'drink', reason: { key: 'drink.manual' } },
      ]);
      return { state: { ...state, drinks, seq: state.seq + 1 }, effects: out, error: null };
    }

    case 'SET_INTENSITY':
      return { state: { ...state, intensity: action.intensity }, effects: [], error: null };

    case 'UPDATE_PLAYER': {
      const name = action.patch.name?.trim().slice(0, 20);
      if (action.patch.name !== undefined && !name) return reject(state, 'error.emptyName');
      const players = state.players.map((p) =>
        p.id === action.playerId ? { ...p, ...action.patch, ...(name ? { name } : {}) } : p,
      );
      return { state: { ...state, players }, effects: [], error: null };
    }

    case 'END':
      return { state: { ...state, over: true }, effects: [], error: null };
  }
}
