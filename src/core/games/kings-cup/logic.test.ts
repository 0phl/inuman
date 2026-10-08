import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Effect } from '../../engine/types';
import { RANK_KEYS } from '../../primitives/deck';
import { intensity, players } from '../../test/fixtures';
import { kingsCup, rulesSchema, withMates, type Action, type Rules, type State } from './logic';

const rules = (patch: unknown = {}): Rules => rulesSchema.parse(patch);
const ctx = (seed = 1) => ({ players: players('Ana', 'Ben', 'Cy'), rng: createRng(seed) });

/** Card index for a rank on spades: 0 = 2♠ … 8 = 10♠, 9 = J, 10 = Q, 11 = K, 12 = A. */
const C = {
  A: 12,
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  '10': 8,
  J: 9,
  Q: 10,
  K: 11,
} as const;
const KH = 24; // K♥
const KD = 37; // K♦

/** A state whose next card is fixed (the next card is the last element of the deck). */
const rigged = (next: number, patch: Partial<State> = {}): State => ({
  order: ['p1', 'p2', 'p3'],
  turn: 0,
  deck: [40, 41, next],
  drawn: [],
  kingsDrawn: 0,
  mates: [],
  roles: {},
  houseRules: [],
  pending: null,
  over: false,
  ...patch,
});

const DRAW: Action = { type: 'DRAW' };
const run = (s: State, a: Action, r = rules()) => kingsCup.reduce(s, a, ctx(), r);
const drinks = (effects: Effect[]) => effects.filter((e) => e.type === 'drink');

describe('kings cup rules', () => {
  it('parses defaults for all 13 ranks with i18n keys', () => {
    const r = rules();
    // JS enumerates integer-like keys first, so UIs must iterate RANK_KEYS, not Object.keys.
    expect(Object.keys(r.cards).sort()).toEqual([...RANK_KEYS].sort());
    expect(r.endOnFourthKing).toBe(true);
    expect(r.cards.A).toEqual({
      title: 'i18n:kc.card.A.title',
      text: 'i18n:kc.card.A.text',
      effect: 'everyone',
      sips: 1,
    });
    expect(r.cards['2']).toMatchObject({ effect: 'choose', sips: 2 });
    expect(r.cards['8']).toMatchObject({ effect: 'mate', sips: 0 });
    expect(r.cards.K).toMatchObject({ effect: 'kingsCup', sips: 1 });
  });

  it('fills partial card edits from the defaults', () => {
    const r = rules({ cards: { '3': { effect: 'left' } } });
    expect(r.cards['3']).toEqual({
      title: 'i18n:kc.card.3.title',
      text: 'i18n:kc.card.3.text',
      effect: 'left',
      sips: 2,
    });
    expect(r.cards.A.effect).toBe('everyone');
  });

  it('rejects bad card edits', () => {
    expect(rulesSchema.safeParse({ cards: { A: { sips: 9 } } }).success).toBe(false);
    expect(rulesSchema.safeParse({ cards: { A: { effect: 'nope' } } }).success).toBe(false);
    expect(rulesSchema.safeParse({ cards: { A: { title: 'x'.repeat(41) } } }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    type Node = { label?: string; properties?: Record<string, Node> };
    const unlabeled: string[] = [];
    const walk = (node: Node, path: string) => {
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (!child.label) unlabeled.push(`${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
    };
    walk(z.toJSONSchema(rulesSchema, { io: 'input' }) as Node, 'rules');
    expect(unlabeled).toEqual([]);
  });
});

describe('kings cup play', () => {
  it('deals a full shuffled deck and nothing face up', () => {
    const s = kingsCup.setup(rules(), ctx(), {});
    expect(s.deck).toHaveLength(52);
    expect(s.drawn).toEqual([]);
    expect(kingsCup.activeActor(s)).toBe('p1');
  });

  it('draws, applies the card and passes the turn', () => {
    const { state, effects } = run(rigged(C['3']), DRAW);
    expect(state.drawn).toEqual([C['3']]);
    expect(state.deck).toHaveLength(2);
    expect(state.turn).toBe(1);
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p1'],
        amount: 2,
        kind: 'drink',
        reason: { key: 'kc.reason.self', params: { card: '3' } },
      },
      { type: 'passTo', player: 'p2', private: false },
    ]);
  });

  it('ace is a waterfall for everyone, six is social', () => {
    expect(drinks(run(rigged(C.A), DRAW).effects)[0]).toMatchObject({
      to: ['p1', 'p2', 'p3'],
      kind: 'waterfall',
    });
    expect(drinks(run(rigged(C['6']), DRAW).effects)[0]).toMatchObject({
      to: ['p1', 'p2', 'p3'],
      kind: 'social',
    });
  });

  it('left is the next seat and right is the previous seat', () => {
    const r = rules({ cards: { '3': { effect: 'left' }, '4': { effect: 'right' } } });
    expect(drinks(run(rigged(C['3']), DRAW, r).effects)[0]?.to).toEqual(['p2']);
    expect(drinks(run(rigged(C['4']), DRAW, r).effects)[0]?.to).toEqual(['p3']);
  });

  it('assigns question and thumb masters to the drawer', () => {
    expect(run(rigged(C.Q, { turn: 1 }), DRAW).state.roles).toEqual({ questionMaster: 'p2' });
    expect(run(rigged(C['5'], { roles: { thumbMaster: 'p3' } }), DRAW).state.roles).toEqual({
      thumbMaster: 'p1',
    });
  });

  it('kings 1–3 are poured into the cup', () => {
    const { state, effects } = run(rigged(C.K, { kingsDrawn: 1 }), DRAW);
    expect(state.kingsDrawn).toBe(2);
    expect(state.over).toBe(false);
    expect(effects[0]).toEqual({
      type: 'notice',
      msg: { key: 'kc.notice.pour', params: { left: 2 } },
    });
    expect(drinks(effects)).toEqual([]);
  });

  it('the 4th king finishes the cup (with mates) and ends the game', () => {
    const s = rigged(KD, { kingsDrawn: 3, drawn: [C.K, KH, 50], mates: [['p2', 'p1']] });
    const { state, effects } = run(s, DRAW);
    expect(state.kingsDrawn).toBe(4);
    expect(state.over).toBe(true);
    expect(kingsCup.isOver(state)).toBe(true);
    expect(kingsCup.activeActor(state)).toBeNull();
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p1', 'p2'],
        amount: 1,
        finish: true,
        kind: 'drink',
        reason: { key: 'kc.reason.kingsCup', params: { card: 'K' } },
      },
    ]);
    expect(kingsCup.validate(state, DRAW, 'host', rules())).toBe('error.gameOver');
  });

  it('keeps going after the 4th king when the rule is off', () => {
    const { state, effects } = run(
      rigged(KD, { kingsDrawn: 3 }),
      DRAW,
      rules({ endOnFourthKing: false }),
    );
    expect(state.over).toBe(false);
    expect(effects.map((e) => e.type)).toEqual(['drink', 'passTo']);
  });

  it('ends when the deck runs out', () => {
    const { state, effects } = run(rigged(C['3'], { deck: [C['3']] }), DRAW);
    expect(state.over).toBe(true);
    expect(kingsCup.isOver(state)).toBe(true);
    expect(effects.some((e) => e.type === 'passTo')).toBe(false);
  });

  it('a pending card on the last draw is resolved before the game ends', () => {
    const { state } = run(rigged(C['4'], { deck: [C['4']] }), DRAW);
    expect(state.over).toBe(true);
    expect(kingsCup.isOver(state)).toBe(false);
    expect(kingsCup.validate(state, { type: 'RESOLVE', target: 'p2' }, 'host', rules())).toBeNull();
    const done = run(state, { type: 'RESOLVE', target: 'p2' });
    expect(drinks(done.effects)[0]).toMatchObject({ to: ['p2'] });
    expect(kingsCup.isOver(done.state)).toBe(true);
  });

  it('only the current seat may draw remotely; host always may', () => {
    const s = rigged(C['3']);
    expect(kingsCup.validate(s, DRAW, 'p2', rules())).toBe('error.notYourTurn');
    expect(kingsCup.validate(s, DRAW, 'p1', rules())).toBeNull();
    expect(kingsCup.validate(s, DRAW, 'host', rules())).toBeNull();
  });

  it('project hides the draw order', () => {
    const view = kingsCup.project(rigged(C['3']), 'table') as Record<string, unknown>;
    expect(view.deck).toBeUndefined();
    expect(view.deckCount).toBe(3);
  });
});

describe('kings cup mates', () => {
  it('adds mates (one level, deduped) to every drink', () => {
    const mates: State['mates'] = [
      ['p1', 'p2'],
      ['p2', 'p3'],
    ];
    expect(withMates(['p1'], mates)).toEqual(['p1', 'p2']);
    expect(withMates(['p2'], mates)).toEqual(['p2', 'p1', 'p3']);
    expect(withMates(['p1', 'p2'], mates)).toEqual(['p1', 'p2', 'p3']);
  });

  it('self drinks bring the mate along', () => {
    const { effects } = run(rigged(C['3'], { mates: [['p3', 'p1']] }), DRAW);
    expect(drinks(effects)[0]?.to).toEqual(['p1', 'p3']);
  });

  it('an 8 sets a pending mate pick that pairs drawer and target', () => {
    const drawn = run(rigged(C['8']), DRAW).state;
    expect(drawn.pending).toEqual({ kind: 'mate', by: 'p1', sips: 0, rank: '8' });
    const paired = run(drawn, { type: 'RESOLVE', target: 'p3' }).state;
    expect(paired.mates).toEqual([['p1', 'p3']]);
    expect(paired.pending).toBeNull();
    // Re-pairing the same two players doesn't duplicate the pair.
    const again = run(
      { ...paired, pending: { kind: 'mate', by: 'p3', sips: 0, rank: '8' } },
      { type: 'RESOLVE', target: 'p1' },
    );
    expect(again.state.mates).toEqual([['p1', 'p3']]);
  });

  it('a loser drink includes the loser’s mates', () => {
    const s = rigged(C['4'], { mates: [['p2', 'p3']] });
    const pending = run(s, DRAW).state;
    const { effects } = run(pending, { type: 'RESOLVE', target: 'p2' });
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p2', 'p3'],
        amount: 1,
        kind: 'drink',
        reason: { key: 'kc.reason.loser', params: { card: '4' } },
      },
    ]);
  });
});

describe('kings cup pending', () => {
  it('choose/loser/mate/rule cards wait for the group; DRAW is blocked', () => {
    for (const [rank, kind] of [
      ['2', 'choose'],
      ['4', 'loser'],
      ['8', 'mate'],
      ['J', 'rule'],
    ] as const) {
      const { state, effects } = run(rigged(C[rank]), DRAW);
      expect(state.pending?.kind).toBe(kind);
      expect(state.turn).toBe(1);
      expect(drinks(effects)).toEqual([]);
      expect(kingsCup.activeActor(state)).toBe('any');
      expect(kingsCup.validate(state, DRAW, 'host', rules())).toBe('kc.error.pending');
    }
  });

  it('choose gives the drink to the picked player', () => {
    const pending = run(rigged(C['2']), DRAW).state;
    const { state, effects } = run(pending, { type: 'RESOLVE', target: 'p3' });
    expect(state.pending).toBeNull();
    expect(effects[0]).toMatchObject({
      type: 'drink',
      to: ['p3'],
      amount: 2,
      kind: 'give',
      reason: { key: 'kc.reason.choose' },
    });
  });

  it('SKIP clears the pending card without drinks', () => {
    const pending = run(rigged(C['4']), DRAW).state;
    expect(kingsCup.validate(pending, { type: 'SKIP' }, 'host', rules())).toBeNull();
    const { state, effects } = run(pending, { type: 'SKIP' });
    expect(state.pending).toBeNull();
    expect(effects).toEqual([]);
    expect(kingsCup.validate(state, DRAW, 'host', rules())).toBeNull();
  });

  it('validates RESOLVE', () => {
    const v = (s: State, a: Action, actor = 'host') => kingsCup.validate(s, a, actor, rules());
    const idle = rigged(C['3']);
    expect(v(idle, { type: 'RESOLVE', target: 'p2' })).toBe('kc.error.noPending');
    expect(v(idle, { type: 'SKIP' })).toBe('kc.error.noPending');

    const loser = run(rigged(C['4']), DRAW).state;
    expect(v(loser, { type: 'RESOLVE' })).toBe('kc.error.badTarget');
    expect(v(loser, { type: 'RESOLVE', target: 'zz' })).toBe('kc.error.badTarget');
    expect(v(loser, { type: 'RESOLVE', target: 'p1' })).toBeNull();
    expect(v(loser, { type: 'RESOLVE', target: 'p2' }, 'p3')).toBeNull();
    expect(v(loser, { type: 'RESOLVE', target: 'p2' }, 'stranger')).toBe('error.notYourTurn');

    const mate = run(rigged(C['8']), DRAW).state;
    expect(v(mate, { type: 'RESOLVE', target: 'p1' })).toBe('kc.error.selfMate');
    expect(v(mate, { type: 'RESOLVE', target: 'nobody' })).toBe('kc.error.badTarget');
    expect(v(mate, { type: 'RESOLVE', target: 'p2' })).toBeNull();

    const rule = run(rigged(C.J), DRAW).state;
    expect(v(rule, { type: 'RESOLVE' })).toBe('kc.error.ruleText');
    expect(v(rule, { type: 'RESOLVE', text: '   ' })).toBe('kc.error.ruleText');
    expect(v(rule, { type: 'RESOLVE', text: 'x'.repeat(141) })).toBe('kc.error.ruleText');
    expect(v(rule, { type: 'RESOLVE', text: '  Bawal mag-English  ' })).toBeNull();
  });

  it('a rule card adds a trimmed house rule, keeping the latest 10', () => {
    const pending = run(rigged(C.J), DRAW).state;
    expect(
      run(pending, { type: 'RESOLVE', text: '  Bawal mag-English  ' }).state.houseRules,
    ).toEqual(['Bawal mag-English']);
    const full = { ...pending, houseRules: Array.from({ length: 10 }, (_, i) => `r${i}`) };
    const next = run(full, { type: 'RESOLVE', text: 'new' }).state.houseRules;
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('r1');
    expect(next[9]).toBe('new');
  });
});

describe('kings cup custom rules', () => {
  it('a card edited with literal text and a new effect takes effect', () => {
    const r = rules({
      cards: {
        '3': {
          title: 'Shot ng Barkada',
          text: 'Lahat, tatlong lagok!',
          effect: 'everyone',
          sips: 3,
        },
      },
    });
    expect(r.cards['3'].title).toBe('Shot ng Barkada');
    const { state, effects } = run(rigged(C['3']), DRAW, r);
    expect(drinks(effects)[0]).toMatchObject({
      to: ['p1', 'p2', 'p3'],
      amount: 3,
      kind: 'social',
      reason: { key: 'kc.reason.everyone' },
    });
    expect(state.pending).toBeNull();
  });

  it('a card switched to a pending effect waits for the group', () => {
    const r = rules({ cards: { A: { effect: 'choose', sips: 4 } } });
    const { state } = run(rigged(C.A), DRAW, r);
    expect(state.pending).toEqual({ kind: 'choose', by: 'p1', sips: 4, rank: 'A' });
  });

  it('a zero-sip card emits no drink', () => {
    const r = rules({ cards: { '3': { sips: 0 } } });
    expect(drinks(run(rigged(C['3']), DRAW, r).effects)).toEqual([]);
  });
});

describe('kings cup invariants', () => {
  const playOut = (seed: number, r: Rules) => {
    const c = ctx(seed);
    let s = kingsCup.setup(r, c, {});
    let draws = 0;
    let steps = 0;
    while (!kingsCup.isOver(s) && steps < 200) {
      const action: Action = s.pending ? { type: 'SKIP' } : DRAW;
      expect(kingsCup.validate(s, action, 'host', r)).toBeNull();
      if (action.type === 'DRAW') draws += 1;
      s = kingsCup.reduce(s, action, c, r).state;
      steps += 1;
    }
    return { s, draws };
  };

  it('never loses or duplicates a card and always ends within 52 draws', () => {
    fc.assert(
      fc.property(fc.integer(), fc.boolean(), (seed, endOnFourthKing) => {
        const r = rules({ endOnFourthKing });
        const { s, draws } = playOut(seed, r);
        expect(kingsCup.isOver(s)).toBe(true);
        expect(draws).toBeLessThanOrEqual(52);
        expect(s.drawn).toHaveLength(draws);
        expect([...s.deck, ...s.drawn].sort((a, b) => a - b)).toEqual(
          Array.from({ length: 52 }, (_, i) => i),
        );
        if (endOnFourthKing) expect(s.kingsDrawn).toBe(4);
        else expect(s.deck).toEqual([]);
      }),
    );
  });

  it('runs through the session reducer', () => {
    let session = startSession(kingsCup, {
      rules: {},
      players: players('Ana', 'Ben'),
      intensity: intensity(),
      seed: 7,
    });
    expect(session.over).toBe(false);
    for (let i = 0; i < 200 && !session.over; i++) {
      const game = session.game as State;
      const action: Action = game.pending ? { type: 'SKIP' } : DRAW;
      const step = sessionReducer(kingsCup, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect(sessionReducer(kingsCup, session, { type: 'GAME', action: DRAW }).error).toBe(
      'error.gameOver',
    );
  });
});
