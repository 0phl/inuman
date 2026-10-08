import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, seatOrder } from '../../primitives/turn';
import { TEAM_MODES, formTeams, otherTeam, type TeamIndex } from '../beer-pong/skill';

export const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Flip odds per difficulty: p(success) = clamp01(base + gain × quality), quality 0..1 from the
 * gesture. Normal: a sloppy flick lands 1 in 5, a perfect one 4 in 5.
 */
export const FLIP_ODDS: Readonly<Record<Difficulty, { base: number; gain: number }>> = {
  easy: { base: 0.35, gain: 0.6 },
  normal: { base: 0.2, gain: 0.6 },
  hard: { base: 0.08, gain: 0.55 },
};

/** Tied sudden-death rounds before the race is called a draw. */
export const SUDDEN_DEATH_ROUNDS = 5;

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);

/** Chance that a flip of this quality lands. */
export const flipChance = (difficulty: Difficulty, quality: number): number =>
  clamp01(FLIP_ODDS[difficulty].base + FLIP_ODDS[difficulty].gain * clamp01(quality));

export const rulesSchema = z.object({
  teams: z.enum(TEAM_MODES).default('alternate').meta({ label: 'rules.fc.teams' }),
  /** "Inom muna!": each leg starts with a drink. */
  drinkBeforeFlip: z.boolean().default(true).meta({ label: 'rules.fc.drinkBeforeFlip' }),
  sips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.fc.sips' }),
  difficulty: z.enum(DIFFICULTIES).default('normal').meta({ label: 'rules.fc.difficulty' }),
  loserSips: z.number().int().min(1).max(5).default(2).meta({ label: 'rules.fc.loserSips' }),
  /** Responsible cap: after this many tries the player is passed (the tries still count). */
  maxAttemptsPerLeg: z
    .number()
    .int()
    .min(3)
    .max(15)
    .default(8)
    .meta({ label: 'rules.fc.maxAttemptsPerLeg' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  /** The leg's player finished the pre-flip drink ("Inom muna!"). */
  z.object({ type: z.literal('DRANK') }),
  /** `quality` is the gesture score, 0..1 (clamped by the reducer). The reducer decides the outcome. */
  z.object({ type: z.literal('FLIP_ATTEMPT'), quality: z.number() }),
  /** The UI finished the scripted flip animation. */
  z.object({ type: z.literal('SETTLED'), flipId: z.number().int().min(0) }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Leg {
  team: TeamIndex;
  player: PlayerId;
  /** 0 = the main race, n = the n-th sudden-death round. */
  round: number;
  attempts: number;
  /** null while the leg runs; capped = passed after maxAttemptsPerLeg misses. */
  result: 'flipped' | 'capped' | null;
}

export interface Flip {
  /** Bumped on every attempt, so the UI can tell flips apart. */
  id: number;
  /** Clamped gesture quality, 0..1. Only shapes the animation. */
  quality: number;
  /** Decided by the reducer before the animation plays. */
  success: boolean;
  settled: boolean;
}

export interface State {
  order: PlayerId[];
  teams: [PlayerId[], PlayerId[]];
  /** Every leg so far plus the queue for the current round, in play order (teams alternate). */
  legs: Leg[];
  /** Index into `legs` of the leg being played. */
  leg: number;
  /** drink: waiting for DRANK · flip: flipping (`flip.settled` false = animating) · over. */
  phase: 'drink' | 'flip' | 'over';
  /** The latest flip. It stays on the table, settled, until the next attempt. */
  flip: Flip | null;
  /** 0 = the main race, n = sudden-death round n (up to SUDDEN_DEATH_ROUNDS). */
  suddenDeath: number;
  winner: TeamIndex | null;
  draw: boolean;
}

export interface View extends State {
  /** The player whose leg it is; null once the game is over. */
  current: PlayerId | null;
  currentTeam: TeamIndex | null;
  /** Tries per player over every leg, sudden death included. */
  attempts: Record<PlayerId, number>;
  /** Main-race tries per team; fewer wins. */
  teamAttempts: [number, number];
  /** Tries per team in the round being played (the main race or the current sudden-death round). */
  roundAttempts: [number, number];
}

type Step = { state: State; effects: Effect[] };

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const namesOf = (ctx: Ctx, ids: readonly PlayerId[]): string =>
  ids.map((id) => nameOf(ctx, id)).join(', ');

const currentLeg = (state: State): Leg => {
  const leg = state.legs[state.leg];
  if (!leg) throw new Error(`no leg at index ${state.leg}`);
  return leg;
};

/** Tries per team over the legs of one round. */
export function roundTotals(legs: readonly Leg[], round: number): [number, number] {
  const totals: [number, number] = [0, 0];
  for (const l of legs) if (l.round === round) totals[l.team] += l.attempts;
  return totals;
}

/**
 * One leg per team member, alternating teams (team 0 first). Uneven teams: the shorter team's
 * players go again in seat order so both teams run the same number of legs.
 */
function raceLegs(teams: State['teams']): Leg[] {
  const n = Math.max(teams[0].length, teams[1].length);
  return Array.from({ length: n }, (_, i) => [leg(teams, 0, i, 0), leg(teams, 1, i, 0)]).flat();
}

function leg(teams: State['teams'], team: TeamIndex, i: number, round: number): Leg {
  const members = teams[team];
  return { team, player: at(members, i % members.length), round, attempts: 0, result: null };
}

const legStart = (rules: Rules): State['phase'] => (rules.drinkBeforeFlip ? 'drink' : 'flip');

export const flipCup: GameLogic<State, Action, Rules> = {
  id: 'flip-cup',
  version: 1,
  meta: { family: 'skill', min: 2, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(rules, ctx) {
    const order = seatOrder(ctx.players);
    const teams = formTeams(order, rules.teams);
    const ready = order.length >= 2;
    return {
      order,
      teams,
      legs: ready ? raceLegs(teams) : [],
      leg: 0,
      phase: ready ? legStart(rules) : 'over',
      flip: null,
      suddenDeath: 0,
      winner: null,
      draw: false,
    };
  },

  validate(state, action, actor) {
    if (state.order.length < 2) return 'error.noPlayers';
    if (state.phase === 'over') return 'error.gameOver';
    const mine = actor === 'host' || actor === currentLeg(state).player;
    const flipping = state.flip !== null && !state.flip.settled;

    switch (action.type) {
      case 'DRANK':
        if (state.phase !== 'drink') return 'fc.error.notDrinking';
        return mine ? null : 'error.notYourTurn';
      case 'FLIP_ATTEMPT':
        if (state.phase === 'drink') return 'fc.error.drinkFirst';
        if (flipping) return 'fc.error.flipping';
        if (!Number.isFinite(action.quality)) return 'fc.error.badQuality';
        return mine ? null : 'error.notYourTurn';
      case 'SETTLED':
        if (!flipping || state.flip?.id !== action.flipId) return 'fc.error.staleFlip';
        return mine ? null : 'error.notYourTurn';
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'DRANK':
        return {
          state: { ...state, phase: 'flip' },
          effects: [
            {
              type: 'drink',
              to: [currentLeg(state).player],
              amount: rules.sips,
              kind: 'drink',
              reason: { key: 'fc.reason.drink' },
            },
          ],
        };

      case 'FLIP_ATTEMPT': {
        const quality = clamp01(action.quality);
        const success = ctx.rng.random() < flipChance(rules.difficulty, quality);
        const legs = state.legs.map((l, i) =>
          i === state.leg ? { ...l, attempts: l.attempts + 1 } : l,
        );
        const flip: Flip = { id: (state.flip?.id ?? 0) + 1, quality, success, settled: false };
        return { state: { ...state, legs, flip }, effects: [] };
      }

      case 'SETTLED':
        return settle(state, ctx, rules);
    }
  },

  project(state): View {
    const over = state.phase === 'over';
    const cur = over ? null : (state.legs[state.leg] ?? null);
    const attempts: Record<PlayerId, number> = Object.fromEntries(state.order.map((id) => [id, 0]));
    for (const l of state.legs) attempts[l.player] = (attempts[l.player] ?? 0) + l.attempts;
    return {
      ...state,
      current: cur?.player ?? null,
      currentTeam: cur?.team ?? null,
      attempts,
      teamAttempts: roundTotals(state.legs, 0),
      roundAttempts: roundTotals(state.legs, state.suddenDeath),
    };
  },

  activeActor: (state) => {
    if (state.order.length < 2 || state.phase === 'over') return null;
    return state.legs[state.leg]?.player ?? null;
  },
  isOver: (state) => state.order.length < 2 || state.phase === 'over',
};

/** The flip animation finished: a success (or the cap) ends the leg; a miss means try again. */
function settle(state: State, ctx: Ctx, rules: Rules): Step {
  const flip: Flip = { ...(state.flip as Flip), settled: true };
  const leg = currentLeg(state);
  const next: State = { ...state, flip };
  const name = nameOf(ctx, leg.player);

  if (flip.success) {
    return endLeg(next, 'flipped', ctx, rules, [
      {
        type: 'notice',
        msg: { key: 'fc.notice.flipped', params: { name, attempts: leg.attempts } },
      },
    ]);
  }
  if (leg.attempts >= rules.maxAttemptsPerLeg) {
    return endLeg(next, 'capped', ctx, rules, [
      {
        type: 'notice',
        msg: { key: 'fc.notice.capped', params: { name, attempts: leg.attempts } },
      },
    ]);
  }
  return { state: next, effects: [] };
}

function endLeg(
  state: State,
  result: NonNullable<Leg['result']>,
  ctx: Ctx,
  rules: Rules,
  effects: Effect[],
): Step {
  const done = currentLeg(state);
  const legs = state.legs.map((l, i) => (i === state.leg ? { ...l, result } : l));
  let next: State = { ...state, legs };

  if (next.leg + 1 >= legs.length) {
    const totals = roundTotals(legs, next.suddenDeath);
    if (totals[0] !== totals[1]) {
      return finish(next, totals[0] < totals[1] ? 0 : 1, ctx, rules, effects);
    }
    if (next.suddenDeath >= SUDDEN_DEATH_ROUNDS) return finish(next, null, ctx, rules, effects);

    // Tie: one more leg each, continuing each team's rotation.
    const round = next.suddenDeath + 1;
    const i = Math.max(next.teams[0].length, next.teams[1].length) + round - 1;
    next = {
      ...next,
      suddenDeath: round,
      legs: [...legs, leg(next.teams, 0, i, round), leg(next.teams, 1, i, round)],
    };
    effects.push({ type: 'notice', msg: { key: 'fc.notice.suddenDeath', params: { round } } });
  }

  next = { ...next, leg: next.leg + 1, phase: legStart(rules) };
  const up = currentLeg(next).player;
  if (up !== done.player) effects.push({ type: 'passTo', player: up, private: false });
  return { state: next, effects };
}

/** The race is decided: the losing team drinks (everyone, on a draw). */
function finish(
  state: State,
  winner: TeamIndex | null,
  ctx: Ctx,
  rules: Rules,
  effects: Effect[],
): Step {
  if (winner === null) {
    effects.push(
      { type: 'notice', msg: { key: 'fc.notice.draw', params: { rounds: SUDDEN_DEATH_ROUNDS } } },
      {
        type: 'drink',
        to: [...state.order],
        amount: rules.loserSips,
        kind: 'social',
        reason: { key: 'fc.reason.draw' },
      },
    );
  } else {
    effects.push(
      {
        type: 'notice',
        msg: {
          key: `fc.notice.win.${winner}`,
          params: { names: namesOf(ctx, state.teams[winner]) },
        },
      },
      {
        type: 'drink',
        to: [...state.teams[otherTeam(winner)]],
        amount: rules.loserSips,
        kind: 'social',
        reason: { key: 'fc.reason.lost' },
      },
    );
  }
  return { state: { ...state, phase: 'over', winner, draw: winner === null }, effects };
}
