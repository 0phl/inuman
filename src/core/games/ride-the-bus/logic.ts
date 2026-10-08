import { z } from 'zod';
import type { Rng } from '../../engine/rng';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import {
  SUITS,
  cardValue,
  isRed,
  rankKey,
  rankOf,
  shuffledDeck,
  suitOf,
  type Card,
} from '../../primitives/deck';
import { at, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  /** escalating = a wrong answer costs the question number (1–4); fixed = always 1. */
  wrongSips: z
    .enum(['escalating', 'fixed'])
    .default('escalating')
    .meta({ label: 'rules.rtb.wrongSips' }),
  pyramid: z.boolean().default(true).meta({ label: 'rules.rtb.pyramid' }),
  /** Responsible cap: after this many failed runs the rider is let off the bus. */
  busMaxAttempts: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .meta({ label: 'rules.rtb.busMaxAttempts' }),
  aceHigh: z.boolean().default(true).meta({ label: 'rules.rtb.aceHigh' }),
});
export type Rules = z.output<typeof rulesSchema>;

/** The four questions, in the order they're asked. */
export const QUESTIONS = ['RED_BLACK', 'HIGHER_LOWER', 'INSIDE_OUTSIDE', 'SUIT'] as const;
export type Question = (typeof QUESTIONS)[number];

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RED_BLACK'), guess: z.enum(['red', 'black']) }),
  z.object({ type: z.literal('HIGHER_LOWER'), guess: z.enum(['higher', 'lower']) }),
  z.object({ type: z.literal('INSIDE_OUTSIDE'), guess: z.enum(['inside', 'outside']) }),
  z.object({ type: z.literal('SUIT'), guess: z.enum(SUITS) }),
  z.object({ type: z.literal('FLIP') }),
  z.object({ type: z.literal('BOARD') }),
]);
export type Action = z.output<typeof actionSchema>;
export type Answer = Extract<Action, { type: Question }>;

/** Pyramid rows from the bottom: 4 cards worth 1 sip, then 3 × 2, 2 × 3 and 1 × 4. */
export const PYRAMID_ROWS = [4, 3, 2, 1] as const;
export const PYRAMID_SIZE = 10;
/** 4 deal cards each plus the pyramid must fit in one deck. */
export const MAX_PLAYERS = 10;

export interface PyramidCard {
  card: Card;
  /** 1 (bottom, 4 cards) … 4 (top). Also the sips per match. */
  row: number;
  faceUp: boolean;
}

export interface LastAnswer {
  player: PlayerId;
  phase: 'deal' | 'bus';
  question: Question;
  guess: Answer['guess'];
  card: Card;
  correct: boolean;
}

export interface Bus {
  rider: PlayerId;
  /** 1-based run number. A wrong answer starts the next run from Q1. */
  attempt: number;
  /** Face-up cards of the current run (0–3 while riding, 4 once off the bus). */
  cards: Card[];
  /** offBus = four right in a row; released = hit busMaxAttempts and let off. */
  outcome: 'offBus' | 'released' | null;
}

export interface State {
  order: PlayerId[];
  /**
   * deal: each player in turn answers Q1–Q4 · pyramid: FLIP the 10 cards · board: the rider is
   * picked, BOARD starts the bus · bus: the rider replays Q1–Q4 · over.
   */
  phase: 'deal' | 'pyramid' | 'board' | 'bus' | 'over';
  /** Deal phase: index into `order` of the player answering. */
  turn: number;
  /** Public hands aligned with `order`: the deal adds, pyramid matches remove. Emptied for the bus. */
  hands: Card[][];
  /** Draw pile; the next card is the last element. Hidden from views. */
  deck: Card[];
  /** Used cards (pyramid matches, failed bus runs). Reshuffled into the deck when it runs out. */
  discard: Card[];
  /** Laid out face down in flip order (bottom row first). Face-down cards are hidden from views. */
  pyramid: PyramidCard[];
  /** Pyramid cards turned so far; FLIP turns `pyramid[flipped]`. */
  flipped: number;
  /** Cards each seat had left when the rider was picked, aligned with `order`. */
  leftover: number[] | null;
  bus: Bus | null;
  last: LastAnswer | null;
}

export interface View extends Omit<State, 'deck' | 'discard' | 'pyramid'> {
  deckCount: number;
  discardCount: number;
  /** Face-down cards show as null. */
  pyramid: { row: number; card: Card | null }[];
  /** Who answers now (deal/bus) or must BOARD; null in the pyramid and when over. */
  current: PlayerId | null;
  /** The question to answer now (deal/bus). */
  question: Question | null;
}

type Step = { state: State; effects: Effect[] };

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

/** Cards the current answer is judged against: the player's hand (deal) or this bus run. */
const runCards = (state: State): Card[] =>
  state.phase === 'bus' ? (state.bus?.cards ?? []) : (state.hands[state.turn] ?? []);

/** Index (0–3) of the question to answer now. */
export const questionIndex = (state: State): number => runCards(state).length;

function answerer(state: State): PlayerId | null {
  switch (state.phase) {
    case 'deal':
      return state.order[state.turn] ?? null;
    case 'board':
    case 'bus':
      return state.bus?.rider ?? null;
    default:
      return null;
  }
}

/** Takes the top card; an empty deck is refilled from the shuffled discard pile first. */
export function drawCard(
  deck: readonly Card[],
  discard: readonly Card[],
  rng: Rng,
): { card: Card; deck: Card[]; discard: Card[] } {
  let pile = deck.slice();
  let used = discard.slice();
  if (pile.length === 0) {
    pile = rng.shuffle(used);
    used = [];
  }
  const card = pile.pop();
  if (card === undefined) throw new Error('ride-the-bus: out of cards');
  return { card, deck: pile, discard: used };
}

/**
 * Whether `answer` is right for `card`, given the run's earlier cards. Equal values are wrong
 * for higher/lower, and landing on either edge is wrong for inside/outside.
 */
export function judge(
  answer: Answer,
  card: Card,
  prev: readonly Card[],
  aceHigh: boolean,
): boolean {
  const v = cardValue(card, aceHigh);
  switch (answer.type) {
    case 'RED_BLACK':
      return isRed(card) === (answer.guess === 'red');
    case 'HIGHER_LOWER': {
      const a = cardValue(prev[0] as Card, aceHigh);
      return answer.guess === 'higher' ? v > a : v < a;
    }
    case 'INSIDE_OUTSIDE': {
      const a = cardValue(prev[0] as Card, aceHigh);
      const b = cardValue(prev[1] as Card, aceHigh);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return answer.guess === 'inside' ? v > lo && v < hi : v < lo || v > hi;
    }
    case 'SUIT':
      return suitOf(card) === answer.guess;
  }
}

const wrongAmount = (rules: Rules, q: number): number =>
  rules.wrongSips === 'escalating' ? q + 1 : 1;

export const rideTheBus: GameLogic<State, Action, Rules> = {
  id: 'ride-the-bus',
  version: 1,
  meta: { family: 'cards', min: 2, max: MAX_PLAYERS, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(_rules, ctx) {
    const order = seatOrder(ctx.players);
    return {
      order,
      phase: order.length > 0 ? 'deal' : 'over',
      turn: 0,
      hands: order.map(() => []),
      deck: shuffledDeck(ctx.rng),
      discard: [],
      pyramid: [],
      flipped: 0,
      leftover: null,
      bus: null,
      last: null,
    };
  },

  validate(state, action, actor) {
    if (state.order.length === 0) return 'error.noPlayers';
    if (state.phase === 'over') return 'error.gameOver';

    switch (action.type) {
      case 'FLIP':
        if (state.phase !== 'pyramid') return 'rtb.error.notPyramid';
        return actor === 'host' || state.order.includes(actor) ? null : 'error.notYourTurn';
      case 'BOARD':
        if (state.phase !== 'board') return 'rtb.error.notBoarding';
        return actor === 'host' || actor === state.bus?.rider ? null : 'error.notYourTurn';
      default:
        if (state.phase !== 'deal' && state.phase !== 'bus') return 'rtb.error.notGuessing';
        if (actor !== 'host' && actor !== answerer(state)) return 'error.notYourTurn';
        return action.type === QUESTIONS[questionIndex(state)] ? null : 'rtb.error.wrongQuestion';
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'FLIP':
        return flip(state, ctx);
      case 'BOARD':
        return {
          state: {
            ...state,
            phase: 'bus',
            // A fresh deck for the bus: every card comes back and gets shuffled.
            deck: shuffledDeck(ctx.rng),
            discard: [],
            hands: state.order.map(() => []),
            pyramid: [],
            flipped: 0,
          },
          effects: [],
        };
      default:
        return state.phase === 'bus'
          ? answerBus(state, action, ctx, rules)
          : answerDeal(state, action, ctx, rules);
    }
  },

  project(state): View {
    const { deck, discard, pyramid, ...rest } = state;
    const guessing = state.phase === 'deal' || state.phase === 'bus';
    return {
      ...rest,
      deckCount: deck.length,
      discardCount: discard.length,
      pyramid: pyramid.map((p) => ({ row: p.row, card: p.faceUp ? p.card : null })),
      current: answerer(state),
      question: guessing ? (QUESTIONS[questionIndex(state)] ?? null) : null,
    };
  },

  activeActor: (state) => (state.phase === 'pyramid' ? 'any' : answerer(state)),
  isOver: (state) => state.order.length === 0 || state.phase === 'over',
};

function answerDeal(state: State, answer: Answer, ctx: Ctx, rules: Rules): Step {
  const player = at(state.order, state.turn);
  const hand = state.hands[state.turn] ?? [];
  const q = hand.length;
  const { card, deck, discard } = drawCard(state.deck, state.discard, ctx.rng);
  const correct = judge(answer, card, hand, rules.aceHigh);
  const effects: Effect[] = [];
  if (!correct) {
    effects.push({
      type: 'drink',
      to: [player],
      amount: wrongAmount(rules, q),
      kind: 'drink',
      reason: { key: 'rtb.reason.wrong', params: { q: q + 1 } },
    });
  }

  let next: State = {
    ...state,
    deck,
    discard,
    hands: state.hands.map((h, i) => (i === state.turn ? [...h, card] : h)),
    last: { player, phase: 'deal', question: answer.type, guess: answer.guess, card, correct },
  };
  if (q + 1 < QUESTIONS.length) return { state: next, effects };

  // This player has all four cards: pass to the next one, or move on.
  const turn = state.turn + 1;
  if (turn < state.order.length) {
    effects.push({ type: 'passTo', player: at(state.order, turn), private: false });
    return { state: { ...next, turn }, effects };
  }
  next = { ...next, turn: state.order.length - 1 };
  if (!rules.pyramid) return toBoard(next, ctx, effects);

  let pile = next.deck;
  let used = next.discard;
  const pyramid: PyramidCard[] = [];
  PYRAMID_ROWS.forEach((count, r) => {
    for (let k = 0; k < count; k++) {
      const d = drawCard(pile, used, ctx.rng);
      pile = d.deck;
      used = d.discard;
      pyramid.push({ card: d.card, row: r + 1, faceUp: false });
    }
  });
  return {
    state: { ...next, phase: 'pyramid', deck: pile, discard: used, pyramid, flipped: 0 },
    effects,
  };
}

/** Turns the next pyramid card; everyone holding its rank hands out row × matches sips. */
function flip(state: State, ctx: Ctx): Step {
  const slot = state.pyramid[state.flipped] as PyramidCard;
  const rank = rankOf(slot.card);
  const effects: Effect[] = [];
  const matched: Card[] = [];
  const hands = state.hands.map((hand, i) => {
    const matches = hand.filter((c) => rankOf(c) === rank);
    if (matches.length === 0) return hand;
    const player = at(state.order, i);
    const sips = slot.row * matches.length;
    matched.push(...matches);
    effects.push(
      {
        type: 'notice',
        msg: {
          key: 'rtb.notice.give',
          params: { name: nameOf(ctx, player), sips, card: rankKey(slot.card) },
        },
      },
      {
        type: 'drink',
        to: [player],
        amount: sips,
        kind: 'give',
        reason: { key: 'rtb.reason.give', params: { card: rankKey(slot.card) } },
      },
    );
    return hand.filter((c) => rankOf(c) !== rank);
  });

  const flipped = state.flipped + 1;
  const next: State = {
    ...state,
    hands,
    discard: [...state.discard, ...matched],
    pyramid: state.pyramid.map((p, i) => (i === state.flipped ? { ...p, faceUp: true } : p)),
    flipped,
  };
  return flipped < state.pyramid.length ? { state: next, effects } : toBoard(next, ctx, effects);
}

/** Whoever has the most cards left rides the bus (ties broken by the RNG). */
function toBoard(state: State, ctx: Ctx, effects: Effect[]): Step {
  const leftover = state.hands.map((h) => h.length);
  const most = Math.max(...leftover);
  const tied = state.order.filter((_, i) => leftover[i] === most);
  const rider = tied.length === 1 ? (tied[0] as PlayerId) : ctx.rng.pick(tied);
  effects.push(
    {
      type: 'notice',
      msg: { key: 'rtb.notice.rider', params: { name: nameOf(ctx, rider), cards: most } },
    },
    { type: 'passTo', player: rider, private: false },
  );
  return {
    state: {
      ...state,
      phase: 'board',
      leftover,
      bus: { rider, attempt: 1, cards: [], outcome: null },
    },
    effects,
  };
}

function answerBus(state: State, answer: Answer, ctx: Ctx, rules: Rules): Step {
  const bus = state.bus as Bus;
  const q = bus.cards.length;
  const { card, deck, discard } = drawCard(state.deck, state.discard, ctx.rng);
  const correct = judge(answer, card, bus.cards, rules.aceHigh);
  const last: LastAnswer = {
    player: bus.rider,
    phase: 'bus',
    question: answer.type,
    guess: answer.guess,
    card,
    correct,
  };
  const name = nameOf(ctx, bus.rider);

  if (correct) {
    const cards = [...bus.cards, card];
    const off = cards.length === QUESTIONS.length;
    return {
      state: {
        ...state,
        deck,
        discard,
        last,
        phase: off ? 'over' : 'bus',
        bus: { ...bus, cards, outcome: off ? 'offBus' : null },
      },
      effects: off ? [{ type: 'notice', msg: { key: 'rtb.notice.offBus', params: { name } } }] : [],
    };
  }

  const effects: Effect[] = [
    {
      type: 'drink',
      to: [bus.rider],
      amount: wrongAmount(rules, q),
      kind: 'drink',
      reason: { key: 'rtb.reason.busWrong', params: { q: q + 1 } },
    },
  ];
  // The failed run's cards go to the discard pile.
  const used = [...discard, ...bus.cards, card];
  const released = bus.attempt >= rules.busMaxAttempts;
  if (released) {
    effects.push({ type: 'notice', msg: { key: 'rtb.notice.released', params: { name } } });
  } else {
    effects.push({
      type: 'notice',
      msg: {
        key: 'rtb.notice.restart',
        params: { name, attempt: bus.attempt + 1, max: rules.busMaxAttempts },
      },
    });
  }
  return {
    state: {
      ...state,
      deck,
      discard: used,
      last,
      phase: released ? 'over' : 'bus',
      bus: {
        ...bus,
        attempt: released ? bus.attempt : bus.attempt + 1,
        cards: [],
        outcome: released ? 'released' : null,
      },
    },
    effects,
  };
}
