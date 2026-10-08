import { z } from 'zod';
import type { PromptItem } from '../../content/schemas';
import type { Rng } from '../../engine/rng';
import type { Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, nextIndex, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  sips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.nhie.sips' }),
  maxSpice: z.number().int().min(0).max(3).default(2).meta({ label: 'rules.nhie.maxSpice' }),
  /** 0 = play until the deck runs out. */
  rounds: z.number().int().min(0).max(200).default(0).meta({ label: 'rules.nhie.rounds' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NEXT'), did: z.array(z.string().min(1).max(24)).max(50) }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Current {
  item: PromptItem;
  /** Placeholder targets fixed by the reducer. `{player}` is the reader; `{left}`/`{right}` come from `order`. */
  targets: { random?: PlayerId };
}

export interface State {
  order: PlayerId[];
  /** Index into `order` of the player reading the current prompt. */
  reader: number;
  /** Remaining prompts; the next one is the last element. Hidden from views. */
  deck: PromptItem[];
  current: Current | null;
  /** 1-based number of the current prompt (0 when nothing was drawn). */
  round: number;
}

export interface View extends Omit<State, 'deck'> {
  remaining: number;
}

const mentions = (item: PromptItem, placeholder: string): boolean =>
  item.text.includes(placeholder) ||
  Object.values(item.alt ?? {}).some((t) => t?.includes(placeholder));

function draw(deck: PromptItem[], order: PlayerId[], reader: number, rng: Rng) {
  const item = deck[deck.length - 1];
  if (!item) return { deck, current: null };
  const targets: Current['targets'] = {};
  if (mentions(item, '{random}') && order.length > 0) {
    // Prefer someone other than the reader so the prompt makes sense.
    const others = order.length > 1 ? order.filter((_, i) => i !== reader) : order;
    targets.random = rng.pick(others);
  }
  return { deck: deck.slice(0, -1), current: { item, targets } };
}

export const neverHaveIEver: GameLogic<State, Action, Rules> = {
  id: 'never-have-i-ever',
  version: 1,
  meta: { family: 'party', min: 2, max: 20, hiddenInfo: false, needsContent: true },
  rulesSchema,
  actionSchema,

  setup(rules, ctx, content) {
    const order = seatOrder(ctx.players);
    const pool = (content.prompts ?? []).filter((p) => p.spice <= rules.maxSpice);
    const shuffled = ctx.rng.shuffle(pool);
    if (order.length === 0) return { order, reader: 0, deck: shuffled, current: null, round: 0 };
    const { deck, current } = draw(shuffled, order, 0, ctx.rng);
    return { order, reader: 0, deck, current, round: current ? 1 : 0 };
  },

  validate(state, action, actor) {
    if (state.order.length === 0) return 'error.noPlayers';
    if (!state.current) return 'error.gameOver';
    if (actor !== 'host' && actor !== at(state.order, state.reader)) return 'error.notYourTurn';
    if (action.did.some((id) => !state.order.includes(id))) return 'nhie.error.badPlayer';
    if (new Set(action.did).size !== action.did.length) return 'nhie.error.duplicate';
    return null;
  },

  reduce(state, action, ctx, rules) {
    const effects: Effect[] = [];
    const item = (state.current as Current).item;
    const amount = item.sips ?? rules.sips;
    if (action.did.length > 0 && amount > 0) {
      effects.push({
        type: 'drink',
        to: [...action.did],
        amount,
        kind: 'drink',
        reason: { key: 'nhie.reason.did' },
      });
    }

    const reader = nextIndex(state.reader, state.order.length);
    const limitReached = rules.rounds > 0 && state.round >= rules.rounds;
    const next = limitReached
      ? { deck: state.deck, current: null }
      : draw(state.deck, state.order, reader, ctx.rng);
    if (next.current)
      effects.push({ type: 'passTo', player: at(state.order, reader), private: false });

    return {
      state: {
        ...state,
        reader,
        deck: next.deck,
        current: next.current,
        round: next.current ? state.round + 1 : state.round,
      },
      effects,
    };
  },

  project(state): View {
    const { deck, ...rest } = state;
    return { ...rest, remaining: deck.length };
  },

  activeActor: (state) => (state.current ? (state.order[state.reader] ?? null) : null),
  isOver: (state) => state.order.length === 0 || state.current === null,
};
