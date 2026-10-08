import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, nextIndex, seatOrder } from '../../primitives/turn';
import {
  KINDS,
  buildDecks,
  drawPrompt,
  poolOf,
  type DrawnPrompt,
  type Kind,
  type TodDecks,
} from '../truth-or-dare/prompts';

export const rulesSchema = z.object({
  /** truthOrDare = the picked player plays truth or dare; drink = they drink; free = the table decides IRL. */
  outcome: z
    .enum(['truthOrDare', 'drink', 'free'])
    .default('truthOrDare')
    .meta({ label: 'rules.stb.outcome' }),
  sips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.stb.sips' }),
  allowSelf: z.boolean().default(false).meta({ label: 'rules.stb.allowSelf' }),
  /** picked = whoever the bottle picked spins next; clockwise = the next seat. */
  nextSpinner: z
    .enum(['picked', 'clockwise'])
    .default('picked')
    .meta({ label: 'rules.stb.nextSpinner' }),
  maxSpice: z.number().int().min(0).max(3).default(1).meta({ label: 'rules.stb.maxSpice' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  /** `power` is the flick strength, 0..1 (clamped by the reducer). It only shapes the animation. */
  z.object({ type: z.literal('SPIN'), power: z.number() }),
  z.object({ type: z.literal('SETTLED'), spinId: z.number().int().min(0) }),
  z.object({ type: z.literal('CHOOSE'), kind: z.enum(KINDS) }),
  z.object({ type: z.literal('DONE') }),
  z.object({ type: z.literal('REFUSE') }),
  z.object({ type: z.literal('NEXT') }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Spin {
  /** Bumped on every spin, so the UI can tell spins apart. */
  id: number;
  spinner: PlayerId;
  /** Decided by the reducer before the animation; seat angles are the UI's job. */
  target: PlayerId;
  /** Flick strength, 0..1. */
  power: number;
  /** Full turns (2–4) the bottle makes before it lands on the target. */
  extraTurns: number;
  settled: boolean;
}

export type Result = 'drank' | 'free' | 'done' | 'refused';

export interface State {
  order: PlayerId[];
  /** Index into `order` of the player spinning this round. */
  spinner: number;
  /** 1-based round number. */
  round: number;
  /**
   * spin: waiting for SPIN, or the bottle is still turning (`spin.settled` false) ·
   * choose: the target picks truth or dare · prompt: the target does it or refuses ·
   * resolved: round done, NEXT passes the bottle.
   */
  phase: 'spin' | 'choose' | 'prompt' | 'resolved';
  /** The latest spin. It stays on the table, settled, after NEXT until the next SPIN. */
  spin: Spin | null;
  /** Optional truth/dare prompts (outcome truthOrDare). Hidden from views. */
  decks: TodDecks;
  /** What the target chose this round (truthOrDare). */
  chosen: Kind | null;
  /** The drawn prompt; null in phase `prompt` means the pool is empty and the table makes one up. */
  prompt: DrawnPrompt | null;
  /** How this round ended (phase `resolved`). */
  result: Result | null;
}

export interface View extends Omit<State, 'decks'> {
  /** Who acts now: the spinner, the target, or null while the table settles (`resolved`). */
  current: PlayerId | null;
  /** Truth/dare prompts in rotation per kind (both 0 = make them up). */
  pool: Record<Kind, number>;
}

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);

const ONLY: Record<Kind, string> = { truth: 'stb.notice.onlyTruths', dare: 'stb.notice.onlyDares' };

/** Seats the bottle can land on: not the spinner (unless allowSelf), and not anyone sitting out. */
export function candidates(state: State, ctx: Ctx, rules: Rules): PlayerId[] {
  const base = rules.allowSelf ? state.order : state.order.filter((_, i) => i !== state.spinner);
  const out = new Set(ctx.players.filter((p) => p.sittingOut).map((p) => p.id));
  const present = base.filter((id) => !out.has(id));
  return present.length > 0 ? present : base;
}

const spinning = (state: State): boolean => state.spin !== null && !state.spin.settled;

export const spinTheBottle: GameLogic<State, Action, Rules> = {
  id: 'spin-the-bottle',
  version: 1,
  meta: { family: 'party', min: 2, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(rules, ctx, content) {
    return {
      order: seatOrder(ctx.players),
      spinner: 0,
      round: 1,
      phase: 'spin',
      spin: null,
      decks: buildDecks(content.prompts, rules.maxSpice, ctx.rng),
      chosen: null,
      prompt: null,
      result: null,
    };
  },

  validate(state, action, actor) {
    if (state.order.length < 2) return 'error.noPlayers';
    const isSpinner = actor === 'host' || actor === at(state.order, state.spinner);
    const isTarget = actor === 'host' || actor === state.spin?.target;

    switch (action.type) {
      case 'SPIN':
        if (state.phase !== 'spin') return 'stb.error.notResolved';
        if (spinning(state)) return 'stb.error.spinning';
        return isSpinner ? null : 'error.notYourTurn';
      case 'SETTLED':
        if (!spinning(state) || state.spin?.id !== action.spinId) return 'stb.error.staleSpin';
        return isSpinner ? null : 'error.notYourTurn';
      case 'CHOOSE':
        if (state.phase !== 'choose') return 'stb.error.notChoosing';
        return isTarget ? null : 'error.notYourTurn';
      case 'DONE':
      case 'REFUSE':
        if (state.phase !== 'prompt') return 'stb.error.noTask';
        return isTarget ? null : 'error.notYourTurn';
      case 'NEXT':
        if (state.phase !== 'resolved') return 'stb.error.notResolved';
        return actor === 'host' || state.order.includes(actor) ? null : 'error.notYourTurn';
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'SPIN': {
        const target = ctx.rng.pick(candidates(state, ctx, rules));
        const spin: Spin = {
          id: (state.spin?.id ?? 0) + 1,
          spinner: at(state.order, state.spinner),
          target,
          power: clamp01(action.power),
          extraTurns: ctx.rng.int(2, 4),
          settled: false,
        };
        return { state: { ...state, spin, chosen: null, prompt: null, result: null }, effects: [] };
      }

      case 'SETTLED': {
        const spin = { ...(state.spin as Spin), settled: true };
        const effects: Effect[] = [
          {
            type: 'notice',
            msg: { key: 'stb.notice.picked', params: { name: nameOf(ctx, spin.target) } },
          },
        ];
        const next = { ...state, spin };
        if (rules.outcome === 'drink') {
          effects.push({
            type: 'drink',
            to: [spin.target],
            amount: rules.sips,
            kind: 'drink',
            reason: { key: 'stb.reason.picked' },
          });
          return { state: { ...next, phase: 'resolved', result: 'drank' }, effects };
        }
        if (rules.outcome === 'free') {
          return { state: { ...next, phase: 'resolved', result: 'free' }, effects };
        }
        if (spin.target !== spin.spinner) {
          effects.push({ type: 'passTo', player: spin.target, private: false });
        }
        return { state: { ...next, phase: 'choose' }, effects };
      }

      case 'CHOOSE': {
        const spin = state.spin as Spin;
        const subject = state.order.indexOf(spin.target);
        const { decks, prompt } = drawPrompt(
          state.decks,
          action.kind,
          state.order,
          subject,
          ctx.rng,
        );
        const effects: Effect[] = [];
        if (prompt && prompt.kind !== action.kind) {
          effects.push({ type: 'notice', msg: { key: ONLY[prompt.kind] } });
        }
        return {
          state: { ...state, decks, prompt, chosen: action.kind, phase: 'prompt' },
          effects,
        };
      }

      case 'DONE':
        return { state: { ...state, phase: 'resolved', result: 'done' }, effects: [] };

      case 'REFUSE': {
        const spin = state.spin as Spin;
        return {
          state: { ...state, phase: 'resolved', result: 'refused' },
          effects: [
            {
              type: 'drink',
              to: [spin.target],
              amount: rules.sips + 1,
              kind: 'drink',
              reason: { key: 'stb.reason.refused' },
            },
          ],
        };
      }

      case 'NEXT': {
        const spin = state.spin as Spin;
        const picked = state.order.indexOf(spin.target);
        const spinner =
          rules.nextSpinner === 'picked' && picked >= 0
            ? picked
            : nextIndex(state.spinner, state.order.length);
        const effects: Effect[] =
          spinner !== state.spinner
            ? [{ type: 'passTo', player: at(state.order, spinner), private: false }]
            : [];
        return {
          state: {
            ...state,
            spinner,
            round: state.round + 1,
            phase: 'spin',
            chosen: null,
            prompt: null,
            result: null,
          },
          effects,
        };
      }
    }
  },

  project(state): View {
    const { decks, ...rest } = state;
    return { ...rest, current: currentActor(state), pool: poolOf(decks) };
  },

  activeActor: (state) => {
    if (state.order.length < 2) return null;
    return currentActor(state) ?? 'any';
  },
  isOver: (state) => state.order.length < 2,
};

function currentActor(state: State): PlayerId | null {
  switch (state.phase) {
    case 'spin':
      return state.order[state.spinner] ?? null;
    case 'choose':
    case 'prompt':
      return state.spin?.target ?? null;
    case 'resolved':
      return null;
  }
}
