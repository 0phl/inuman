import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, nextIndex, seatOrder } from '../../primitives/turn';
import {
  MAX_IMPULSE,
  MAX_ORIGIN,
  TEAM_MODES,
  formTeams,
  isSaneThrow,
  otherTeam,
  vec3Schema,
  type TeamIndex,
  type Vec3,
} from './skill';

export { MAX_IMPULSE, MAX_ORIGIN };

export const FORMATIONS = ['tri10', 'tri6', 'tri3', 'line2', 'single'] as const;
export type Formation = (typeof FORMATIONS)[number];

/** A slot centre in cup diameters: origin at the front cup, +x to the thrower's right, +y away from the thrower. */
export interface SlotXY {
  x: number;
  y: number;
}

/** Row spacing of touching cups in a triangle, in cup diameters. */
const ROW = Math.sqrt(3) / 2;

/** The 10-cup triangle, front (apex) first, each row left to right. Smaller triangles are its prefixes. */
const TRIANGLE: readonly SlotXY[] = [
  { x: 0, y: 0 },
  { x: -0.5, y: ROW },
  { x: 0.5, y: ROW },
  { x: -1, y: 2 * ROW },
  { x: 0, y: 2 * ROW },
  { x: 1, y: 2 * ROW },
  { x: -1.5, y: 3 * ROW },
  { x: -0.5, y: 3 * ROW },
  { x: 0.5, y: 3 * ROW },
  { x: 1.5, y: 3 * ROW },
];

/**
 * Slot layouts, the one source of truth for the UI and the physics. Each is normalized: coordinates
 * in cup diameters, origin at the front cup (closest to the thrower), +x to the thrower's right,
 * +y away from the thrower. A cup's `slot` indexes its rack's formation.
 */
export const FORMATION_SLOTS: Readonly<Record<Formation, readonly SlotXY[]>> = {
  tri10: TRIANGLE,
  tri6: TRIANGLE.slice(0, 6),
  tri3: TRIANGLE.slice(0, 3),
  line2: [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  single: [{ x: 0, y: 0 }],
};

export const rulesSchema = z.object({
  teams: z.enum(TEAM_MODES).default('alternate').meta({ label: 'rules.bp.teams' }),
  cups: z.literal([6, 10]).default(6).meta({ label: 'rules.bp.cups' }),
  throwsPerTurn: z.literal([1, 2]).default(2).meta({ label: 'rules.bp.throwsPerTurn' }),
  /** Both throws of a turn hit: the team throws again (needs 2 throws per turn). */
  ballsBack: z.boolean().default(true).meta({ label: 'rules.bp.ballsBack' }),
  cupSips: z.number().int().min(1).max(5).default(2).meta({ label: 'rules.bp.cupSips' }),
  /** rotate = the defending team's members take turns drinking hit cups; team = all of them drink. */
  drinker: z.enum(['rotate', 'team']).default('rotate').meta({ label: 'rules.bp.drinker' }),
  reracks: z.number().int().min(0).max(3).default(1).meta({ label: 'rules.bp.reracks' }),
  /** UI-only: how much the aim helper bends throws toward the nearest cup (0 = none). */
  aimAssist: z.number().int().min(0).max(3).default(2).meta({ label: 'rules.bp.aimAssist' }),
  loserSips: z.number().int().min(1).max(5).default(2).meta({ label: 'rules.bp.loserSips' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const hitSchema = z.object({
  /** The team whose rack the ball landed in. */
  team: z.literal([0, 1]),
  cupId: z.number().int().min(0).max(9),
});
export type Hit = z.output<typeof hitSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  /** The throwing client's physics result. `hit` is null for a miss. */
  z.object({
    type: z.literal('THROW_RESOLVED'),
    impulse: vec3Schema,
    origin: vec3Schema,
    hit: hitSchema.nullable(),
  }),
  /** The throwing team spends a rerack to reshape the rack it shoots at. */
  z.object({ type: z.literal('RERACK'), formation: z.enum(FORMATIONS) }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Cup {
  /** Stable for the whole game (0..cups-1), so the UI can animate a rerack. */
  id: number;
  /** Index into FORMATION_SLOTS[rack formation]. */
  slot: number;
}

export interface Team {
  members: PlayerId[];
  /** The rack this team defends (at its end of the table): standing cups only. */
  cups: Cup[];
  formation: Formation;
  /** Reracks this team may still spend on the opponent's rack. */
  reracksLeft: number;
  /** Index into `members` of the next thrower. */
  thrower: number;
  /** Index into `members` of whoever drinks the next cup hit against this team (drinker 'rotate'). */
  drinker: number;
}

export interface Throw {
  /** Bumped on every throw, so the UI can tell throws apart. */
  id: number;
  team: TeamIndex;
  thrower: PlayerId;
  impulse: Vec3;
  origin: Vec3;
  hit: Hit | null;
}

export interface State {
  order: PlayerId[];
  teams: [Team, Team];
  /** The team throwing now. */
  turn: TeamIndex;
  /** 1-based count of turns; balls back starts a new turn for the same team. */
  turnNo: number;
  /** Throws taken this turn. */
  throwsTaken: number;
  /** Throws left this turn. */
  throwsLeft: number;
  hitsThisTurn: number;
  /** The latest throw. It stays on the table until the next one. */
  lastThrow: Throw | null;
  stats: Record<PlayerId, { throws: number; hits: number }>;
  phase: 'throwing' | 'over';
  winner: TeamIndex | null;
}

export interface View extends State {
  /** The player throwing now; null once the game is over. */
  current: PlayerId | null;
  /** The team being shot at. */
  defending: TeamIndex;
  cupsLeft: [number, number];
  /** Formations the throwing team may rerack the defending rack into right now (empty = none). */
  rerackOptions: Formation[];
}

type Step = { state: State; effects: Effect[] };

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const namesOf = (ctx: Ctx, ids: readonly PlayerId[]): string =>
  ids.map((id) => nameOf(ctx, id)).join(', ');

export const currentThrower = (state: State): PlayerId => {
  const team = state.teams[state.turn];
  return at(team.members, team.thrower);
};

const withTeam = (teams: State['teams'], i: TeamIndex, team: Team): State['teams'] =>
  i === 0 ? [team, teams[1]] : [teams[0], team];

/** Formations the rack can be reracked into: same cup count, different shape. */
export const rerackFits = (rack: Pick<Team, 'cups' | 'formation'>): Formation[] =>
  FORMATIONS.filter((f) => f !== rack.formation && FORMATION_SLOTS[f].length === rack.cups.length);

function rerackOptions(state: State): Formation[] {
  const team = state.teams[state.turn];
  if (state.phase !== 'throwing' || state.throwsTaken > 0 || team.reracksLeft <= 0) return [];
  return rerackFits(state.teams[otherTeam(state.turn)]);
}

export const beerPong: GameLogic<State, Action, Rules> = {
  id: 'beer-pong',
  version: 1,
  meta: { family: 'skill', min: 2, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(rules, ctx) {
    const order = seatOrder(ctx.players);
    const formation: Formation = rules.cups === 10 ? 'tri10' : 'tri6';
    const rack = (): Team['cups'] =>
      Array.from({ length: rules.cups }, (_, i) => ({ id: i, slot: i }));
    const team = (members: PlayerId[]): Team => ({
      members,
      cups: rack(),
      formation,
      reracksLeft: rules.reracks,
      thrower: 0,
      drinker: 0,
    });
    const [a, b] = formTeams(order, rules.teams);
    return {
      order,
      teams: [team(a), team(b)],
      turn: 0,
      turnNo: 1,
      throwsTaken: 0,
      throwsLeft: rules.throwsPerTurn,
      hitsThisTurn: 0,
      lastThrow: null,
      stats: Object.fromEntries(order.map((id) => [id, { throws: 0, hits: 0 }])),
      phase: order.length < 2 ? 'over' : 'throwing',
      winner: null,
    };
  },

  validate(state, action, actor) {
    if (state.order.length < 2) return 'error.noPlayers';
    if (state.phase === 'over') return 'error.gameOver';
    const team = state.teams[state.turn];

    switch (action.type) {
      case 'THROW_RESOLVED': {
        if (actor !== 'host' && actor !== currentThrower(state)) return 'error.notYourTurn';
        if (!isSaneThrow(action.impulse, action.origin)) return 'bp.error.badThrow';
        const hit = action.hit;
        if (!hit) return null;
        if (hit.team === state.turn) return 'bp.error.ownCup';
        return state.teams[hit.team].cups.some((c) => c.id === hit.cupId) ? null : 'bp.error.noCup';
      }
      case 'RERACK': {
        if (actor !== 'host' && !team.members.includes(actor)) return 'error.notYourTurn';
        if (state.throwsTaken > 0) return 'bp.error.rerackLate';
        if (team.reracksLeft <= 0) return 'bp.error.noReracks';
        const rack = state.teams[otherTeam(state.turn)];
        if (FORMATION_SLOTS[action.formation].length !== rack.cups.length) {
          return 'bp.error.formation';
        }
        return action.formation === rack.formation ? 'bp.error.sameFormation' : null;
      }
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'THROW_RESOLVED':
        return resolveThrow(state, action, ctx, rules);
      case 'RERACK': {
        const d = otherTeam(state.turn);
        const rack = state.teams[d];
        // Front cups stay in front: keep the current slot order, packed into the new shape.
        const cups = [...rack.cups]
          .sort((x, y) => x.slot - y.slot)
          .map((c, slot) => ({ id: c.id, slot }));
        const shooting = state.teams[state.turn];
        let teams = withTeam(state.teams, d, { ...rack, cups, formation: action.formation });
        teams = withTeam(teams, state.turn, { ...shooting, reracksLeft: shooting.reracksLeft - 1 });
        return {
          state: { ...state, teams },
          effects: [
            {
              type: 'notice',
              msg: {
                key: 'bp.notice.rerack',
                params: { name: nameOf(ctx, currentThrower(state)) },
              },
            },
          ],
        };
      }
    }
  },

  project(state): View {
    const over = state.phase === 'over';
    return {
      ...state,
      current: over ? null : currentThrower(state),
      defending: otherTeam(state.turn),
      cupsLeft: [state.teams[0].cups.length, state.teams[1].cups.length],
      rerackOptions: rerackOptions(state),
    };
  },

  activeActor: (state) => {
    if (state.order.length < 2 || state.phase === 'over') return null;
    return currentThrower(state);
  },
  isOver: (state) => state.order.length < 2 || state.phase === 'over',
};

function resolveThrow(
  state: State,
  action: Extract<Action, { type: 'THROW_RESOLVED' }>,
  ctx: Ctx,
  rules: Rules,
): Step {
  const t = state.turn;
  const d = otherTeam(t);
  const shooting = state.teams[t];
  const thrower = currentThrower(state);
  const hit = action.hit ? { team: action.hit.team, cupId: action.hit.cupId } : null;
  const effects: Effect[] = [];

  let defending = state.teams[d];
  if (hit) {
    const cups = defending.cups.filter((c) => c.id !== hit.cupId);
    const drinkers =
      rules.drinker === 'team'
        ? [...defending.members]
        : [at(defending.members, defending.drinker)];
    defending = {
      ...defending,
      cups,
      drinker:
        rules.drinker === 'rotate'
          ? nextIndex(defending.drinker, defending.members.length)
          : defending.drinker,
    };
    effects.push(
      {
        type: 'notice',
        msg: {
          key: 'bp.notice.hit',
          params: {
            name: nameOf(ctx, thrower),
            drinkers: namesOf(ctx, drinkers),
            left: cups.length,
          },
        },
      },
      {
        type: 'drink',
        to: drinkers,
        amount: rules.cupSips,
        kind: 'drink',
        reason: { key: 'bp.reason.cup' },
      },
    );
  }

  const prev = state.stats[thrower] ?? { throws: 0, hits: 0 };
  let teams = withTeam(state.teams, d, defending);
  teams = withTeam(teams, t, {
    ...shooting,
    thrower: nextIndex(shooting.thrower, shooting.members.length),
  });
  let next: State = {
    ...state,
    teams,
    throwsTaken: state.throwsTaken + 1,
    throwsLeft: state.throwsLeft - 1,
    hitsThisTurn: state.hitsThisTurn + (hit ? 1 : 0),
    lastThrow: {
      id: (state.lastThrow?.id ?? 0) + 1,
      team: t,
      thrower,
      impulse: [...action.impulse],
      origin: [...action.origin],
      hit,
    },
    stats: {
      ...state.stats,
      [thrower]: { throws: prev.throws + 1, hits: prev.hits + (hit ? 1 : 0) },
    },
  };

  if (defending.cups.length === 0) {
    effects.push(
      {
        type: 'notice',
        msg: { key: `bp.notice.win.${t}`, params: { names: namesOf(ctx, shooting.members) } },
      },
      {
        type: 'drink',
        to: [...defending.members],
        amount: rules.loserSips,
        kind: 'social',
        reason: { key: 'bp.reason.lost' },
      },
    );
    return { state: { ...next, throwsLeft: 0, phase: 'over', winner: t }, effects };
  }

  if (next.throwsLeft <= 0) {
    // Balls back: every throw of a multi-throw turn went in.
    const ballsBack =
      rules.ballsBack && next.throwsTaken > 1 && next.hitsThisTurn === next.throwsTaken;
    if (ballsBack) {
      effects.push({
        type: 'notice',
        msg: { key: 'bp.notice.ballsBack', params: { names: namesOf(ctx, shooting.members) } },
      });
    }
    next = {
      ...next,
      turn: ballsBack ? t : d,
      turnNo: next.turnNo + 1,
      throwsTaken: 0,
      throwsLeft: rules.throwsPerTurn,
      hitsThisTurn: 0,
    };
  }

  const up = currentThrower(next);
  if (up !== thrower) effects.push({ type: 'passTo', player: up, private: false });
  return { state: next, effects };
}
