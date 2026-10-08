import { z } from 'zod';
import type { PromptItem } from '../../content/schemas';
import type { Rng } from '../../engine/rng';
import type { Ctx, Effect, GameLogic, PlayerId } from '../../engine/types';
import { at, nextIndex, seatOrder } from '../../primitives/turn';

export const rulesSchema = z.object({
  /** point = the table points IRL and the reader records it; secret = everyone votes privately. */
  voting: z.enum(['point', 'secret']).default('point').meta({ label: 'rules.mlt.voting' }),
  sips: z.number().int().min(1).max(5).default(1).meta({ label: 'rules.mlt.sips' }),
  maxSpice: z.number().int().min(0).max(3).default(1).meta({ label: 'rules.mlt.maxSpice' }),
  /** 0 = play until the deck runs out. */
  rounds: z.number().int().min(0).max(200).default(0).meta({ label: 'rules.mlt.rounds' }),
});
export type Rules = z.output<typeof rulesSchema>;

const playerId = z.string().min(1).max(24);

export const actionSchema = z.discriminatedUnion('type', [
  /** Point mode: the players the table pointed at. They drink. */
  z.object({ type: z.literal('PICK'), players: z.array(playerId).min(1).max(50) }),
  /** Secret mode: the current voter's pick. */
  z.object({ type: z.literal('VOTE'), for: playerId }),
  /** Next prompt: after a reveal, or to skip a prompt before anyone has voted. */
  z.object({ type: z.literal('NEXT') }),
]);
export type Action = z.output<typeof actionSchema>;

export interface Current {
  item: PromptItem;
  /** Placeholder targets fixed by the reducer. `{player}` is the reader; `{left}`/`{right}` come from `order`. */
  targets: { random?: PlayerId };
}

export interface Result {
  round: number;
  item: PromptItem;
  /** Who drank: the players pointed at, or the top vote-getters. */
  picked: PlayerId[];
  /** Secret mode: votes received per seat, aligned with `order`. Null in point mode. */
  tally: number[] | null;
  /** Secret mode: who each seat voted for, aligned with `order`. Null in point mode. */
  votes: PlayerId[] | null;
}

export interface State {
  order: PlayerId[];
  /** Index into `order` of the player reading the current prompt. */
  reader: number;
  /** Remaining prompts; the next one is the last element. Hidden from views. */
  deck: PromptItem[];
  prompt: Current | null;
  /** 1-based number of the current prompt (0 when nothing was drawn). */
  round: number;
  /** read: point mode, waiting for PICK · vote: secret voting · reveal: tallies are out · over. */
  phase: 'read' | 'vote' | 'reveal' | 'over';
  /** Secret mode: each seat's vote this round, aligned with `order` (null = not yet). Hidden until the reveal. */
  votes: (PlayerId | null)[];
  /** Votes cast this round. Voting starts at the reader and goes around the table. */
  cast: number;
  /** The latest settled prompt (this round's during `reveal`). */
  last: Result | null;
}

export interface View {
  order: PlayerId[];
  reader: number;
  prompt: Current | null;
  round: number;
  phase: State['phase'];
  /** Prompts left in the deck. */
  remaining: number;
  /** Secret mode: who votes now (phase `vote`). */
  voter: PlayerId | null;
  /** Who has voted this round, aligned with `order`. */
  voted: boolean[];
  /** The viewer's own vote this round; always null for the 'table' view. */
  myVote: PlayerId | null;
  /** Votes and tallies appear here only once they're revealed. */
  last: Result | null;
}

const nameOf = (ctx: Ctx, id: PlayerId): string => ctx.players.find((p) => p.id === id)?.name ?? id;

const mentions = (item: PromptItem, placeholder: string): boolean =>
  item.text.includes(placeholder) ||
  Object.values(item.alt ?? {}).some((t) => t?.includes(placeholder));

function draw(deck: PromptItem[], order: PlayerId[], reader: number, rng: Rng) {
  const item = deck[deck.length - 1];
  if (!item) return { deck, prompt: null };
  const targets: Current['targets'] = {};
  if (mentions(item, '{random}') && order.length > 0) {
    // Prefer someone other than the reader so the prompt makes sense.
    const others = order.length > 1 ? order.filter((_, i) => i !== reader) : order;
    targets.random = rng.pick(others);
  }
  return { deck: deck.slice(0, -1), prompt: { item, targets } };
}

export const voterOf = (state: State): PlayerId =>
  at(state.order, (state.reader + state.cast) % state.order.length);

const amountOf = (state: State, rules: Rules): number =>
  (state.prompt as Current).item.sips ?? rules.sips;

/** Rotates the reader and draws the next prompt (or ends the game). */
function advance(state: State, ctx: Ctx, rules: Rules, effects: Effect[]) {
  const reader = nextIndex(state.reader, state.order.length);
  const limitReached = rules.rounds > 0 && state.round >= rules.rounds;
  const next = limitReached
    ? { deck: state.deck, prompt: null }
    : draw(state.deck, state.order, reader, ctx.rng);
  const secret = rules.voting === 'secret';
  if (next.prompt) {
    // In secret mode the reader votes first, so the pass is private.
    effects.push({ type: 'passTo', player: at(state.order, reader), private: secret });
  }
  const phase: State['phase'] = !next.prompt ? 'over' : secret ? 'vote' : 'read';
  return {
    state: {
      ...state,
      reader,
      deck: next.deck,
      prompt: next.prompt,
      round: next.prompt ? state.round + 1 : state.round,
      phase,
      votes: state.order.map(() => null),
      cast: 0,
    },
    effects,
  };
}

export const mostLikelyTo: GameLogic<State, Action, Rules> = {
  id: 'most-likely-to',
  version: 1,
  meta: { family: 'party', min: 3, max: 20, hiddenInfo: true, needsContent: true },
  rulesSchema,
  actionSchema,

  setup(rules, ctx, content) {
    const order = seatOrder(ctx.players);
    const pool = (content.prompts ?? []).filter((p) => p.spice <= rules.maxSpice);
    const shuffled = ctx.rng.shuffle(pool);
    const base: State = {
      order,
      reader: 0,
      deck: shuffled,
      prompt: null,
      round: 0,
      phase: 'over',
      votes: order.map(() => null),
      cast: 0,
      last: null,
    };
    if (order.length === 0) return base;
    const { deck, prompt } = draw(shuffled, order, 0, ctx.rng);
    if (!prompt) return base;
    return {
      ...base,
      deck,
      prompt,
      round: 1,
      phase: rules.voting === 'secret' ? 'vote' : 'read',
    };
  },

  validate(state, action, actor, rules) {
    if (state.order.length === 0) return 'error.noPlayers';
    if (state.phase === 'over' || !state.prompt) return 'error.gameOver';
    const reader = at(state.order, state.reader);

    switch (action.type) {
      case 'PICK':
        if (rules.voting !== 'point') return 'mlt.error.secretMode';
        if (actor !== 'host' && actor !== reader) return 'error.notYourTurn';
        if (action.players.some((id) => !state.order.includes(id))) return 'mlt.error.badPlayer';
        if (new Set(action.players).size !== action.players.length) return 'mlt.error.duplicate';
        return null;
      case 'VOTE':
        if (rules.voting !== 'secret') return 'mlt.error.pointMode';
        if (state.phase !== 'vote') return 'mlt.error.notVoting';
        // A remote seat may only cast its own vote, when it's up.
        if (actor !== 'host' && actor !== voterOf(state)) return 'error.notYourTurn';
        return state.order.includes(action.for) ? null : 'mlt.error.badPlayer';
      case 'NEXT':
        if (state.phase === 'reveal') {
          return actor === 'host' || state.order.includes(actor) ? null : 'error.notYourTurn';
        }
        if (state.phase === 'vote' && state.cast > 0) return 'mlt.error.voting';
        return actor === 'host' || actor === reader ? null : 'error.notYourTurn';
    }
  },

  reduce(state, action, ctx, rules) {
    switch (action.type) {
      case 'PICK': {
        const effects: Effect[] = [];
        const amount = amountOf(state, rules);
        if (amount > 0) {
          effects.push({
            type: 'drink',
            to: [...action.players],
            amount,
            kind: 'drink',
            reason: { key: 'mlt.reason.most' },
          });
        }
        const last: Result = {
          round: state.round,
          item: (state.prompt as Current).item,
          picked: [...action.players],
          tally: null,
          votes: null,
        };
        return advance({ ...state, last }, ctx, rules, effects);
      }

      case 'VOTE': {
        const seat = (state.reader + state.cast) % state.order.length;
        const votes = state.votes.map((v, i) => (i === seat ? action.for : v));
        const cast = state.cast + 1;
        if (cast < state.order.length) {
          const next = at(state.order, (state.reader + cast) % state.order.length);
          return {
            state: { ...state, votes, cast },
            effects: [{ type: 'passTo', player: next, private: true }],
          };
        }
        return reveal({ ...state, votes, cast }, ctx, rules);
      }

      case 'NEXT':
        return advance(state, ctx, rules, []);
    }
  },

  project(state, viewer): View {
    const seat = viewer === 'table' ? -1 : state.order.indexOf(viewer);
    return {
      order: [...state.order],
      reader: state.reader,
      prompt: state.prompt,
      round: state.round,
      phase: state.phase,
      remaining: state.deck.length,
      voter: state.phase === 'vote' ? voterOf(state) : null,
      voted: state.votes.map((v) => v !== null),
      myVote: seat >= 0 ? (state.votes[seat] ?? null) : null,
      last: state.last,
    };
  },

  activeActor: (state) => {
    switch (state.phase) {
      case 'read':
        return state.order[state.reader] ?? null;
      case 'vote':
        return voterOf(state);
      case 'reveal':
        return 'any';
      case 'over':
        return null;
    }
  },
  isOver: (state) => state.order.length === 0 || state.phase === 'over',
};

/** Everyone has voted: count, and the top vote-getter(s) drink. */
function reveal(state: State, ctx: Ctx, rules: Rules) {
  const votes = state.votes as PlayerId[];
  const tally = state.order.map((id) => votes.filter((v) => v === id).length);
  const top = Math.max(...tally);
  const picked = state.order.filter((_, i) => tally[i] === top);
  const effects: Effect[] = [
    {
      type: 'notice',
      msg: {
        key: 'mlt.notice.most',
        params: { names: picked.map((id) => nameOf(ctx, id)).join(', '), votes: top },
      },
    },
  ];
  const amount = amountOf(state, rules);
  if (amount > 0) {
    effects.push({
      type: 'drink',
      to: picked,
      amount,
      kind: 'drink',
      reason: { key: 'mlt.reason.most' },
    });
  }
  const last: Result = {
    round: state.round,
    item: (state.prompt as Current).item,
    picked,
    tally,
    votes: [...votes],
  };
  return { state: { ...state, phase: 'reveal' as const, last }, effects };
}
