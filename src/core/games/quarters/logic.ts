import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, nextIndex, seatOrder } from '../../primitives/turn';
import { MAX_IMPULSE, MAX_ORIGIN, isSaneThrow, vec3Schema, type Vec3 } from '../beer-pong/skill';

export { MAX_IMPULSE, MAX_ORIGIN };

export const MAX_HOUSE_RULES = 10;
export const MAX_RULE_LENGTH = 140;

export const rulesSchema = z.object({
  /** A coin that drops straight in without bouncing off the table counts as a miss. */
  mustBounce: z.boolean().default(true).meta({ label: 'rules.qt.mustBounce' }),
  /** UI-only: how much the coin throw is nudged toward the glass (0 = pure skill). */
  aimAssist: z.number().int().min(0).max(3).default(2).meta({ label: 'rules.qt.aimAssist' }),
  sips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.qt.sips' }),
  /** Misses per turn (they add up; makes don't reset them) before the coin passes on. */
  missesBeforePass: z
    .number()
    .int()
    .min(1)
    .max(3)
    .default(1)
    .meta({ label: 'rules.qt.missesBeforePass' }),
  /** makeRule = every `streakLength` makes in a row, the shooter adds a house rule. */
  streakRule: z
    .enum(['makeRule', 'none'])
    .default('makeRule')
    .meta({ label: 'rules.qt.streakRule' }),
  streakLength: z.number().int().min(2).max(5).default(3).meta({ label: 'rules.qt.streakLength' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  /** The shooting client's physics result: did the coin land in the glass, and did it bounce first. */
  z.object({
    type: z.literal('THROW_RESOLVED'),
    impulse: vec3Schema,
    origin: vec3Schema,
    made: z.boolean(),
    bounced: z.boolean(),
  }),
  /** Settles the pending pick (`target`) or streak rule (`text`). */
  z.object({
    type: z.literal('RESOLVE'),
    target: z.string().min(1).max(24).optional(),
    text: z.string().max(500).optional(),
  }),
  z.object({ type: z.literal('SKIP') }),
]);
export type Action = z.output<typeof actionSchema>;

export type PendingKind = 'pick' | 'rule';

export interface Pending {
  /** pick = the shooter names who drinks; rule = the shooter writes a house rule. */
  kind: PendingKind;
  /** The shooter who earned it. */
  by: PlayerId;
  sips: number;
  /** A streak rule is owed once this pick is settled. */
  thenRule: boolean;
}

export interface Shot {
  /** Bumped on every shot, so the UI can tell shots apart. */
  id: number;
  shooter: PlayerId;
  /** As reported by the physics. */
  made: boolean;
  bounced: boolean;
  /** Whether it counted as a make (with mustBounce, a clean drop doesn't). */
  counted: boolean;
  impulse: Vec3;
  origin: Vec3;
}

export interface State {
  order: PlayerId[];
  /** Index into `order` of the shooter. */
  shooter: number;
  /** 1-based count of turns. */
  turnNo: number;
  /** Counted makes in a row this turn. */
  streak: number;
  /** Misses this turn; the coin passes at `missesBeforePass`. */
  misses: number;
  pending: Pending | null;
  houseRules: string[];
  /** The latest shot. It stays on the table until the next one. */
  lastShot: Shot | null;
  stats: Record<PlayerId, { shots: number; makes: number; bestStreak: number }>;
}

export interface View extends State {
  /** Who acts now: the shooter (who also settles a pending pick or rule). */
  current: PlayerId | null;
}

type Step = { state: State; effects: Effect[] };

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const seated = (state: State, id: PlayerId | undefined): id is PlayerId =>
  id !== undefined && state.order.includes(id);

const shooterOf = (state: State): PlayerId => at(state.order, state.shooter);

/** After a pick, a streak rule may still be owed. */
const afterPick = (pending: Pending): Pending | null =>
  pending.kind === 'pick' && pending.thenRule
    ? { kind: 'rule', by: pending.by, sips: 0, thenRule: false }
    : null;

export const quarters: GameLogic<State, Action, Rules> = {
  id: 'quarters',
  version: 1,
  meta: { family: 'skill', min: 2, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(_rules, ctx) {
    const order = seatOrder(ctx.players);
    return {
      order,
      shooter: 0,
      turnNo: 1,
      streak: 0,
      misses: 0,
      pending: null,
      houseRules: [],
      lastShot: null,
      stats: Object.fromEntries(order.map((id) => [id, { shots: 0, makes: 0, bestStreak: 0 }])),
    };
  },

  validate(state, action, actor) {
    if (state.order.length < 2) return 'error.noPlayers';

    if (action.type === 'THROW_RESOLVED') {
      if (state.pending) return 'qt.error.pending';
      if (actor !== 'host' && actor !== shooterOf(state)) return 'error.notYourTurn';
      return isSaneThrow(action.impulse, action.origin) ? null : 'qt.error.badThrow';
    }

    const pending = state.pending;
    if (!pending) return 'qt.error.noPending';
    if (actor !== 'host' && actor !== pending.by) return 'error.notYourTurn';
    if (action.type === 'SKIP') return null;

    if (pending.kind === 'pick') {
      return seated(state, action.target) && action.target !== pending.by
        ? null
        : 'qt.error.badTarget';
    }
    const len = (action.text ?? '').trim().length;
    return len >= 1 && len <= MAX_RULE_LENGTH ? null : 'qt.error.ruleText';
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'THROW_RESOLVED':
        return shoot(state, action, ctx, rules);
      case 'SKIP':
        return { state: { ...state, pending: afterPick(state.pending as Pending) }, effects: [] };
      case 'RESOLVE': {
        const pending = state.pending as Pending;
        if (pending.kind === 'rule') {
          const text = (action.text ?? '').trim().slice(0, MAX_RULE_LENGTH);
          return {
            state: {
              ...state,
              pending: null,
              houseRules: [...state.houseRules, text].slice(-MAX_HOUSE_RULES),
            },
            effects: [],
          };
        }
        // The shooter picks who drinks; the target really drinks them.
        return {
          state: { ...state, pending: afterPick(pending) },
          effects: [
            {
              type: 'drink',
              to: [action.target as PlayerId],
              amount: pending.sips,
              kind: 'drink',
              reason: { key: 'qt.reason.picked', params: { name: nameOf(ctx, pending.by) } },
            },
          ],
        };
      }
    }
  },

  project(state): View {
    return {
      ...state,
      current: state.order.length < 2 ? null : (state.pending?.by ?? shooterOf(state)),
    };
  },

  activeActor: (state) => {
    if (state.order.length < 2) return null;
    return state.pending?.by ?? shooterOf(state);
  },
  isOver: (state) => state.order.length < 2,
};

function shoot(
  state: State,
  action: Extract<Action, { type: 'THROW_RESOLVED' }>,
  ctx: Ctx,
  rules: Rules,
): Step {
  const shooter = shooterOf(state);
  const name = nameOf(ctx, shooter);
  const counted = action.made && (action.bounced || !rules.mustBounce);
  const prev = state.stats[shooter] ?? { shots: 0, makes: 0, bestStreak: 0 };
  const streak = counted ? state.streak + 1 : 0;
  const effects: Effect[] = [];

  const next: State = {
    ...state,
    streak,
    lastShot: {
      id: (state.lastShot?.id ?? 0) + 1,
      shooter,
      made: action.made,
      bounced: action.bounced,
      counted,
      impulse: [...action.impulse],
      origin: [...action.origin],
    },
    stats: {
      ...state.stats,
      [shooter]: {
        shots: prev.shots + 1,
        makes: prev.makes + (counted ? 1 : 0),
        bestStreak: Math.max(prev.bestStreak, streak),
      },
    },
  };

  if (counted) {
    const thenRule = rules.streakRule === 'makeRule' && streak % rules.streakLength === 0;
    effects.push({ type: 'notice', msg: { key: 'qt.notice.made', params: { name } } });
    if (thenRule) {
      effects.push({ type: 'notice', msg: { key: 'qt.notice.streak', params: { name, streak } } });
    }
    // A make keeps the coin: the shooter picks who drinks, then shoots again.
    return {
      state: { ...next, pending: { kind: 'pick', by: shooter, sips: rules.sips, thenRule } },
      effects,
    };
  }

  if (action.made) {
    effects.push({ type: 'notice', msg: { key: 'qt.notice.noBounce', params: { name } } });
  }
  const misses = state.misses + 1;
  if (misses < rules.missesBeforePass) return { state: { ...next, misses }, effects };

  const turn = nextIndex(state.shooter, state.order.length);
  effects.push({ type: 'passTo', player: at(state.order, turn), private: false });
  return {
    state: { ...next, shooter: turn, turnNo: state.turnNo + 1, misses: 0, streak: 0 },
    effects,
  };
}
