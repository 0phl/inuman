import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect, PlayerId } from '../../engine/types';
import { FACES, type Face } from '../../primitives/dice';
import { intensity, players } from '../../test/fixtures';
import {
  beats,
  countFace,
  liarsDice as ld,
  rulesSchema,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: unknown = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy');
const ctx = (seed = 1) => ({ players: PLAYERS, rng: createRng(seed) });
type Step = { state: State; effects: Effect[] };

const act = (s: State, a: Action, r: Rules = rules(), actor: Actor = 'host'): Step => {
  expect(ld.validate(s, a, actor, r)).toBeNull();
  return ld.reduce(s, a, ctx(), r);
};

/** A bidding state with fixed hands (p1, p2, p3 …), p1 to act. */
const rigged = (hands: Face[][], patch: Partial<State> = {}): State => ({
  order: hands.map((_, i) => `p${i + 1}`),
  hands,
  turn: 0,
  round: 1,
  phase: 'bidding',
  bids: [],
  roll: { id: 1 },
  reveal: null,
  winner: null,
  ...patch,
});

const bid = (quantity: number, face: Face): Action => ({ type: 'BID', quantity, face });
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');

// 15 dice. Fives: 2 (+3 ones when wild = 5). Ones: 3.
const HANDS: Face[][] = [
  [5, 1, 2, 3, 4],
  [5, 1, 6, 6, 2],
  [1, 3, 3, 4, 2],
];

describe('liars dice rules', () => {
  it('parses defaults', () => {
    expect(rules()).toEqual({
      dicePerPlayer: 5,
      onesWild: true,
      spotOn: false,
      loserSips: 1,
      loseDie: false,
    });
    expect(rulesSchema.safeParse({ dicePerPlayer: 7 }).success).toBe(false);
    expect(rulesSchema.safeParse({ dicePerPlayer: 0 }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.ld.${key}`);
      expect(field.default).toBeDefined();
    }
  });

  it('rejects malformed bids at the schema', () => {
    expect(ld.actionSchema.safeParse({ type: 'BID', quantity: 2, face: 7 }).success).toBe(false);
    expect(ld.actionSchema.safeParse({ type: 'BID', quantity: 0, face: 3 }).success).toBe(false);
    expect(ld.actionSchema.safeParse({ type: 'BID', quantity: 1.5, face: 3 }).success).toBe(false);
  });
});

describe('counting and bid order', () => {
  it('ones are wild, except when the bid is on ones', () => {
    expect(countFace(HANDS, 5, true)).toBe(5);
    expect(countFace(HANDS, 5, false)).toBe(2);
    expect(countFace(HANDS, 1, true)).toBe(3);
    expect(countFace(HANDS, 6, true)).toBe(5);
  });

  it('a bid must raise the quantity, or keep it with a higher face', () => {
    expect(beats({ quantity: 4, face: 2 }, { quantity: 3, face: 6 })).toBe(true);
    expect(beats({ quantity: 3, face: 5 }, { quantity: 3, face: 4 })).toBe(true);
    expect(beats({ quantity: 3, face: 4 }, { quantity: 3, face: 4 })).toBe(false);
    expect(beats({ quantity: 3, face: 3 }, { quantity: 3, face: 4 })).toBe(false);
    expect(beats({ quantity: 2, face: 6 }, { quantity: 3, face: 1 })).toBe(false);
  });
});

describe('liars dice bidding', () => {
  it('deals everyone dicePerPlayer hidden dice and starts with the first seat', () => {
    const s = ld.setup(rules({ dicePerPlayer: 3 }), ctx(), {});
    expect(s.hands).toHaveLength(3);
    for (const h of s.hands) {
      expect(h).toHaveLength(3);
      for (const f of h) expect(FACES).toContain(f);
    }
    expect(s).toMatchObject({
      phase: 'bidding',
      round: 1,
      roll: { id: 1 },
      bids: [],
      reveal: null,
      winner: null,
    });
    expect(ld.activeActor(s)).toBe('p1');
  });

  it('a bid is recorded and passes the turn privately', () => {
    const { state, effects } = act(rigged(HANDS), bid(3, 5));
    expect(state.bids).toEqual([{ player: 'p1', quantity: 3, face: 5 }]);
    expect(state.turn).toBe(1);
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: true }]);
    const next = act(state, bid(3, 6)).state;
    expect(next.turn).toBe(2);
    expect(act(next, bid(4, 1)).state.turn).toBe(0);
  });

  it('validates bids', () => {
    const r = rules();
    const v = (s: State, a: Action) => ld.validate(s, a, 'host', r);
    const opened = act(rigged(HANDS), bid(3, 5)).state;
    expect(v(opened, bid(3, 5))).toBe('ld.error.lowBid');
    expect(v(opened, bid(3, 4))).toBe('ld.error.lowBid');
    expect(v(opened, bid(2, 6))).toBe('ld.error.lowBid');
    expect(v(opened, bid(3, 6))).toBeNull();
    expect(v(opened, bid(4, 1))).toBeNull();
    expect(v(opened, bid(15, 6))).toBeNull();
    expect(v(opened, bid(16, 6))).toBe('ld.error.tooMany');
  });

  it('calls need a bid; spot-on needs the rule', () => {
    const s = rigged(HANDS);
    expect(ld.validate(s, { type: 'CHALLENGE' }, 'host', rules())).toBe('ld.error.noBid');
    expect(ld.validate(s, { type: 'SPOT_ON' }, 'host', rules({ spotOn: true }))).toBe(
      'ld.error.noBid',
    );
    const opened = act(s, bid(2, 3)).state;
    expect(ld.validate(opened, { type: 'SPOT_ON' }, 'host', rules())).toBe('ld.error.spotOnOff');
    expect(ld.validate(opened, { type: 'SPOT_ON' }, 'host', rules({ spotOn: true }))).toBeNull();
    expect(ld.validate(opened, { type: 'NEXT_ROUND' }, 'host', rules())).toBe('ld.error.notReveal');
  });

  it('a remote seat may only act as the current bidder', () => {
    const r = rules();
    const s = rigged(HANDS);
    expect(ld.validate(s, bid(1, 2), 'p2', r)).toBe('error.notYourTurn');
    expect(ld.validate(s, bid(1, 2), 'p1', r)).toBeNull();
    expect(ld.validate(s, bid(1, 2), 'host', r)).toBeNull();
    const opened = act(s, bid(1, 2), r, 'p1').state;
    expect(ld.validate(opened, { type: 'CHALLENGE' }, 'p1', r)).toBe('error.notYourTurn');
    expect(ld.validate(opened, { type: 'CHALLENGE' }, 'p2', r)).toBeNull();
  });
});

describe('liars dice calls', () => {
  it('a challenge on a true bid: the challenger drinks', () => {
    // p1 bids five 5s (2 fives + 3 wild ones = 5), p2 calls liar.
    const opened = act(rigged(HANDS), bid(5, 5)).state;
    const { state, effects } = act(opened, { type: 'CHALLENGE' }, rules({ loserSips: 2 }));
    expect(state.phase).toBe('reveal');
    expect(state.reveal).toEqual({
      call: 'challenge',
      caller: 'p2',
      bid: { player: 'p1', quantity: 5, face: 5 },
      count: 5,
      correct: false,
      losers: ['p2'],
      hands: HANDS,
      out: [],
    });
    expect(effects).toEqual([
      {
        type: 'notice',
        msg: { key: 'ld.notice.count', params: { count: 5, face: 5, quantity: 5 } },
      },
      { type: 'drink', to: ['p2'], amount: 2, kind: 'drink', reason: { key: 'ld.reason.badCall' } },
    ]);
    expect(ld.activeActor(state)).toBe('any');
    expect(ld.validate(state, bid(6, 6), 'host', rules())).toBe('ld.error.notBidding');
  });

  it('a challenge on a bluff: the bidder drinks', () => {
    const opened = act(rigged(HANDS), bid(6, 5)).state;
    const { state, effects } = act(opened, { type: 'CHALLENGE' });
    expect(state.reveal).toMatchObject({ count: 5, correct: true, losers: ['p1'] });
    expect(drinks(effects)).toEqual([
      { type: 'drink', to: ['p1'], amount: 1, kind: 'drink', reason: { key: 'ld.reason.caught' } },
    ]);
  });

  it('without wild ones, only the bid face counts', () => {
    const r = rules({ onesWild: false });
    const opened = act(rigged(HANDS), bid(3, 5), r).state;
    expect(act(opened, { type: 'CHALLENGE' }, r).state.reveal).toMatchObject({
      count: 2,
      losers: ['p1'],
    });
  });

  it('spot on, right: everyone else drinks', () => {
    const r = rules({ spotOn: true });
    const opened = act(rigged(HANDS), bid(5, 5), r).state;
    const { state, effects } = act(opened, { type: 'SPOT_ON' }, r);
    expect(state.reveal).toMatchObject({
      call: 'spotOn',
      caller: 'p2',
      correct: true,
      losers: ['p1', 'p3'],
    });
    expect(drinks(effects)).toEqual([
      {
        type: 'drink',
        to: ['p1', 'p3'],
        amount: 1,
        kind: 'drink',
        reason: { key: 'ld.reason.spotOn' },
      },
    ]);
  });

  it('spot on, wrong: the caller drinks', () => {
    const r = rules({ spotOn: true });
    const opened = act(rigged(HANDS), bid(4, 5), r).state;
    const { state, effects } = act(opened, { type: 'SPOT_ON' }, r);
    expect(state.reveal).toMatchObject({ correct: false, losers: ['p2'] });
    expect(drinks(effects)[0]).toMatchObject({
      to: ['p2'],
      reason: { key: 'ld.reason.spotOnMiss' },
    });
  });

  it('NEXT_ROUND re-rolls every hand and the loser opens', () => {
    const opened = act(rigged(HANDS), bid(6, 5)).state;
    const revealed = act(opened, { type: 'CHALLENGE' }).state;
    expect(ld.validate(revealed, { type: 'NEXT_ROUND' }, 'p3', rules())).toBeNull();
    expect(ld.validate(revealed, { type: 'NEXT_ROUND' }, 'stranger', rules())).toBe(
      'error.notYourTurn',
    );
    const { state, effects } = act(revealed, { type: 'NEXT_ROUND' });
    expect(state).toMatchObject({
      phase: 'bidding',
      round: 2,
      turn: 0,
      bids: [],
      reveal: null,
      roll: { id: 2 },
    });
    expect(state.hands.map((h) => h.length)).toEqual([5, 5, 5]);
    expect(effects).toEqual([{ type: 'passTo', player: 'p1', private: true }]);
  });

  it('after a right spot-on, the seat after the caller opens', () => {
    const r = rules({ spotOn: true });
    const opened = act(rigged(HANDS, { turn: 1 }), bid(5, 5), r).state; // p2 bids, p3 calls
    const revealed = act(opened, { type: 'SPOT_ON' }, r).state;
    expect(revealed.reveal?.losers).toEqual(['p1', 'p2']);
    expect(act(revealed, { type: 'NEXT_ROUND' }, r).state.turn).toBe(0);
  });
});

describe('liars dice losing dice', () => {
  const r = rules({ loseDie: true });

  it('the loser loses a die; the reveal still shows the dice as called', () => {
    const opened = act(rigged(HANDS), bid(6, 5), r).state;
    const { state } = act(opened, { type: 'CHALLENGE' }, r);
    expect(state.hands.map((h) => h.length)).toEqual([4, 5, 5]);
    expect(state.reveal?.hands).toEqual(HANDS);
    const next = act(state, { type: 'NEXT_ROUND' }, r).state;
    expect(next.hands.map((h) => h.length)).toEqual([4, 5, 5]);
  });

  it('a player with no dice is out and skipped', () => {
    const hands: Face[][] = [[2], [3, 3], [4, 4]];
    const opened = act(rigged(hands), bid(2, 2), r).state; // only one 2 out there
    const { state, effects } = act(opened, { type: 'CHALLENGE' }, r);
    expect(state.reveal?.out).toEqual(['p1']);
    expect(state.hands.map((h) => h.length)).toEqual([0, 2, 2]);
    expect(effects).toContainEqual({
      type: 'notice',
      msg: { key: 'ld.notice.out', params: { name: 'Ana' } },
    });
    expect(ld.isOver(state)).toBe(false);

    // The loser is out, so the next seat with dice opens, and turns skip the empty seat.
    const next = act(state, { type: 'NEXT_ROUND' }, r);
    expect(next.state.turn).toBe(1);
    expect(next.effects).toEqual([{ type: 'passTo', player: 'p2', private: true }]);
    expect(next.state.hands[0]).toEqual([]);
    const afterP2 = act(next.state, bid(1, 3), r).state;
    expect(afterP2.turn).toBe(2);
    expect(act(afterP2, bid(1, 4), r).state.turn).toBe(1);
  });

  it('the last player with dice wins and the game ends', () => {
    const hands: Face[][] = [[2], [3]];
    const opened = act(rigged(hands), bid(1, 3), r).state;
    const { state, effects } = act(opened, { type: 'CHALLENGE' }, r); // p2 wrongly calls: p2 is out
    expect(state.winner).toBe('p1');
    expect(ld.isOver(state)).toBe(true);
    expect(ld.activeActor(state)).toBeNull();
    expect(effects).toContainEqual({
      type: 'notice',
      msg: { key: 'ld.notice.winner', params: { name: 'Ana' } },
    });
    expect(ld.validate(state, { type: 'NEXT_ROUND' }, 'host', r)).toBe('error.gameOver');
    expect((ld.project(state, 'table') as View).winner).toBe('p1');
  });

  it('a right spot-on takes a die from everyone else', () => {
    const rr = rules({ loseDie: true, spotOn: true });
    const opened = act(rigged(HANDS), bid(5, 5), rr).state;
    expect(act(opened, { type: 'SPOT_ON' }, rr).state.hands.map((h) => h.length)).toEqual([
      4, 5, 4,
    ]);
  });
});

describe('liars dice views', () => {
  it('the table sees counts and bids, never faces', () => {
    const s = act(rigged(HANDS), bid(3, 5)).state;
    const view = ld.project(s, 'table') as View;
    expect(view).toEqual({
      order: ['p1', 'p2', 'p3'],
      turn: 1,
      current: 'p2',
      round: 1,
      phase: 'bidding',
      counts: [5, 5, 5],
      totalDice: 15,
      bids: [{ player: 'p1', quantity: 3, face: 5 }],
      lastBid: { player: 'p1', quantity: 3, face: 5 },
      roll: { id: 1 },
      mine: null,
      reveal: null,
      winner: null,
    });
  });

  it('a player sees only their own dice', () => {
    const s = rigged(HANDS);
    expect((ld.project(s, 'p2') as View).mine).toEqual(HANDS[1]);
    expect((ld.project(s, 'nobody') as View).mine).toBeNull();
  });

  it('after a call everyone sees every hand and the count', () => {
    const s = act(act(rigged(HANDS), bid(6, 5)).state, { type: 'CHALLENGE' }).state;
    for (const viewer of ['table', 'p1', 'p3'] as const) {
      const view = ld.project(s, viewer) as View;
      expect(view.reveal?.hands).toEqual(HANDS);
      expect(view.reveal?.count).toBe(5);
      expect(view.current).toBeNull();
    }
  });
});

describe('liars dice invariants', () => {
  /** A legal action for the current state, steered by `choice`. */
  function pick(s: State, r: Rules, choice: number): Action {
    if (s.phase === 'reveal') return { type: 'NEXT_ROUND' };
    const total = s.hands.reduce((n, h) => n + h.length, 0);
    const prev = s.bids[s.bids.length - 1];
    const calls: Action[] = prev
      ? [{ type: 'CHALLENGE' }, ...(r.spotOn ? [{ type: 'SPOT_ON' } as const] : [])]
      : [];
    const raises: Action[] = [];
    const q0 = prev?.quantity ?? 1;
    for (let q = q0; q <= Math.min(total, q0 + 2); q++)
      for (const face of FACES)
        if (!prev || beats({ quantity: q, face }, prev)) raises.push(bid(q, face));
    if (calls.length > 0 && (raises.length === 0 || choice % 4 === 0))
      return calls[choice % calls.length] as Action;
    return raises[choice % raises.length] as Action;
  }

  /** Flip every face (f → f % 6 + 1) in every hand except `keep`'s, keeping hand sizes. */
  const scramble = (s: State, keep: number): State => ({
    ...s,
    hands: s.hands.map((h, i) => (i === keep ? h : h.map((f) => ((f % 6) + 1) as Face))),
  });

  const arbGame = fc.record({
    seed: fc.integer(),
    n: fc.integer({ min: 2, max: 6 }),
    dicePerPlayer: fc.integer({ min: 1, max: 6 }),
    onesWild: fc.boolean(),
    spotOn: fc.boolean(),
    choices: fc.array(fc.nat(1000), { minLength: 1, maxLength: 60 }),
  });

  it('views never expose other players’ faces while bidding', () => {
    fc.assert(
      fc.property(arbGame, fc.boolean(), (g, loseDie) => {
        const r = rules({
          dicePerPlayer: g.dicePerPlayer,
          onesWild: g.onesWild,
          spotOn: g.spotOn,
          loseDie,
        });
        const c = {
          players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
          rng: createRng(g.seed),
        };
        let s = ld.setup(r, c, {});
        for (let step = 0; step < 80 && !ld.isOver(s); step++) {
          if (s.phase === 'bidding') {
            const viewers: (PlayerId | 'table')[] = ['table', ...s.order];
            for (const viewer of viewers) {
              const seat = viewer === 'table' ? -1 : s.order.indexOf(viewer);
              const view = ld.project(s, viewer) as View;
              // Changing anyone else's faces must not change what this viewer sees.
              expect(ld.project(scramble(s, seat), viewer)).toEqual(view);
              expect(view.reveal).toBeNull();
              expect(Object.keys(view)).not.toContain('hands');
              expect(view.mine).toEqual(seat >= 0 ? s.hands[seat] : null);
            }
          }
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          expect(ld.validate(s, a, 'host', r)).toBeNull();
          s = ld.reduce(s, a, c, r).state;
        }
      }),
      { numRuns: 150 },
    );
  });

  it('without loseDie the total dice count is conserved and every call has losers', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const r = rules({
          dicePerPlayer: g.dicePerPlayer,
          onesWild: g.onesWild,
          spotOn: g.spotOn,
          loseDie: false,
        });
        const c = {
          players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
          rng: createRng(g.seed),
        };
        let s = ld.setup(r, c, {});
        const total = g.n * g.dicePerPlayer;
        for (let step = 0; step < 120; step++) {
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          expect(ld.validate(s, a, 'host', r)).toBeNull();
          const out = ld.reduce(s, a, c, r);
          s = out.state;
          expect(s.hands.reduce((n, h) => n + h.length, 0)).toBe(total);
          if (a.type === 'CHALLENGE' || a.type === 'SPOT_ON') {
            const d = drinks(out.effects);
            expect(d).toHaveLength(1);
            expect(d[0]?.to).toEqual(s.reveal?.losers);
            expect(s.reveal?.losers.length).toBeGreaterThan(0);
          }
          expect(ld.isOver(s)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('with loseDie every call costs each loser one die, and the game ends with one winner', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const r = rules({
          dicePerPlayer: g.dicePerPlayer,
          onesWild: g.onesWild,
          spotOn: g.spotOn,
          loseDie: true,
        });
        const c = {
          players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
          rng: createRng(g.seed),
        };
        let s = ld.setup(r, c, {});
        for (let step = 0; step < 5000 && !ld.isOver(s); step++) {
          const before = s.hands.reduce((n, h) => n + h.length, 0);
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          s = ld.reduce(s, a, c, r).state;
          const after = s.hands.reduce((n, h) => n + h.length, 0);
          const lost =
            a.type === 'CHALLENGE' || a.type === 'SPOT_ON' ? (s.reveal?.losers.length ?? 0) : 0;
          expect(after).toBe(before - lost);
        }
        expect(ld.isOver(s)).toBe(true);
        const left = s.order.filter((_, i) => (s.hands[i]?.length ?? 0) > 0);
        expect(left).toEqual([s.winner]);
      }),
      { numRuns: 100 },
    );
  });

  it('runs through the session reducer to a winner', () => {
    let session = startSession(ld, {
      rules: { loseDie: true, dicePerPlayer: 2 },
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 11,
    });
    for (let i = 0; i < 500 && !session.over; i++) {
      const action = pick(session.game as State, session.rules as Rules, i * 7);
      const step = sessionReducer(ld, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect((session.game as State).winner).not.toBeNull();
  });
});
