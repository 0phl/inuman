import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { rollFaces, type DiceRoll, type Face } from '../../primitives/dice';
import { at, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  maxRolls: z.number().int().min(1).max(5).default(3).meta({ label: 'rules.scc.maxRolls' }),
  loserSips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.scc.loserSips' }),
  winnerGivesSips: z
    .number()
    .int()
    .min(0)
    .max(5)
    .default(0)
    .meta({ label: 'rules.scc.winnerGivesSips' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROLL') }),
  z.object({ type: z.literal('SETTLED'), rollId: z.number().int().min(0) }),
  z.object({ type: z.literal('KEEP') }),
  z.object({ type: z.literal('NEXT_ROUND') }),
]);
export type Action = z.output<typeof actionSchema>;

export const DICE_COUNT = 5;
/** Lock order: a ship (6), then a captain (5), then a crew (4). */
export const ROLES = ['ship', 'captain', 'crew'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_FACE: Readonly<Record<Role, Face>> = { ship: 6, captain: 5, crew: 4 };
/** Best possible cargo (6 + 6): nothing left to improve. */
export const MAX_CARGO = 12;

export interface Die {
  /** null until the die is first rolled this turn. */
  face: Face | null;
  lockedAs: Role | null;
}

export interface SccRoll extends DiceRoll {
  /** Which of the 5 dice were thrown; `faces[k]` is the target for die `indices[k]`. */
  indices: number[];
}

export interface Score {
  player: PlayerId;
  /** Cargo total, or 0 without a full ship, captain and crew. */
  score: number;
  qualified: boolean;
  rolls: number;
  /** All 5 final faces, in die order. */
  faces: Face[];
}

export interface State {
  order: PlayerId[];
  /** 1-based round number. */
  round: number;
  /** This round's turn order; the round's starter is first. */
  turnOrder: PlayerId[];
  /** Index into `turnOrder` of the player rolling now. */
  turn: number;
  /** The current player's 5 dice. Faces and locks change only when a roll settles. */
  dice: Die[];
  rollsUsed: number;
  /** Rolls allowed per turn (`rules.maxRolls`, copied so views can show what's left). */
  cap: number;
  /** The latest roll. It stays set after a turn ends until the next player rolls. */
  roll: SccRoll | null;
  /** Finished turns this round, in turn order. */
  scores: Score[];
  phase: 'rolling' | 'roundOver';
  /** Lowest scorers (set in `roundOver`). */
  losers: PlayerId[];
  /** Highest scorers when they beat the lowest (set in `roundOver`). */
  winners: PlayerId[];
}

export interface View extends State {
  /** Player rolling now, or null when the round is over. */
  current: PlayerId | null;
  rollsLeft: number;
  /** Ship, captain and crew are all locked. */
  qualified: boolean;
  /** Current cargo total (0 until qualified). */
  cargo: number;
}

type Step = { state: State; effects: Effect[] };

const freshDice = (): Die[] =>
  Array.from({ length: DICE_COUNT }, () => ({ face: null, lockedAs: null }));

const rotate = <T>(items: readonly T[], start: number): T[] => [
  ...items.slice(start),
  ...items.slice(0, start),
];

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const namesOf = (ctx: Ctx, ids: readonly PlayerId[]): string =>
  ids.map((id) => nameOf(ctx, id)).join(', ');

const currentPlayer = (state: State): PlayerId => at(state.turnOrder, state.turn);

/**
 * Locks dice in order: a 6 as the ship, then (only once the ship is locked) a 5 as the captain,
 * then a 4 as the crew. One roll can lock several. Locked dice never unlock during a turn.
 */
export function lockDice(dice: readonly Die[]): Die[] {
  const out = dice.map((d) => ({ ...d }));
  for (const role of ROLES) {
    if (out.some((d) => d.lockedAs === role)) continue;
    const i = out.findIndex((d) => d.lockedAs === null && d.face === ROLE_FACE[role]);
    if (i < 0) break;
    out[i] = { ...(out[i] as Die), lockedAs: role };
  }
  return out;
}

export const hasCrew = (dice: readonly Die[]): boolean =>
  ROLES.every((role) => dice.some((d) => d.lockedAs === role));

/** Sum of the two unlocked (cargo) dice once ship, captain and crew are locked; otherwise 0. */
export const cargoOf = (dice: readonly Die[]): number =>
  hasCrew(dice) ? dice.reduce((sum, d) => sum + (d.lockedAs === null ? (d.face ?? 0) : 0), 0) : 0;

function freshRound(state: State, round: number, starter: number): State {
  return {
    ...state,
    round,
    turnOrder: rotate(state.order, starter),
    turn: 0,
    dice: freshDice(),
    rollsUsed: 0,
    scores: [],
    phase: 'rolling',
    losers: [],
    winners: [],
  };
}

export const shipCaptainCrew: GameLogic<State, Action, Rules> = {
  id: 'ship-captain-crew',
  version: 1,
  meta: { family: 'dice', min: 2, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(rules, ctx) {
    const base: State = {
      order: seatOrder(ctx.players),
      round: 1,
      turnOrder: [],
      turn: 0,
      dice: freshDice(),
      rollsUsed: 0,
      cap: rules.maxRolls,
      roll: null,
      scores: [],
      phase: 'rolling',
      losers: [],
      winners: [],
    };
    return freshRound(base, 1, 0);
  },

  validate(state, action, actor) {
    if (state.order.length === 0) return 'error.noPlayers';
    const mine = actor === 'host' || (state.phase === 'rolling' && actor === currentPlayer(state));
    const rolling = state.roll !== null && !state.roll.settled;

    switch (action.type) {
      case 'ROLL':
        if (state.phase !== 'rolling') return 'scc.error.roundOver';
        if (!mine) return 'error.notYourTurn';
        if (rolling) return 'scc.error.rolling';
        if (state.rollsUsed >= state.cap) return 'scc.error.noRollsLeft';
        return null;
      case 'SETTLED':
        if (!rolling || state.roll?.id !== action.rollId) return 'scc.error.staleRoll';
        return mine ? null : 'error.notYourTurn';
      case 'KEEP':
        if (state.phase !== 'rolling') return 'scc.error.roundOver';
        if (!mine) return 'error.notYourTurn';
        if (rolling) return 'scc.error.rolling';
        if (!hasCrew(state.dice)) return 'scc.error.noCrew';
        return null;
      case 'NEXT_ROUND':
        if (state.phase !== 'roundOver') return 'scc.error.roundNotOver';
        if (actor !== 'host' && !state.order.includes(actor)) return 'error.notYourTurn';
        return null;
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'ROLL': {
        // Only unlocked dice are thrown: everything before the crew, or just the cargo after.
        const indices = state.dice.flatMap((d, i) => (d.lockedAs === null ? [i] : []));
        const roll: SccRoll = {
          id: (state.roll?.id ?? 0) + 1,
          faces: rollFaces(ctx.rng, indices.length),
          indices,
          settled: false,
        };
        return { state: { ...state, roll, rollsUsed: state.rollsUsed + 1 }, effects: [] };
      }
      case 'SETTLED':
        return settle(state, ctx, rules);
      case 'KEEP':
        return finishTurn(state, ctx, rules, []);
      case 'NEXT_ROUND': {
        const starter = Math.max(state.order.indexOf(state.losers[0] ?? ''), 0);
        const next = freshRound(state, state.round + 1, starter);
        return {
          state: next,
          effects: [{ type: 'passTo', player: currentPlayer(next), private: false }],
        };
      }
    }
  },

  project(state): View {
    return {
      ...state,
      current: state.phase === 'rolling' ? (state.turnOrder[state.turn] ?? null) : null,
      rollsLeft: state.phase === 'rolling' ? Math.max(state.cap - state.rollsUsed, 0) : 0,
      qualified: hasCrew(state.dice),
      cargo: cargoOf(state.dice),
    };
  },

  activeActor: (state) => {
    if (state.order.length === 0) return null;
    if (state.phase === 'roundOver') return 'any';
    return state.turnOrder[state.turn] ?? null;
  },
  isOver: (state) => state.order.length === 0,
};

/** The dice came to rest: apply faces, lock what can lock, and end the turn if nothing is left to decide. */
function settle(state: State, ctx: Ctx, rules: Rules): Step {
  const roll = state.roll as SccRoll;
  const thrown = state.dice.map((d) => ({ ...d }));
  roll.indices.forEach((dieIndex, k) => {
    thrown[dieIndex] = { face: roll.faces[k] as Face, lockedAs: null };
  });
  const dice = lockDice(thrown);
  const effects: Effect[] = [];
  if (hasCrew(dice) && !hasCrew(state.dice)) {
    effects.push({
      type: 'notice',
      msg: { key: 'scc.notice.crew', params: { name: nameOf(ctx, currentPlayer(state)) } },
    });
  }
  const next: State = { ...state, dice, roll: { ...roll, settled: true } };
  const done = next.rollsUsed >= next.cap || cargoOf(dice) === MAX_CARGO;
  return done ? finishTurn(next, ctx, rules, effects) : { state: next, effects };
}

function finishTurn(state: State, ctx: Ctx, rules: Rules, effects: Effect[]): Step {
  const player = currentPlayer(state);
  const qualified = hasCrew(state.dice);
  if (!qualified) {
    effects.push({
      type: 'notice',
      msg: { key: 'scc.notice.sunk', params: { name: nameOf(ctx, player) } },
    });
  }
  const score: Score = {
    player,
    score: cargoOf(state.dice),
    qualified,
    rolls: state.rollsUsed,
    faces: state.dice.map((d) => d.face as Face),
  };
  const next: State = {
    ...state,
    scores: [...state.scores, score],
    turn: state.turn + 1,
    dice: freshDice(),
    rollsUsed: 0,
  };
  if (next.turn < next.turnOrder.length) {
    effects.push({ type: 'passTo', player: currentPlayer(next), private: false });
    return { state: next, effects };
  }
  return endRound(next, ctx, rules, effects);
}

function endRound(state: State, ctx: Ctx, rules: Rules, effects: Effect[]): Step {
  const values = state.scores.map((s) => s.score);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const losers = state.scores.filter((s) => s.score === low).map((s) => s.player);
  const winners =
    high > low ? state.scores.filter((s) => s.score === high).map((s) => s.player) : [];

  effects.push(
    {
      type: 'notice',
      msg: { key: 'scc.notice.lost', params: { names: namesOf(ctx, losers), round: state.round } },
    },
    {
      type: 'drink',
      to: losers,
      amount: rules.loserSips,
      kind: 'drink',
      reason: { key: 'scc.reason.lowest' },
    },
  );
  if (rules.winnerGivesSips > 0 && winners.length > 0) {
    // The winner hands these out IRL; the drink log records them as a give.
    effects.push({
      type: 'drink',
      to: winners,
      amount: rules.winnerGivesSips,
      kind: 'give',
      reason: { key: 'scc.reason.give' },
    });
  }
  return { state: { ...state, phase: 'roundOver', losers, winners }, effects };
}
