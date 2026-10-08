import { z } from 'zod';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { rollFaces, type Face } from '../../primitives/dice';
import { at, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  dicePerPlayer: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(5)
    .meta({ label: 'rules.ld.dicePerPlayer' }),
  onesWild: z.boolean().default(true).meta({ label: 'rules.ld.onesWild' }),
  spotOn: z.boolean().default(false).meta({ label: 'rules.ld.spotOn' }),
  loserSips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.ld.loserSips' }),
  loseDie: z.boolean().default(false).meta({ label: 'rules.ld.loseDie' }),
});
export type Rules = z.output<typeof rulesSchema>;

/** 20 seats × 6 dice. */
export const MAX_QUANTITY = 120;

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('BID'),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
    face: z.literal([1, 2, 3, 4, 5, 6]),
  }),
  z.object({ type: z.literal('CHALLENGE') }),
  z.object({ type: z.literal('SPOT_ON') }),
  z.object({ type: z.literal('NEXT_ROUND') }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Bid {
  player: PlayerId;
  quantity: number;
  face: Face;
}

export interface Reveal {
  call: 'challenge' | 'spotOn';
  caller: PlayerId;
  /** The bid that was called. */
  bid: Bid;
  /** Dice on the table matching the bid face (1s included when wild). */
  count: number;
  /** Whether the caller was right. */
  correct: boolean;
  /** Who drank (and lost a die with `loseDie`). */
  losers: PlayerId[];
  /** Everyone's dice as they were when the call was made, aligned with `order`. */
  hands: Face[][];
  /** Players who lost their last die on this call. */
  out: PlayerId[];
}

export interface State {
  order: PlayerId[];
  /** Hidden: each seat's dice, aligned with `order`. An empty hand is out of the game. */
  hands: Face[][];
  /** Index into `order` of the player to bid or call. */
  turn: number;
  /** 1-based round number. */
  round: number;
  phase: 'bidding' | 'reveal';
  /** This round's bids, oldest first. */
  bids: Bid[];
  /** Bumped on every (hidden) re-roll, so the UI can play a cup shake. */
  roll: { id: number };
  /** Set in the reveal phase only. */
  reveal: Reveal | null;
  /** With `loseDie`: the last player with dice. Ends the game. */
  winner: PlayerId | null;
}

/** What a viewer may see. Other players' faces appear only in `reveal.hands`, after a call. */
export interface View {
  order: PlayerId[];
  turn: number;
  /** Player to bid or call now; null in the reveal phase. */
  current: PlayerId | null;
  round: number;
  phase: State['phase'];
  /** Dice per seat, aligned with `order`. 0 = out. */
  counts: number[];
  totalDice: number;
  bids: Bid[];
  lastBid: Bid | null;
  roll: { id: number };
  /** The viewer's own dice; null for the shared 'table' view or a non-seated viewer. */
  mine: Face[] | null;
  reveal: Reveal | null;
  winner: PlayerId | null;
}

type Step = { state: State; effects: Effect[] };

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const totalDice = (hands: readonly Face[][]): number => hands.reduce((sum, h) => sum + h.length, 0);

const lastBid = (state: State): Bid | null => state.bids[state.bids.length - 1] ?? null;

/** Next seat after `from` that still has dice (or `from` itself if nobody else does). */
function nextActive(hands: readonly Face[][], from: number): number {
  const n = hands.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if ((hands[i]?.length ?? 0) > 0) return i;
  }
  return from;
}

/** A bid beats the previous one with more dice, or as many dice of a higher face. */
export const beats = (bid: Pick<Bid, 'quantity' | 'face'>, prev: Pick<Bid, 'quantity' | 'face'>) =>
  bid.quantity > prev.quantity || (bid.quantity === prev.quantity && bid.face > prev.face);

/** Dice showing `face`; with ones wild, 1s count too unless the bid is on 1s. */
export function countFace(
  hands: readonly (readonly Face[])[],
  face: Face,
  onesWild: boolean,
): number {
  let count = 0;
  for (const hand of hands)
    for (const f of hand) if (f === face || (onesWild && face !== 1 && f === 1)) count += 1;
  return count;
}

export const liarsDice: GameLogic<State, Action, Rules> = {
  id: 'liars-dice',
  version: 1,
  meta: { family: 'dice', min: 2, max: 20, hiddenInfo: true },
  rulesSchema,
  actionSchema,

  setup(rules, ctx) {
    const order = seatOrder(ctx.players);
    return {
      order,
      hands: order.map(() => rollFaces(ctx.rng, rules.dicePerPlayer)),
      turn: 0,
      round: 1,
      phase: 'bidding',
      bids: [],
      roll: { id: 1 },
      reveal: null,
      winner: null,
    };
  },

  validate(state, action, actor, rules) {
    if (state.order.length < 2) return 'error.noPlayers';
    if (state.winner !== null) return 'error.gameOver';

    if (action.type === 'NEXT_ROUND') {
      if (state.phase !== 'reveal') return 'ld.error.notReveal';
      if (actor !== 'host' && !state.order.includes(actor)) return 'error.notYourTurn';
      return null;
    }

    if (state.phase !== 'bidding') return 'ld.error.notBidding';
    // A remote seat may only act as the current bidder.
    if (actor !== 'host' && actor !== at(state.order, state.turn)) return 'error.notYourTurn';
    const prev = lastBid(state);

    switch (action.type) {
      case 'BID':
        if (action.quantity > totalDice(state.hands)) return 'ld.error.tooMany';
        if (prev && !beats(action, prev)) return 'ld.error.lowBid';
        return null;
      case 'CHALLENGE':
        return prev ? null : 'ld.error.noBid';
      case 'SPOT_ON':
        if (!rules.spotOn) return 'ld.error.spotOnOff';
        return prev ? null : 'ld.error.noBid';
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'BID': {
        const bid: Bid = {
          player: at(state.order, state.turn),
          quantity: action.quantity,
          face: action.face,
        };
        const turn = nextActive(state.hands, state.turn);
        return {
          state: { ...state, bids: [...state.bids, bid], turn },
          effects: [{ type: 'passTo', player: at(state.order, turn), private: true }],
        };
      }
      case 'CHALLENGE':
        return call(state, 'challenge', ctx, rules);
      case 'SPOT_ON':
        return call(state, 'spotOn', ctx, rules);
      case 'NEXT_ROUND':
        return nextRound(state, ctx);
    }
  },

  project(state, viewer): View {
    const seat = viewer === 'table' ? -1 : state.order.indexOf(viewer);
    const own = seat >= 0 ? state.hands[seat] : undefined;
    return {
      order: [...state.order],
      turn: state.turn,
      current:
        state.phase === 'bidding' && state.winner === null
          ? (state.order[state.turn] ?? null)
          : null,
      round: state.round,
      phase: state.phase,
      counts: state.hands.map((h) => h.length),
      totalDice: totalDice(state.hands),
      bids: state.bids.map((b) => ({ ...b })),
      lastBid: lastBid(state),
      roll: { ...state.roll },
      mine: own ? [...own] : null,
      // Only set after a call, when every hand is turned over anyway.
      reveal: state.phase === 'reveal' ? state.reveal : null,
      winner: state.winner,
    };
  },

  activeActor: (state) => {
    if (state.order.length < 2 || state.winner !== null) return null;
    if (state.phase === 'reveal') return 'any';
    return state.order[state.turn] ?? null;
  },
  isOver: (state) => state.order.length < 2 || state.winner !== null,
};

/** CHALLENGE or SPOT_ON: turn every hand over, count, and settle who drinks. */
function call(state: State, kind: Reveal['call'], ctx: Ctx, rules: Rules): Step {
  const bid = lastBid(state) as Bid;
  const caller = at(state.order, state.turn);
  const count = countFace(state.hands, bid.face, rules.onesWild);
  const inPlay = state.order.filter((_, i) => (state.hands[i]?.length ?? 0) > 0);

  let correct: boolean;
  let losers: PlayerId[];
  let reason: string;
  if (kind === 'challenge') {
    correct = count < bid.quantity;
    losers = [correct ? bid.player : caller];
    reason = correct ? 'ld.reason.caught' : 'ld.reason.badCall';
  } else {
    correct = count === bid.quantity;
    losers = correct ? inPlay.filter((p) => p !== caller) : [caller];
    reason = correct ? 'ld.reason.spotOn' : 'ld.reason.spotOnMiss';
  }

  const effects: Effect[] = [
    {
      type: 'notice',
      msg: { key: 'ld.notice.count', params: { count, face: bid.face, quantity: bid.quantity } },
    },
    { type: 'drink', to: losers, amount: rules.loserSips, kind: 'drink', reason: { key: reason } },
  ];

  let hands = state.hands;
  const out: PlayerId[] = [];
  let winner: PlayerId | null = null;
  if (rules.loseDie) {
    hands = state.hands.map((h, i) =>
      losers.includes(state.order[i] as PlayerId) ? h.slice(0, -1) : h,
    );
    state.order.forEach((p, i) => {
      if (losers.includes(p) && hands[i]?.length === 0) {
        out.push(p);
        effects.push({
          type: 'notice',
          msg: { key: 'ld.notice.out', params: { name: nameOf(ctx, p) } },
        });
      }
    });
    const left = state.order.filter((_, i) => (hands[i]?.length ?? 0) > 0);
    if (left.length === 1) {
      winner = left[0] as PlayerId;
      effects.push({
        type: 'notice',
        msg: { key: 'ld.notice.winner', params: { name: nameOf(ctx, winner) } },
      });
    }
  }

  return {
    state: {
      ...state,
      hands,
      phase: 'reveal',
      reveal: { call: kind, caller, bid, count, correct, losers, hands: state.hands, out },
      winner,
    },
    effects,
  };
}

/** Re-roll every hand; the loser starts (or the next seat with dice, if the loser is out). */
function nextRound(state: State, ctx: Ctx): Step {
  const reveal = state.reveal as Reveal;
  // A single loser starts; when several lost (a correct spot-on), play goes on from the caller.
  const anchor = reveal.losers.length === 1 ? (reveal.losers[0] as PlayerId) : reveal.caller;
  const i = state.order.indexOf(anchor);
  const anchorHasDice = (state.hands[i]?.length ?? 0) > 0;
  const turn = reveal.losers.length === 1 && anchorHasDice ? i : nextActive(state.hands, i);
  const hands = state.hands.map((h) => rollFaces(ctx.rng, h.length));
  return {
    state: {
      ...state,
      hands,
      turn,
      round: state.round + 1,
      phase: 'bidding',
      bids: [],
      roll: { id: state.roll.id + 1 },
      reveal: null,
    },
    effects: [{ type: 'passTo', player: at(state.order, turn), private: true }],
  };
}
