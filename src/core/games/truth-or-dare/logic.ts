import { z } from 'zod';
import type { Rng } from '../../engine/rng';
import type { Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, nextIndex, seatOrder } from '../../primitives/turn';
import {
  KINDS,
  availableKinds,
  buildDecks,
  drawPrompt,
  poolOf,
  type DrawnPrompt,
  type Kind,
  type TodDecks,
} from './prompts';

export const rulesSchema = z.object({
  /** player = the player picks; wheel = a spin of the wheel picks for them. */
  choice: z.enum(['player', 'wheel']).default('player').meta({ label: 'rules.tod.choice' }),
  refuseSips: z.number().int().min(1).max(5).default(2).meta({ label: 'rules.tod.refuseSips' }),
  maxSpice: z.number().int().min(0).max(3).default(1).meta({ label: 'rules.tod.maxSpice' }),
  /** 0 = play until the host ends it (decks reshuffle). */
  rounds: z.number().int().min(0).max(200).default(0).meta({ label: 'rules.tod.rounds' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CHOOSE'), kind: z.enum(KINDS) }),
  z.object({ type: z.literal('SPIN_WHEEL') }),
  z.object({ type: z.literal('SETTLED'), wheelId: z.number().int().min(0) }),
  z.object({ type: z.literal('DONE') }),
  z.object({ type: z.literal('REFUSE') }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Wheel {
  /** Bumped on every spin, so the UI can tell spins apart. */
  id: number;
  /** Where the wheel lands; the reducer decides it before the animation starts. */
  kind: Kind;
  settled: boolean;
}

export interface State {
  order: PlayerId[];
  /** Index into `order` of the player whose turn it is. */
  turn: number;
  /** 1-based turn count (0 when the game never started). */
  round: number;
  /** choose: truth or dare (or spin the wheel) · prompt: do it or refuse · over. */
  phase: 'choose' | 'prompt' | 'over';
  /** Hidden from views. */
  decks: TodDecks;
  /** Wheel mode: the latest spin. It stays on the table, settled, until the next spin. */
  wheel: Wheel | null;
  /** The prompt being played (phase `prompt`). */
  prompt: DrawnPrompt | null;
  /** How the previous turn ended. */
  last: { player: PlayerId; kind: Kind; outcome: 'done' | 'refused' } | null;
}

export interface View extends Omit<State, 'decks'> {
  /** Whose turn it is; null once the game is over. */
  player: PlayerId | null;
  /** Prompts in rotation per kind (0 = none in the chosen packs). */
  pool: Record<Kind, number>;
}

const ONLY: Record<Kind, string> = { truth: 'tod.notice.onlyTruths', dare: 'tod.notice.onlyDares' };

/** Draws for the current player; a fallback to the other kind gets a notice. */
function startPrompt(state: State, asked: Kind, rng: Rng) {
  const { decks, prompt } = drawPrompt(state.decks, asked, state.order, state.turn, rng);
  const effects: Effect[] = [];
  if (prompt && prompt.kind !== asked) {
    effects.push({ type: 'notice', msg: { key: ONLY[prompt.kind] } });
  }
  return { decks, prompt, effects };
}

export const truthOrDare: GameLogic<State, Action, Rules> = {
  id: 'truth-or-dare',
  version: 1,
  meta: { family: 'party', min: 2, max: 20, hiddenInfo: false, needsContent: true },
  rulesSchema,
  actionSchema,

  setup(rules, ctx, content) {
    const order = seatOrder(ctx.players);
    const decks = buildDecks(content.prompts, rules.maxSpice, ctx.rng);
    const playable = order.length > 0 && availableKinds(decks).length > 0;
    return {
      order,
      turn: 0,
      round: playable ? 1 : 0,
      phase: playable ? 'choose' : 'over',
      decks,
      wheel: null,
      prompt: null,
      last: null,
    };
  },

  validate(state, action, actor, rules) {
    if (state.order.length === 0) return 'error.noPlayers';
    if (state.phase === 'over') return 'error.gameOver';
    const mine = actor === 'host' || actor === at(state.order, state.turn);
    const spinning = state.wheel !== null && !state.wheel.settled;

    switch (action.type) {
      case 'CHOOSE':
        if (rules.choice !== 'player') return 'tod.error.wheelMode';
        if (state.phase !== 'choose') return 'tod.error.notChoosing';
        return mine ? null : 'error.notYourTurn';
      case 'SPIN_WHEEL':
        if (rules.choice !== 'wheel') return 'tod.error.playerMode';
        if (state.phase !== 'choose') return 'tod.error.notChoosing';
        if (!mine) return 'error.notYourTurn';
        return spinning ? 'tod.error.spinning' : null;
      case 'SETTLED':
        if (!spinning || state.wheel?.id !== action.wheelId) return 'tod.error.staleWheel';
        return mine ? null : 'error.notYourTurn';
      case 'DONE':
      case 'REFUSE':
        if (state.phase !== 'prompt') return 'tod.error.noPrompt';
        return mine ? null : 'error.notYourTurn';
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'CHOOSE': {
        const { decks, prompt, effects } = startPrompt(state, action.kind, ctx.rng);
        return { state: { ...state, decks, prompt, phase: 'prompt' }, effects };
      }
      case 'SPIN_WHEEL': {
        const wheel: Wheel = {
          id: (state.wheel?.id ?? 0) + 1,
          kind: ctx.rng.pick(availableKinds(state.decks)),
          settled: false,
        };
        return { state: { ...state, wheel }, effects: [] };
      }
      case 'SETTLED': {
        const wheel = { ...(state.wheel as Wheel), settled: true };
        const { decks, prompt, effects } = startPrompt(state, wheel.kind, ctx.rng);
        return { state: { ...state, wheel, decks, prompt, phase: 'prompt' }, effects };
      }
      case 'DONE':
      case 'REFUSE': {
        const prompt = state.prompt as DrawnPrompt;
        const player = at(state.order, state.turn);
        const effects: Effect[] = [];
        const refused = action.type === 'REFUSE';
        const amount = prompt.item.sips ?? rules.refuseSips;
        if (refused && amount > 0) {
          effects.push({
            type: 'drink',
            to: [player],
            amount,
            kind: 'drink',
            reason: { key: 'tod.reason.refused' },
          });
        }
        const last: State['last'] = {
          player,
          kind: prompt.kind,
          outcome: refused ? 'refused' : 'done',
        };
        if (rules.rounds > 0 && state.round >= rules.rounds) {
          return { state: { ...state, phase: 'over', prompt: null, last }, effects };
        }
        const turn = nextIndex(state.turn, state.order.length);
        effects.push({ type: 'passTo', player: at(state.order, turn), private: false });
        return {
          state: {
            ...state,
            turn,
            round: state.round + 1,
            phase: 'choose',
            prompt: null,
            last,
          },
          effects,
        };
      }
    }
  },

  project(state): View {
    const { decks, ...rest } = state;
    return {
      ...rest,
      player: state.phase === 'over' ? null : (state.order[state.turn] ?? null),
      pool: poolOf(decks),
    };
  },

  activeActor: (state) => (state.phase === 'over' ? null : (state.order[state.turn] ?? null)),
  isOver: (state) => state.order.length === 0 || state.phase === 'over',
};
