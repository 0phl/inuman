import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { rollFaces, type DiceRoll, type Face } from '../../primitives/dice';
import { at, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  maxRolls: z.number().int().min(1).max(3).default(3).meta({ label: 'rules.mx.maxRolls' }),
  leaderSetsRolls: z.boolean().default(true).meta({ label: 'rules.mx.leaderSetsRolls' }),
  loserSips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.mx.loserSips' }),
  mexicoDoubles: z.boolean().default(true).meta({ label: 'rules.mx.mexicoDoubles' }),
  tie: z.enum(['all', 'rolloff']).default('all').meta({ label: 'rules.mx.tie' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ROLL') }),
  z.object({ type: z.literal('SETTLED'), rollId: z.number().int().min(0) }),
  z.object({ type: z.literal('KEEP') }),
  z.object({ type: z.literal('NEXT_ROUND') }),
]);
export type Action = z.output<typeof actionSchema>;

/** Rank of a Mexico (2-1): beats everything. */
export const MEXICO_RANK = 1000;

/**
 * Score of a two-dice Mexico roll; higher is better. Faces are read high-first as [a, b]:
 * 2-1 is Mexico (1000), doubles are a×100 (100…600), anything else is a×10+b (31…65).
 */
export function mexicoRank(faces: readonly Face[]): number {
  if (faces.length !== 2) throw new Error(`mexicoRank needs 2 dice, got ${faces.length}`);
  const [x, y] = faces as readonly [Face, Face];
  const a = Math.max(x, y);
  const b = Math.min(x, y);
  if (a === 2 && b === 1) return MEXICO_RANK;
  if (a === b) return a * 100;
  return a * 10 + b;
}

export const isMexico = (faces: readonly Face[]): boolean => mexicoRank(faces) === MEXICO_RANK;

export interface Result {
  player: PlayerId;
  /** The two faces the player kept. */
  faces: Face[];
  rank: number;
  /** Rolls the player used. */
  rolls: number;
  /** 0 = the main round, n = the n-th roll-off among tied lowest players. */
  stage: number;
}

export interface State {
  order: PlayerId[];
  /** 1-based round number. */
  round: number;
  /** Who rolls in the current stage, in turn order: the round's starter first, or the tied players in a roll-off. */
  turnOrder: PlayerId[];
  /** Index into `turnOrder` of the player rolling now. */
  turn: number;
  /** 0 = the main round, n = the n-th roll-off. */
  stage: number;
  /** Rolls the current player has used this turn (0 = hasn't rolled yet). */
  rollsUsed: number;
  /** Max rolls for the current player: `maxRolls`, or what the stage's first player used. */
  cap: number;
  /** The latest roll. It stays on the table after a turn ends until the next player rolls. */
  roll: DiceRoll | null;
  /** Every finished turn this round, roll-offs included (see `stage`). */
  results: Result[];
  /** Mexicos rolled this round, roll-offs included. */
  mexicos: number;
  phase: 'rolling' | 'roundOver';
  /** The round's losers, in turn order (set in `roundOver`). */
  losers: PlayerId[];
  /** Base sips each loser drank (set in `roundOver`). */
  stake: number;
}

export interface View extends State {
  /** Player rolling now, or null when the round is over. */
  current: PlayerId | null;
  rollsLeft: number;
}

type Step = { state: State; effects: Effect[] };

const rotate = <T>(items: readonly T[], start: number): T[] => [
  ...items.slice(start),
  ...items.slice(0, start),
];

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const namesOf = (ctx: Ctx, ids: readonly PlayerId[]): string =>
  ids.map((id) => nameOf(ctx, id)).join(', ');

const currentPlayer = (state: State): PlayerId => at(state.turnOrder, state.turn);

function freshRound(state: State, round: number, starter: number, rules: Rules): State {
  return {
    ...state,
    round,
    turnOrder: rotate(state.order, starter),
    turn: 0,
    stage: 0,
    rollsUsed: 0,
    cap: rules.maxRolls,
    results: [],
    mexicos: 0,
    phase: 'rolling',
    losers: [],
    stake: 0,
  };
}

export const mexico: GameLogic<State, Action, Rules> = {
  id: 'mexico',
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
      stage: 0,
      rollsUsed: 0,
      cap: rules.maxRolls,
      roll: null,
      results: [],
      mexicos: 0,
      phase: 'rolling',
      losers: [],
      stake: 0,
    };
    return freshRound(base, 1, 0, rules);
  },

  validate(state, action, actor) {
    if (state.order.length === 0) return 'error.noPlayers';
    const mine = actor === 'host' || (state.phase === 'rolling' && actor === currentPlayer(state));
    const rolling = state.roll !== null && !state.roll.settled;

    switch (action.type) {
      case 'ROLL':
        if (state.phase !== 'rolling') return 'mx.error.roundOver';
        if (!mine) return 'error.notYourTurn';
        if (rolling) return 'mx.error.rolling';
        if (state.rollsUsed >= state.cap) return 'mx.error.noRollsLeft';
        return null;
      case 'SETTLED':
        if (!rolling || state.roll?.id !== action.rollId) return 'mx.error.staleRoll';
        return mine ? null : 'error.notYourTurn';
      case 'KEEP':
        if (state.phase !== 'rolling') return 'mx.error.roundOver';
        if (!mine) return 'error.notYourTurn';
        if (rolling) return 'mx.error.rolling';
        if (state.rollsUsed === 0) return 'mx.error.noRoll';
        return null;
      case 'NEXT_ROUND':
        if (state.phase !== 'roundOver') return 'mx.error.roundNotOver';
        if (actor !== 'host' && !state.order.includes(actor)) return 'error.notYourTurn';
        return null;
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'ROLL': {
        const roll: DiceRoll = {
          id: (state.roll?.id ?? 0) + 1,
          faces: rollFaces(ctx.rng, 2),
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
        const next = freshRound(state, state.round + 1, starter, rules);
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
    };
  },

  activeActor: (state) => {
    if (state.order.length === 0) return null;
    if (state.phase === 'roundOver') return 'any';
    return state.turnOrder[state.turn] ?? null;
  },
  isOver: (state) => state.order.length === 0,
};

/** The UI says the dice came to rest: score it, and end the turn if nothing is left to decide. */
function settle(state: State, ctx: Ctx, rules: Rules): Step {
  const roll: DiceRoll = { ...(state.roll as DiceRoll), settled: true };
  const effects: Effect[] = [];
  let next: State = { ...state, roll };
  const mexicoRolled = isMexico(roll.faces);
  if (mexicoRolled) {
    next = { ...next, mexicos: next.mexicos + 1 };
    effects.push({
      type: 'notice',
      msg: { key: 'mx.notice.mexico', params: { name: nameOf(ctx, currentPlayer(state)) } },
    });
  }
  // Mexico can't be beaten, and an empty cap leaves nothing to choose.
  if (mexicoRolled || next.rollsUsed >= next.cap) return finishTurn(next, ctx, rules, effects);
  return { state: next, effects };
}

function finishTurn(state: State, ctx: Ctx, rules: Rules, effects: Effect[]): Step {
  const player = currentPlayer(state);
  const faces = (state.roll as DiceRoll).faces;
  const result: Result = {
    player,
    faces,
    rank: mexicoRank(faces),
    rolls: state.rollsUsed,
    stage: state.stage,
  };

  let cap = state.cap;
  if (state.turn === 0 && rules.leaderSetsRolls) {
    cap = state.rollsUsed;
    if (state.turnOrder.length > 1 && cap < rules.maxRolls) {
      effects.push({
        type: 'notice',
        msg: { key: 'mx.notice.cap', params: { name: nameOf(ctx, player), rolls: cap } },
      });
    }
  }

  const next: State = {
    ...state,
    results: [...state.results, result],
    cap,
    turn: state.turn + 1,
    rollsUsed: 0,
  };
  if (next.turn < next.turnOrder.length) {
    effects.push({ type: 'passTo', player: currentPlayer(next), private: false });
    return { state: next, effects };
  }
  return endStage(next, ctx, rules, effects);
}

/** Everyone in this stage has rolled: find the lowest, then roll off or settle the round. */
function endStage(state: State, ctx: Ctx, rules: Rules, effects: Effect[]): Step {
  const stage = state.results.filter((r) => r.stage === state.stage);
  const low = Math.min(...stage.map((r) => r.rank));
  const losers = stage.filter((r) => r.rank === low).map((r) => r.player);

  if (losers.length > 1 && rules.tie === 'rolloff') {
    effects.push(
      {
        type: 'notice',
        msg: { key: 'mx.notice.rolloff', params: { names: namesOf(ctx, losers) } },
      },
      { type: 'passTo', player: losers[0] as PlayerId, private: false },
    );
    return {
      state: {
        ...state,
        stage: state.stage + 1,
        turnOrder: losers,
        turn: 0,
        rollsUsed: 0,
        cap: rules.maxRolls,
      },
      effects,
    };
  }

  const doubled = rules.mexicoDoubles && state.mexicos > 0;
  const stake = rules.loserSips * (doubled ? 2 ** state.mexicos : 1);
  effects.push(
    {
      type: 'notice',
      msg: { key: 'mx.notice.lost', params: { names: namesOf(ctx, losers), round: state.round } },
    },
    {
      type: 'drink',
      to: losers,
      amount: stake,
      kind: 'drink',
      reason: doubled
        ? { key: 'mx.reason.lowestDoubled', params: { count: state.mexicos } }
        : { key: 'mx.reason.lowest' },
    },
  );
  return { state: { ...state, phase: 'roundOver', losers, stake }, effects };
}
