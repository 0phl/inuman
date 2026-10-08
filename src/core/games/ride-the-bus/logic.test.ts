import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect, PlayerId } from '../../engine/types';
import { SUITS, rankOf, type Card } from '../../primitives/deck';
import { intensity, players } from '../../test/fixtures';
import {
  QUESTIONS,
  drawCard,
  judge,
  questionIndex,
  rideTheBus as rtb,
  rulesSchema,
  type Action,
  type Answer,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: Partial<Rules> = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy');
const ctx = (seed = 1) => ({ players: PLAYERS, rng: createRng(seed) });
type Step = { state: State; effects: Effect[] };

// Cards: suit = floor(c / 13) (S, H, D, C), rank = c % 13 + 2.
const card = (rank: number, suit: 'S' | 'H' | 'D' | 'C' = 'S'): Card =>
  SUITS.indexOf(suit) * 13 + (rank - 2);

const act = (s: State, a: Action, r: Rules = rules(), actor: Actor = 'host', seed = 1): Step => {
  expect(rtb.validate(s, a, actor, r)).toBeNull();
  return rtb.reduce(s, a, ctx(seed), r);
};
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');

const rb = (guess: 'red' | 'black'): Answer => ({ type: 'RED_BLACK', guess });
const hl = (guess: 'higher' | 'lower'): Answer => ({ type: 'HIGHER_LOWER', guess });
const io = (guess: 'inside' | 'outside'): Answer => ({ type: 'INSIDE_OUTSIDE', guess });
const suit = (guess: 'S' | 'H' | 'D' | 'C'): Answer => ({ type: 'SUIT', guess });

/** A fresh deal state whose deck yields `next` in order (top first), over a full 52-card set. */
function rigged(next: Card[], patch: Partial<State> = {}): State {
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !next.includes(c));
  return {
    order: ['p1', 'p2', 'p3'],
    phase: 'deal',
    turn: 0,
    hands: [[], [], []],
    deck: [...rest, ...next.slice().reverse()],
    discard: [],
    pyramid: [],
    flipped: 0,
    leftover: null,
    bus: null,
    last: null,
    ...patch,
  };
}

/** Every card the game holds, wherever it is. */
const allCards = (s: State): Card[] => [
  ...s.deck,
  ...s.discard,
  ...s.hands.flat(),
  ...s.pyramid.map((p) => p.card),
  ...(s.bus?.cards ?? []),
];

/** The right (or deliberately wrong) answer for the question at hand, by peeking at the deck. */
function answerFor(s: State, right: boolean, r: Rules): Answer {
  const q = QUESTIONS[questionIndex(s)];
  const top = s.deck[s.deck.length - 1];
  const options: Answer[] =
    q === 'RED_BLACK'
      ? [rb('red'), rb('black')]
      : q === 'HIGHER_LOWER'
        ? [hl('higher'), hl('lower')]
        : q === 'INSIDE_OUTSIDE'
          ? [io('inside'), io('outside')]
          : SUITS.map(suit);
  const prev = s.phase === 'bus' ? (s.bus?.cards ?? []) : (s.hands[s.turn] ?? []);
  if (top === undefined) return options[0] as Answer;
  return (options.find((o) => judge(o, top, prev, r.aceHigh) === right) ?? options[0]) as Answer;
}

describe('ride the bus rules', () => {
  it('parses defaults and bounds', () => {
    expect(rules()).toEqual({
      wrongSips: 'escalating',
      pyramid: true,
      busMaxAttempts: 5,
      aceHigh: true,
    });
    expect(rulesSchema.safeParse({ busMaxAttempts: 0 }).success).toBe(false);
    expect(rulesSchema.safeParse({ busMaxAttempts: 11 }).success).toBe(false);
    expect(rulesSchema.safeParse({ wrongSips: 'double' }).success).toBe(false);
    expect(rtb.meta).toMatchObject({ family: 'cards', max: 10 });
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.rtb.${key}`);
      expect(field.default).toBeDefined();
    }
  });

  it('rejects malformed answers at the schema', () => {
    expect(rtb.actionSchema.safeParse({ type: 'RED_BLACK', guess: 'green' }).success).toBe(false);
    expect(rtb.actionSchema.safeParse({ type: 'SUIT', guess: 'X' }).success).toBe(false);
    expect(rtb.actionSchema.safeParse({ type: 'HIGHER_LOWER' }).success).toBe(false);
  });
});

describe('judging answers', () => {
  it('red or black', () => {
    expect(judge(rb('red'), card(5, 'H'), [], true)).toBe(true);
    expect(judge(rb('red'), card(5, 'D'), [], true)).toBe(true);
    expect(judge(rb('black'), card(5, 'C'), [], true)).toBe(true);
    expect(judge(rb('black'), card(5, 'H'), [], true)).toBe(false);
  });

  it('higher or lower: equal is wrong; aces follow aceHigh', () => {
    const first = [card(8)];
    expect(judge(hl('higher'), card(9), first, true)).toBe(true);
    expect(judge(hl('lower'), card(9), first, true)).toBe(false);
    expect(judge(hl('higher'), card(8, 'H'), first, true)).toBe(false);
    expect(judge(hl('lower'), card(8, 'H'), first, true)).toBe(false);
    expect(judge(hl('higher'), card(14), first, true)).toBe(true);
    expect(judge(hl('lower'), card(14), first, false)).toBe(true);
  });

  it('inside or outside: an edge is wrong either way, in any card order', () => {
    for (const prev of [
      [card(4), card(10)],
      [card(10), card(4)],
    ]) {
      expect(judge(io('inside'), card(7), prev, true)).toBe(true);
      expect(judge(io('outside'), card(7), prev, true)).toBe(false);
      expect(judge(io('outside'), card(2), prev, true)).toBe(true);
      expect(judge(io('outside'), card(13), prev, true)).toBe(true);
      for (const edge of [card(4, 'H'), card(10, 'D')]) {
        expect(judge(io('inside'), edge, prev, true)).toBe(false);
        expect(judge(io('outside'), edge, prev, true)).toBe(false);
      }
    }
    // A pair: nothing is inside.
    expect(judge(io('inside'), card(6), [card(6), card(6, 'H')], true)).toBe(false);
  });

  it('suit', () => {
    expect(judge(suit('D'), card(3, 'D'), [], true)).toBe(true);
    expect(judge(suit('S'), card(3, 'D'), [], true)).toBe(false);
  });
});

describe('drawing', () => {
  it('takes the top card and refills from the shuffled discard when empty', () => {
    expect(drawCard([1, 2, 3], [9], createRng(1))).toEqual({ card: 3, deck: [1, 2], discard: [9] });
    const refill = drawCard([], [4, 5, 6], createRng(1));
    expect([4, 5, 6]).toContain(refill.card);
    expect([...refill.deck, refill.card].sort()).toEqual([4, 5, 6]);
    expect(refill.discard).toEqual([]);
    expect(() => drawCard([], [], createRng(1))).toThrow();
  });
});

describe('the deal', () => {
  it('starts with the first player on Q1 and a full hidden deck', () => {
    const s = rtb.setup(rules(), ctx(), {});
    expect(s).toMatchObject({ phase: 'deal', turn: 0, hands: [[], [], []] });
    expect([...s.deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect(rtb.activeActor(s)).toBe('p1');
    const view = rtb.project(s, 'table') as View & Record<string, unknown>;
    expect(view.deck).toBeUndefined();
    expect(view).toMatchObject({ deckCount: 52, question: 'RED_BLACK', current: 'p1' });
  });

  it('asks Q1–Q4 in order; every card lands in the hand; wrong answers escalate', () => {
    // Red 9, then a 5 (lower), then a King (outside 5..9), then a club.
    const s0 = rigged([card(9, 'H'), card(5, 'S'), card(13, 'D'), card(7, 'C')]);
    expect(rtb.validate(s0, hl('higher'), 'host', rules())).toBe('rtb.error.wrongQuestion');

    const q1 = act(s0, rb('black'));
    expect(drinks(q1.effects)).toEqual([
      {
        type: 'drink',
        to: ['p1'],
        amount: 1,
        kind: 'drink',
        reason: { key: 'rtb.reason.wrong', params: { q: 1 } },
      },
    ]);
    expect(q1.state.hands[0]).toEqual([card(9, 'H')]);
    expect(q1.state.last).toEqual({
      player: 'p1',
      phase: 'deal',
      question: 'RED_BLACK',
      guess: 'black',
      card: card(9, 'H'),
      correct: false,
    });

    const q2 = act(q1.state, hl('higher'));
    expect(drinks(q2.effects)).toMatchObject([{ amount: 2, reason: { params: { q: 2 } } }]);
    const q3 = act(q2.state, io('outside'));
    expect(q3.effects).toEqual([]);
    expect(q3.state.last?.correct).toBe(true);
    const q4 = act(q3.state, suit('S'));
    expect(drinks(q4.effects)).toMatchObject([{ to: ['p1'], amount: 4 }]);
    expect(q4.state.hands[0]).toEqual([card(9, 'H'), card(5, 'S'), card(13, 'D'), card(7, 'C')]);
    // Four cards: on to the next player.
    expect(q4.state.turn).toBe(1);
    expect(q4.effects).toContainEqual({ type: 'passTo', player: 'p2', private: false });
    expect(rtb.activeActor(q4.state)).toBe('p2');
    expect(questionIndex(q4.state)).toBe(0);
  });

  it('fixed penalties are always 1', () => {
    const r = rules({ wrongSips: 'fixed' });
    const s0 = rigged([card(9, 'H'), card(5, 'S'), card(13, 'D'), card(7, 'C')]);
    let s = s0;
    const amounts: number[] = [];
    for (const a of [rb('black'), hl('higher'), io('inside'), suit('H')]) {
      const out = act(s, a, r);
      amounts.push(...drinks(out.effects).map((d) => d.amount));
      s = out.state;
    }
    expect(amounts).toEqual([1, 1, 1, 1]);
  });

  it('only the player answering may act remotely', () => {
    const s = rtb.setup(rules(), ctx(), {});
    expect(rtb.validate(s, rb('red'), 'p2', rules())).toBe('error.notYourTurn');
    expect(rtb.validate(s, rb('red'), 'p1', rules())).toBeNull();
    expect(rtb.validate(s, { type: 'FLIP' }, 'host', rules())).toBe('rtb.error.notPyramid');
    expect(rtb.validate(s, { type: 'BOARD' }, 'host', rules())).toBe('rtb.error.notBoarding');
  });
});

/** Plays the deal, answering right whenever the card allows it. */
function playDeal(s: State, r: Rules, seed = 1): Step {
  let step: Step = { state: s, effects: [] };
  while (step.state.phase === 'deal')
    step = act(step.state, answerFor(step.state, true, r), r, 'host', seed);
  return step;
}

/** Moves `next` to the top of the deck (top first), keeping every card. */
const stack = (s: State, next: Card[]): State => ({
  ...s,
  deck: [...s.deck.filter((c) => !next.includes(c)), ...next.slice().reverse()],
});

describe('the pyramid', () => {
  it('lays out 4-3-2-1 face down after the deal, hidden from views', () => {
    const { state, effects } = playDeal(rtb.setup(rules(), ctx(), {}), rules());
    expect(state.phase).toBe('pyramid');
    expect(state.pyramid.map((p) => p.row)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 3, 4]);
    expect(state.pyramid.every((p) => !p.faceUp)).toBe(true);
    expect(effects.some((e) => e.type === 'passTo')).toBe(false);
    expect(rtb.activeActor(state)).toBe('any');
    const view = rtb.project(state, 'table') as View;
    expect(view.pyramid.every((p) => p.card === null)).toBe(true);
    expect(view).toMatchObject({ deckCount: 52 - 12 - 10, current: null, question: null });
    expect(rtb.validate(state, rb('red'), 'host', rules())).toBe('rtb.error.notGuessing');
    expect(rtb.validate(state, { type: 'FLIP' }, 'stranger', rules())).toBe('error.notYourTurn');
  });

  it('FLIP: everyone holding the rank gives row × matches sips, and those cards leave their hand', () => {
    const sevens = [card(7, 'S'), card(7, 'H'), card(7, 'D'), card(7, 'C')];
    const s: State = {
      ...rigged([]),
      phase: 'pyramid',
      hands: [
        [sevens[0] as Card, sevens[1] as Card, card(2), card(3)],
        [card(4), card(5), card(6), card(8)],
        [sevens[2] as Card, card(9), card(10), card(11)],
      ],
      pyramid: [
        { card: card(12), row: 1, faceUp: true },
        { card: sevens[3] as Card, row: 2, faceUp: false },
      ],
      flipped: 1,
    };
    s.deck = s.deck.filter((c) => !allCards({ ...s, deck: [] }).includes(c));
    expect(allCards(s)).toHaveLength(52);

    const { state, effects } = act(s, { type: 'FLIP' }, rules(), 'p2');
    expect(effects.slice(0, 4)).toEqual([
      {
        type: 'notice',
        msg: { key: 'rtb.notice.give', params: { name: 'Ana', sips: 4, card: '7' } },
      },
      {
        type: 'drink',
        to: ['p1'],
        amount: 4,
        kind: 'give',
        reason: { key: 'rtb.reason.give', params: { card: '7' } },
      },
      {
        type: 'notice',
        msg: { key: 'rtb.notice.give', params: { name: 'Cy', sips: 2, card: '7' } },
      },
      {
        type: 'drink',
        to: ['p3'],
        amount: 2,
        kind: 'give',
        reason: { key: 'rtb.reason.give', params: { card: '7' } },
      },
    ]);
    expect(state.hands).toEqual([[card(2), card(3)], s.hands[1], [card(9), card(10), card(11)]]);
    expect(state.discard).toEqual([sevens[0], sevens[1], sevens[2]]);
    expect(state.pyramid[1]?.faceUp).toBe(true);
    expect(allCards(state).sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, i) => i));

    // That was the last pyramid card: Ben has the most left, so Ben rides.
    expect(state.phase).toBe('board');
    expect(state.leftover).toEqual([2, 4, 3]);
    expect(state.bus).toEqual({ rider: 'p2', attempt: 1, cards: [], outcome: null });
    expect(effects.slice(4)).toEqual([
      { type: 'notice', msg: { key: 'rtb.notice.rider', params: { name: 'Ben', cards: 4 } } },
      { type: 'passTo', player: 'p2', private: false },
    ]);
    expect(rtb.activeActor(state)).toBe('p2');
  });

  it('a flip nobody matches has no effects; the view reveals only turned cards', () => {
    const s = playDeal(rtb.setup(rules(), ctx(3), {}), rules()).state;
    let cur = s;
    for (let i = 0; i < 9; i++) {
      const out = act(cur, { type: 'FLIP' });
      const rank = rankOf(cur.pyramid[i]?.card as Card);
      const holders = cur.hands.filter((h) => h.some((c) => rankOf(c) === rank)).length;
      expect(drinks(out.effects)).toHaveLength(holders);
      cur = out.state;
      const view = rtb.project(cur, 'table') as View;
      expect(view.pyramid.map((p) => p.card !== null)).toEqual(cur.pyramid.map((_, j) => j <= i));
    }
    expect(cur.phase).toBe('pyramid');
    expect(act(cur, { type: 'FLIP' }).state.phase).toBe('board');
  });

  it('without the pyramid the rider is picked right after the deal (all tied → RNG)', () => {
    const r = rules({ pyramid: false });
    const riders = new Set<PlayerId>();
    for (let seed = 0; seed < 30; seed++) {
      const { state, effects } = playDeal(rtb.setup(r, ctx(seed), {}), r, seed);
      expect(state.phase).toBe('board');
      expect(state.pyramid).toEqual([]);
      expect(state.leftover).toEqual([4, 4, 4]);
      riders.add(state.bus?.rider as PlayerId);
      expect(effects).toContainEqual({ type: 'passTo', player: state.bus?.rider, private: false });
    }
    expect(riders).toEqual(new Set(['p1', 'p2', 'p3']));
  });
});

describe('the bus', () => {
  const boarded = (r: Rules = rules({ pyramid: false }), seed = 1) => {
    const b = playDeal(rtb.setup(r, ctx(seed), {}), r).state;
    expect(rtb.validate(b, { type: 'BOARD' }, 'stranger', r)).toBe('error.notYourTurn');
    return act(b, { type: 'BOARD' }, r, b.bus?.rider);
  };

  it('BOARD starts the rider on a fresh shuffled 52-card deck', () => {
    const { state, effects } = boarded();
    expect(effects).toEqual([]);
    expect(state.phase).toBe('bus');
    expect(state.deck).toHaveLength(52);
    expect(state.hands).toEqual([[], [], []]);
    expect(state.discard).toEqual([]);
    expect(rtb.activeActor(state)).toBe(state.bus?.rider);
    expect((rtb.project(state, 'table') as View).question).toBe('RED_BLACK');
    const other = state.order.find((p) => p !== state.bus?.rider) as PlayerId;
    expect(rtb.validate(state, rb('red'), other, rules())).toBe('error.notYourTurn');
    expect(rtb.validate(state, rb('red'), state.bus?.rider as PlayerId, rules())).toBeNull();
  });

  // Red 9, a lower 5, a 7 inside 5..9, then a club.
  const RUN = [card(9, 'H'), card(5, 'S'), card(7, 'D'), card(2, 'C')];
  const RIGHT = [rb('red'), hl('lower'), io('inside'), suit('C')];

  it('four right in a row gets the rider off the bus and ends the game', () => {
    const r = rules({ pyramid: false });
    let step: Step = { state: stack(boarded(r).state, RUN), effects: [] };
    const rider = step.state.bus?.rider as PlayerId;
    for (const a of RIGHT) step = act(step.state, a, r);
    expect(step.state.phase).toBe('over');
    expect(step.state.bus).toMatchObject({ attempt: 1, outcome: 'offBus' });
    expect(step.state.bus?.cards).toHaveLength(4);
    expect(step.effects).toEqual([
      {
        type: 'notice',
        msg: {
          key: 'rtb.notice.offBus',
          params: { name: PLAYERS.find((p) => p.id === rider)?.name },
        },
      },
    ]);
    expect(rtb.isOver(step.state)).toBe(true);
    expect(rtb.activeActor(step.state)).toBeNull();
  });

  it('a wrong answer drinks and restarts from Q1', () => {
    const r = rules({ pyramid: false });
    let step: Step = { state: stack(boarded(r).state, RUN), effects: [] };
    const rider = step.state.bus?.rider as PlayerId;
    step = act(step.state, rb('red'), r);
    step = act(step.state, hl('lower'), r);
    step = act(step.state, io('outside'), r);
    expect(drinks(step.effects)).toEqual([
      {
        type: 'drink',
        to: [rider],
        amount: 3,
        kind: 'drink',
        reason: { key: 'rtb.reason.busWrong', params: { q: 3 } },
      },
    ]);
    expect(step.effects).toContainEqual({
      type: 'notice',
      msg: { key: 'rtb.notice.restart', params: { name: expect.any(String), attempt: 2, max: 5 } },
    });
    expect(step.state.bus).toMatchObject({ attempt: 2, cards: [], outcome: null });
    expect(step.state.discard).toHaveLength(3);
    expect((rtb.project(step.state, 'table') as View).question).toBe('RED_BLACK');
  });

  it('the rider is let off after busMaxAttempts failed runs', () => {
    const r = rules({ pyramid: false, busMaxAttempts: 2, wrongSips: 'fixed' });
    let step: Step = { state: stack(boarded(r).state, RUN), effects: [] };
    step = act(step.state, rb('black'), r);
    expect(step.state.phase).toBe('bus');
    step = { ...step, state: stack(step.state, [card(10, 'S'), card(10, 'H')]) };
    step = act(step.state, rb('black'), r);
    step = act(step.state, hl('higher'), r); // equal: wrong
    expect(step.state.phase).toBe('over');
    expect(step.state.bus).toMatchObject({ attempt: 2, outcome: 'released', cards: [] });
    expect(drinks(step.effects)).toMatchObject([{ amount: 1 }]);
    expect(step.effects).toContainEqual({
      type: 'notice',
      msg: { key: 'rtb.notice.released', params: { name: expect.any(String) } },
    });
    expect(rtb.validate(step.state, rb('red'), 'host', r)).toBe('error.gameOver');
  });
});

describe('ride the bus properties', () => {
  /** A legal action: answers are right with probability ~ (choice % 3 > 0). */
  function pick(s: State, r: Rules, choice: number): Action {
    if (s.phase === 'pyramid') return { type: 'FLIP' };
    if (s.phase === 'board') return { type: 'BOARD' };
    const q = QUESTIONS[questionIndex(s)];
    switch (q) {
      case 'RED_BLACK':
        return rb(choice % 2 ? 'red' : 'black');
      case 'HIGHER_LOWER':
        return hl(choice % 2 ? 'higher' : 'lower');
      case 'INSIDE_OUTSIDE':
        return io(choice % 2 ? 'inside' : 'outside');
      default:
        return choice % 5 === 0 ? answerFor(s, true, r) : suit(SUITS[choice % 4] as 'S');
    }
  }

  const arbGame = fc.record({
    seed: fc.integer(),
    n: fc.integer({ min: 2, max: 10 }),
    pyramid: fc.boolean(),
    busMaxAttempts: fc.integer({ min: 1, max: 10 }),
    aceHigh: fc.boolean(),
    escalating: fc.boolean(),
    choices: fc.array(fc.nat(1000), { minLength: 1, maxLength: 60 }),
  });

  type Game = typeof arbGame extends fc.Arbitrary<infer T> ? T : never;

  const run = (g: Game) => {
    const r = rules({
      pyramid: g.pyramid,
      busMaxAttempts: g.busMaxAttempts,
      aceHigh: g.aceHigh,
      wrongSips: g.escalating ? 'escalating' : 'fixed',
    });
    const c = {
      players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
      rng: createRng(g.seed),
    };
    return { r, c, s: rtb.setup(r, c, {}) };
  };

  it('never duplicates or loses a card', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const { r, c, s: s0 } = run(g);
        let s = s0;
        const full = Array.from({ length: 52 }, (_, i) => i);
        for (let step = 0; step < 400 && !rtb.isOver(s); step++) {
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          expect(rtb.validate(s, a, 'host', r)).toBeNull();
          s = rtb.reduce(s, a, c, r).state;
          expect(allCards(s).sort((x, y) => x - y)).toEqual(full);
        }
        expect(rtb.isOver(s)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('the bus always ends within the cap, and only wrong answers drink', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const { r, c, s: s0 } = run(g);
        let s = s0;
        let busWrong = 0;
        for (let step = 0; step < 400 && !rtb.isOver(s); step++) {
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          const q = s.phase === 'deal' || s.phase === 'bus' ? questionIndex(s) : -1;
          const out = rtb.reduce(s, a, c, r);
          for (const d of drinks(out.effects)) {
            if (d.kind === 'give') {
              expect(a.type).toBe('FLIP');
              continue;
            }
            expect(out.state.last?.correct).toBe(false);
            expect(d.amount).toBe(g.escalating ? q + 1 : 1);
            expect(d.to).toEqual([out.state.last?.player]);
          }
          if (s.phase === 'bus' && out.state.last?.correct === false) busWrong += 1;
          s = out.state;
          if (s.bus) expect(s.bus.attempt).toBeLessThanOrEqual(g.busMaxAttempts);
        }
        expect(rtb.isOver(s)).toBe(true);
        expect(busWrong).toBeLessThanOrEqual(g.busMaxAttempts);
        const outcome = s.bus?.outcome;
        expect(outcome === 'offBus' || outcome === 'released').toBe(true);
        if (outcome === 'released') expect(busWrong).toBe(g.busMaxAttempts);
        if (outcome === 'offBus') expect(s.bus?.cards).toHaveLength(4);
      }),
      { numRuns: 150 },
    );
  });

  it('the rider always had the most cards left', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const { r, c, s: s0 } = run(g);
        let s = s0;
        for (let step = 0; step < 200 && s.phase !== 'board'; step++) {
          s = rtb.reduce(s, pick(s, r, g.choices[step % g.choices.length] as number), c, r).state;
        }
        expect(s.phase).toBe('board');
        const left = s.leftover as number[];
        const seat = s.order.indexOf(s.bus?.rider as PlayerId);
        expect(left[seat]).toBe(Math.max(...left));
        if (!g.pyramid) expect(left.every((k) => k === 4)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('views hide the deck order and face-down pyramid cards', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const { r, c, s: s0 } = run(g);
        let s = s0;
        for (let step = 0; step < 200 && !rtb.isOver(s); step++) {
          const view = rtb.project(s, 'table') as View & Record<string, unknown>;
          expect(view.deck).toBeUndefined();
          expect(view.discard).toBeUndefined();
          // Swapping hidden cards around must not change the view.
          const hidden = [...s.deck, ...s.pyramid.filter((p) => !p.faceUp).map((p) => p.card)];
          const swapped = hidden.slice().reverse();
          let k = 0;
          const shuffled: State = {
            ...s,
            deck: swapped.slice(0, s.deck.length),
            pyramid: s.pyramid.map((p) =>
              p.faceUp ? p : { ...p, card: swapped[s.deck.length + k++] as Card },
            ),
          };
          expect(rtb.project(shuffled, 'table')).toEqual(view);
          s = rtb.reduce(s, pick(s, r, g.choices[step % g.choices.length] as number), c, r).state;
        }
      }),
      { numRuns: 80 },
    );
  });

  it('runs through the session reducer to the end', () => {
    let session = startSession(rtb, {
      rules: {},
      players: players('Ana', 'Ben', 'Cy', 'Dee'),
      intensity: intensity(),
      seed: 8,
    });
    for (let i = 0; i < 300 && !session.over; i++) {
      const action = pick(session.game as State, session.rules as Rules, i * 7);
      const step = sessionReducer(rtb, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect(session.drinks.length).toBeGreaterThan(0);
  });
});
