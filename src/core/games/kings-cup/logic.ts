import { z } from 'zod';
import type { DrinkEffect, Effect, GameLogic, PlayerId } from '../../engine/types';
import { RANK_KEYS, rankKey, shuffledDeck, type Card, type RankKey } from '../../primitives/deck';
import { at, leftOf, nextIndex, rightOf, seatOrder } from '../../primitives/turn';

export const EFFECTS = [
  'none',
  'self',
  'everyone',
  'left',
  'right',
  'choose',
  'loser',
  'mate',
  'questionMaster',
  'thumbMaster',
  'rule',
  'kingsCup',
] as const;
export type CardEffect = (typeof EFFECTS)[number];

/** Effects the group settles after the draw (who drinks, who's the mate, what's the rule). */
export const PENDING_EFFECTS = ['choose', 'loser', 'mate', 'rule'] as const;
export type PendingKind = (typeof PENDING_EFFECTS)[number];
const isPending = (e: CardEffect): e is PendingKind =>
  (PENDING_EFFECTS as readonly string[]).includes(e);

export const MAX_HOUSE_RULES = 10;
export const MAX_RULE_LENGTH = 140;

const DEFAULT_EFFECTS: Record<RankKey, { effect: CardEffect; sips: number }> = {
  A: { effect: 'everyone', sips: 1 }, // Waterfall
  '2': { effect: 'choose', sips: 2 }, // Ikaw / You
  '3': { effect: 'self', sips: 2 }, // Ako / Me
  '4': { effect: 'loser', sips: 1 }, // Floor
  '5': { effect: 'thumbMaster', sips: 1 },
  '6': { effect: 'everyone', sips: 1 }, // Tagay Lahat / Social
  '7': { effect: 'loser', sips: 1 }, // Heaven
  '8': { effect: 'mate', sips: 0 },
  '9': { effect: 'loser', sips: 1 }, // Rhyme
  '10': { effect: 'loser', sips: 1 }, // Categories
  J: { effect: 'rule', sips: 0 },
  Q: { effect: 'questionMaster', sips: 0 },
  K: { effect: 'kingsCup', sips: 1 },
};

const defaultCard = (rank: RankKey) => ({
  title: `i18n:kc.card.${rank}.title`,
  text: `i18n:kc.card.${rank}.text`,
  ...DEFAULT_EFFECTS[rank],
});

const cardRule = (rank: RankKey) =>
  z
    .object({
      title: z
        .string()
        .max(40)
        .default(`i18n:kc.card.${rank}.title`)
        .meta({ label: 'rules.kc.card.title' }),
      text: z
        .string()
        .max(240)
        .default(`i18n:kc.card.${rank}.text`)
        .meta({ label: 'rules.kc.card.text' }),
      effect: z
        .enum(EFFECTS)
        .default(DEFAULT_EFFECTS[rank].effect)
        .meta({ label: 'rules.kc.card.effect' }),
      sips: z
        .number()
        .int()
        .min(0)
        .max(5)
        .default(DEFAULT_EFFECTS[rank].sips)
        .meta({ label: 'rules.kc.card.sips' }),
    })
    .default(() => defaultCard(rank))
    .meta({ label: `rules.kc.rank.${rank}` });

const cardsSchema = z.object({
  A: cardRule('A'),
  '2': cardRule('2'),
  '3': cardRule('3'),
  '4': cardRule('4'),
  '5': cardRule('5'),
  '6': cardRule('6'),
  '7': cardRule('7'),
  '8': cardRule('8'),
  '9': cardRule('9'),
  '10': cardRule('10'),
  J: cardRule('J'),
  Q: cardRule('Q'),
  K: cardRule('K'),
});

const defaultCards = () =>
  Object.fromEntries(RANK_KEYS.map((r) => [r, defaultCard(r)])) as z.output<typeof cardsSchema>;

export const rulesSchema = z.object({
  cards: cardsSchema.default(defaultCards).meta({ label: 'rules.kc.cards' }),
  endOnFourthKing: z.boolean().default(true).meta({ label: 'rules.kc.endOnFourthKing' }),
});
export type Rules = z.output<typeof rulesSchema>;
export type CardRule = Rules['cards'][RankKey];

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DRAW') }),
  z.object({
    type: z.literal('RESOLVE'),
    target: z.string().min(1).max(24).optional(),
    text: z.string().max(500).optional(),
  }),
  z.object({ type: z.literal('SKIP') }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Pending {
  kind: PendingKind;
  /** Who drew the card. */
  by: PlayerId;
  sips: number;
  rank: RankKey;
}

export interface State {
  order: PlayerId[];
  turn: number;
  /** Draw pile; the next card is the last element. Hidden from views. */
  deck: Card[];
  /** Face-up cards in draw order; the current card is the last element. */
  drawn: Card[];
  kingsDrawn: number;
  mates: [PlayerId, PlayerId][];
  roles: { questionMaster?: PlayerId; thumbMaster?: PlayerId };
  houseRules: string[];
  pending: Pending | null;
  /** Set on the 4th king (if the rule is on) or an empty deck. A pending prompt still gets resolved first. */
  over: boolean;
}

export interface View extends Omit<State, 'deck'> {
  deckCount: number;
}

/** The players plus their mates (one level, deduped, in first-seen order). */
export function withMates(targets: readonly PlayerId[], mates: State['mates']): PlayerId[] {
  const out = new Set(targets);
  for (const id of targets) {
    for (const [a, b] of mates) {
      if (a === id) out.add(b);
      if (b === id) out.add(a);
    }
  }
  return [...out];
}

function drink(
  to: PlayerId[],
  amount: number,
  kind: DrinkEffect['kind'],
  effect: CardEffect,
  rank: RankKey,
  finish = false,
): DrinkEffect[] {
  if (to.length === 0 || (amount <= 0 && !finish)) return [];
  return [
    {
      type: 'drink',
      to,
      amount,
      kind,
      ...(finish ? { finish: true } : {}),
      reason: { key: `kc.reason.${effect}`, params: { card: rank } },
    },
  ];
}

const seated = (state: State, id: PlayerId | undefined): id is PlayerId =>
  id !== undefined && state.order.includes(id);

export const kingsCup: GameLogic<State, Action, Rules> = {
  id: 'kings-cup',
  version: 1,
  meta: { family: 'cards', min: 2, max: 20, hiddenInfo: false },
  rulesSchema,
  actionSchema,

  setup(_rules, ctx) {
    const order = seatOrder(ctx.players);
    return {
      order,
      turn: 0,
      deck: shuffledDeck(ctx.rng),
      drawn: [],
      kingsDrawn: 0,
      mates: [],
      roles: {},
      houseRules: [],
      pending: null,
      over: order.length === 0,
    };
  },

  validate(state, action, actor) {
    if (state.order.length === 0) return 'error.noPlayers';

    if (action.type === 'DRAW') {
      if (state.over) return 'error.gameOver';
      if (state.pending) return 'kc.error.pending';
      if (actor !== 'host' && actor !== at(state.order, state.turn)) return 'error.notYourTurn';
      return null;
    }

    const pending = state.pending;
    if (!pending) return 'kc.error.noPending';
    // The group settles a pending card; a remote seat must at least be at the table.
    if (actor !== 'host' && !state.order.includes(actor)) return 'error.notYourTurn';
    if (action.type === 'SKIP') return null;

    switch (pending.kind) {
      case 'choose':
      case 'loser':
        return seated(state, action.target) ? null : 'kc.error.badTarget';
      case 'mate':
        if (!seated(state, action.target)) return 'kc.error.badTarget';
        return action.target === pending.by ? 'kc.error.selfMate' : null;
      case 'rule': {
        const len = (action.text ?? '').trim().length;
        return len >= 1 && len <= MAX_RULE_LENGTH ? null : 'kc.error.ruleText';
      }
    }
  },

  // Draws come off the pre-shuffled deck, so the reducer needs no RNG.
  reduce(state, action, _ctx, rules) {
    if (action.type === 'SKIP') return { state: { ...state, pending: null }, effects: [] };
    if (action.type === 'RESOLVE') return resolve(state, action);

    const n = state.order.length;
    const drawer = at(state.order, state.turn);
    const card = state.deck[state.deck.length - 1] as Card;
    const deck = state.deck.slice(0, -1);
    const rank = rankKey(card);
    const rule = rules.cards[rank];
    const effects: Effect[] = [];

    let { kingsDrawn, roles } = state;
    let pending: Pending | null = null;
    let over = deck.length === 0;

    const isKing = rank === 'K';
    if (isKing) kingsDrawn += 1;
    const fourthKing = isKing && kingsDrawn >= 4;
    if (fourthKing && rules.endOnFourthKing) over = true;

    switch (rule.effect) {
      case 'none':
        break;
      case 'self':
        effects.push(...drink(withMates([drawer], state.mates), rule.sips, 'drink', 'self', rank));
        break;
      case 'everyone':
        // The ace is the classic waterfall; any other "everyone" card is a social drink.
        effects.push(
          ...drink(
            [...state.order],
            rule.sips,
            rank === 'A' ? 'waterfall' : 'social',
            'everyone',
            rank,
          ),
        );
        break;
      case 'left':
        effects.push(
          ...drink(
            withMates([leftOf(state.order, state.turn)], state.mates),
            rule.sips,
            'drink',
            'left',
            rank,
          ),
        );
        break;
      case 'right':
        effects.push(
          ...drink(
            withMates([rightOf(state.order, state.turn)], state.mates),
            rule.sips,
            'drink',
            'right',
            rank,
          ),
        );
        break;
      case 'questionMaster':
        roles = { ...roles, questionMaster: drawer };
        break;
      case 'thumbMaster':
        roles = { ...roles, thumbMaster: drawer };
        break;
      case 'kingsCup':
        if (fourthKing) {
          effects.push(
            ...drink(withMates([drawer], state.mates), rule.sips, 'drink', 'kingsCup', rank, true),
          );
        } else {
          effects.push({
            type: 'notice',
            msg: { key: 'kc.notice.pour', params: { left: Math.max(4 - kingsDrawn, 0) } },
          });
        }
        break;
      default:
        if (isPending(rule.effect))
          pending = { kind: rule.effect, by: drawer, sips: rule.sips, rank };
    }

    const turn = nextIndex(state.turn, n);
    if (!over) effects.push({ type: 'passTo', player: at(state.order, turn), private: false });

    return {
      state: {
        ...state,
        deck,
        drawn: [...state.drawn, card],
        turn,
        kingsDrawn,
        roles,
        pending,
        over,
      },
      effects,
    };
  },

  project(state): View {
    const { deck, ...rest } = state;
    return { ...rest, deckCount: deck.length };
  },

  activeActor: (state) => {
    if (state.pending) return 'any';
    if (state.over) return null;
    return state.order[state.turn] ?? null;
  },
  isOver: (state) => state.order.length === 0 || (state.over && state.pending === null),
};

function resolve(state: State, action: Extract<Action, { type: 'RESOLVE' }>) {
  const pending = state.pending as Pending;
  const next = { ...state, pending: null };
  const effects: Effect[] = [];

  switch (pending.kind) {
    case 'choose':
    case 'loser': {
      const to = withMates([action.target as PlayerId], state.mates);
      effects.push(
        ...drink(
          to,
          pending.sips,
          pending.kind === 'choose' ? 'give' : 'drink',
          pending.kind,
          pending.rank,
        ),
      );
      break;
    }
    case 'mate': {
      const target = action.target as PlayerId;
      const exists = state.mates.some(
        ([a, b]) => (a === pending.by && b === target) || (a === target && b === pending.by),
      );
      if (!exists) next.mates = [...state.mates, [pending.by, target]];
      break;
    }
    case 'rule': {
      const text = (action.text ?? '').trim().slice(0, MAX_RULE_LENGTH);
      next.houseRules = [...state.houseRules, text].slice(-MAX_HOUSE_RULES);
      break;
    }
  }
  return { state: next, effects };
}
