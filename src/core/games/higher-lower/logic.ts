import { z } from 'zod';
import type { Rng } from '../../engine/rng';
import type { Effect, GameLogic, PlayerId } from '../../engine/types';
import { cardValue, shuffledDeck, type Card } from '../../primitives/deck';
import { at, nextIndex, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  wrongSips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.hl.wrongSips' }),
  penalty: z.enum(['fixed', 'streak']).default('fixed').meta({ label: 'rules.hl.penalty' }),
  tie: z.enum(['lose', 'safe', 'social']).default('lose').meta({ label: 'rules.hl.tie' }),
  passAfter: z.number().int().min(0).max(10).default(3).meta({ label: 'rules.hl.passAfter' }),
  aceHigh: z.boolean().default(true).meta({ label: 'rules.hl.aceHigh' }),
});
export type Rules = z.output<typeof rulesSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('GUESS'), guess: z.enum(['higher', 'lower']) }),
]);
export type Action = z.output<typeof actionSchema>;

export type Outcome = 'correct' | 'wrong' | 'tie';

export interface State {
  order: PlayerId[];
  turn: number;
  /** Draw pile; the next card is the last element. Hidden from views. */
  deck: Card[];
  /** Face-up cards this cycle; the current card is the last element. */
  pile: Card[];
  streak: number;
  last: {
    player: PlayerId;
    guess: 'higher' | 'lower';
    prev: Card;
    card: Card;
    outcome: Outcome;
  } | null;
}

export interface View extends Omit<State, 'deck'> {
  deckCount: number;
}

function draw(state: State, rng: Rng): { card: Card; deck: Card[]; pile: Card[] } {
  let deck = state.deck;
  let pile = state.pile;
  if (deck.length === 0) {
    // Reshuffle everything except the current face-up card.
    const current = pile[pile.length - 1] as Card;
    deck = rng.shuffle(pile.slice(0, -1));
    pile = [current];
  }
  const card = deck[deck.length - 1] as Card;
  return { card, deck: deck.slice(0, -1), pile: [...pile, card] };
}

export const higherLower: GameLogic<State, Action, Rules> = {
  id: 'higher-lower',
  version: 1,
  meta: { family: 'cards', min: 1, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(_rules, ctx) {
    const deck = shuffledDeck(ctx.rng);
    const first = deck.pop() as Card;
    return { order: seatOrder(ctx.players), turn: 0, deck, pile: [first], streak: 0, last: null };
  },

  validate(state, _action, actor) {
    if (state.order.length === 0) return 'error.noPlayers';
    if (actor !== 'host' && actor !== at(state.order, state.turn)) return 'error.notYourTurn';
    return null;
  },

  reduce(state, action, ctx, rules) {
    const player = at(state.order, state.turn);
    const prev = state.pile[state.pile.length - 1] as Card;
    const { card, deck, pile } = draw(state, ctx.rng);

    const a = cardValue(prev, rules.aceHigh);
    const b = cardValue(card, rules.aceHigh);
    const outcome: Outcome =
      a === b ? 'tie' : b > a === (action.guess === 'higher') ? 'correct' : 'wrong';

    const effects: Effect[] = [];
    let streak = state.streak;
    let turn = state.turn;

    const lose = outcome === 'wrong' || (outcome === 'tie' && rules.tie === 'lose');
    if (lose) {
      const amount = rules.penalty === 'streak' ? rules.wrongSips + streak : rules.wrongSips;
      effects.push({
        type: 'drink',
        to: [player],
        amount,
        kind: 'drink',
        reason: { key: 'hl.reason.wrong' },
      });
      streak = 0;
      turn = nextIndex(turn, state.order.length);
    } else {
      if (outcome === 'tie' && rules.tie === 'social') {
        effects.push({
          type: 'drink',
          to: [...state.order],
          amount: rules.wrongSips,
          kind: 'social',
          reason: { key: 'hl.reason.tieSocial' },
        });
      }
      streak += 1;
      if (rules.passAfter > 0 && streak >= rules.passAfter) {
        effects.push({ type: 'notice', msg: { key: 'hl.notice.safe', params: { streak } } });
        streak = 0;
        turn = nextIndex(turn, state.order.length);
      }
    }
    if (turn !== state.turn) {
      effects.push({ type: 'passTo', player: at(state.order, turn), private: false });
    }

    return {
      state: {
        ...state,
        deck,
        pile,
        streak,
        turn,
        last: { player, guess: action.guess, prev, card, outcome },
      },
      effects,
    };
  },

  project(state): View {
    const { deck, ...rest } = state;
    return { ...rest, deckCount: deck.length };
  },

  activeActor: (state) => state.order[state.turn] ?? null,
  isOver: (state) => state.order.length === 0,
};
