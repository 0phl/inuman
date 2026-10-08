import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng, type Rng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect } from '../../engine/types';
import { FACES, type Face } from '../../primitives/dice';
import { intensity, players } from '../../test/fixtures';
import {
  MEXICO_RANK,
  mexico,
  mexicoRank,
  rulesSchema,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: unknown = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy');

/** An RNG whose int() returns the scripted values in order. */
const scripted = (ints: number[]): Rng => {
  const queue = [...ints];
  return {
    random: () => 0,
    int(min, max) {
      const v = queue.shift();
      if (v === undefined || v < min || v > max) throw new Error(`bad script value ${v}`);
      return v;
    },
    pick: (items) => items[0] as never,
    shuffle: (items) => items.slice(),
    get state() {
      return 0;
    },
  };
};

const ctx = (rng: Rng = createRng(1)) => ({ players: PLAYERS, rng });

type Step = { state: State; effects: Effect[] };

/** Validate (as `actor`) and reduce, failing the test on a rejected action. */
const act = (
  s: State,
  a: Action,
  r: Rules,
  rng: Rng = createRng(1),
  actor: Actor = 'host',
): Step => {
  expect(mexico.validate(s, a, actor, r)).toBeNull();
  return mexico.reduce(s, a, ctx(rng), r);
};

/** ROLL with fixed faces, then SETTLED. Effects of both steps are concatenated. */
const roll = (s: State, faces: [Face, Face], r: Rules): Step => {
  const rolled = act(s, { type: 'ROLL' }, r, scripted(faces));
  const settled = act(rolled.state, { type: 'SETTLED', rollId: rolled.state.roll?.id ?? -1 }, r);
  return { state: settled.state, effects: [...rolled.effects, ...settled.effects] };
};

const keep = (s: State, r: Rules): Step => act(s, { type: 'KEEP' }, r);

/** Run a sequence of turns: each turn is a list of rolls, kept after the last one. */
const turns = (s: State, plan: [Face, Face][][], r: Rules): Step => {
  let state = s;
  const effects: Effect[] = [];
  for (const rolls of plan) {
    const before = state.turn + state.stage * 100 + state.round * 10000;
    for (const faces of rolls) {
      const step = roll(state, faces, r);
      state = step.state;
      effects.push(...step.effects);
    }
    // The turn may have ended by itself (Mexico or out of rolls).
    if (state.turn + state.stage * 100 + state.round * 10000 === before) {
      const step = keep(state, r);
      state = step.state;
      effects.push(...step.effects);
    }
  }
  return { state, effects };
};

const start = (r: Rules = rules()) => mexico.setup(r, ctx(), {});
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');
const notices = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'notice' ? [e.msg.key] : []));

describe('mexicoRank', () => {
  it('2-1 is Mexico, the best roll, in either order', () => {
    expect(mexicoRank([2, 1])).toBe(MEXICO_RANK);
    expect(mexicoRank([1, 2])).toBe(MEXICO_RANK);
    expect(mexicoRank([1, 2])).toBeGreaterThan(mexicoRank([6, 6]));
  });

  it('reads non-doubles high-first as a×10+b', () => {
    expect(mexicoRank([3, 1])).toBe(31);
    expect(mexicoRank([1, 3])).toBe(31);
    expect(mexicoRank([5, 6])).toBe(65);
    expect(mexicoRank([4, 2])).toBe(42);
  });

  it('doubles beat every non-double, and higher doubles beat lower ones', () => {
    expect(mexicoRank([1, 1])).toBeGreaterThan(mexicoRank([6, 5]));
    expect(mexicoRank([2, 2])).toBeGreaterThan(mexicoRank([1, 1]));
    expect(mexicoRank([6, 6])).toBeGreaterThan(mexicoRank([5, 5]));
  });

  it('orders all 21 distinct rolls as expected', () => {
    const all: [Face, Face][] = [];
    for (const a of FACES) for (const b of FACES) if (a >= b) all.push([a, b]);
    const ordered = [...all]
      .sort((x, y) => mexicoRank(x) - mexicoRank(y))
      .map(([a, b]) => `${a}${b}`);
    expect(ordered).toEqual([
      '31',
      '32',
      '41',
      '42',
      '43',
      '51',
      '52',
      '53',
      '54',
      '61',
      '62',
      '63',
      '64',
      '65',
      '11',
      '22',
      '33',
      '44',
      '55',
      '66',
      '21',
    ]);
  });

  it('is symmetric and never ties two different rolls', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FACES),
        fc.constantFrom(...FACES),
        fc.constantFrom(...FACES),
        fc.constantFrom(...FACES),
        (a, b, c, d) => {
          expect(mexicoRank([a, b])).toBe(mexicoRank([b, a]));
          const same = Math.max(a, b) === Math.max(c, d) && Math.min(a, b) === Math.min(c, d);
          expect(mexicoRank([a, b]) === mexicoRank([c, d])).toBe(same);
        },
      ),
    );
  });

  it('rejects anything but two dice', () => {
    expect(() => mexicoRank([1])).toThrow();
    expect(() => mexicoRank([1, 2, 3])).toThrow();
  });
});

describe('mexico rules', () => {
  it('parses defaults', () => {
    expect(rules()).toEqual({
      maxRolls: 3,
      leaderSetsRolls: true,
      loserSips: 1,
      mexicoDoubles: true,
      tie: 'all',
    });
    expect(rulesSchema.safeParse({ maxRolls: 4 }).success).toBe(false);
    expect(rulesSchema.safeParse({ loserSips: 0 }).success).toBe(false);
    expect(rulesSchema.safeParse({ tie: 'coin' }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.mx.${key}`);
      expect(field.default).toBeDefined();
    }
  });
});

describe('mexico turns', () => {
  it('sets up a round with the first seat rolling', () => {
    const s = start();
    expect(s).toMatchObject({
      round: 1,
      turnOrder: ['p1', 'p2', 'p3'],
      turn: 0,
      phase: 'rolling',
      roll: null,
    });
    expect(mexico.activeActor(s)).toBe('p1');
    expect(mexico.isOver(s)).toBe(false);
  });

  it('ROLL picks two faces up front; nothing is scored until SETTLED', () => {
    const r = rules();
    const { state, effects } = act(start(), { type: 'ROLL' }, r, createRng(42));
    expect(state.roll).toMatchObject({ id: 1, settled: false });
    expect(state.roll?.faces).toHaveLength(2);
    for (const f of state.roll?.faces ?? []) expect(FACES).toContain(f);
    expect(state.rollsUsed).toBe(1);
    expect(state.results).toEqual([]);
    expect(effects).toEqual([]);

    expect(mexico.validate(state, { type: 'KEEP' }, 'host', r)).toBe('mx.error.rolling');
    expect(mexico.validate(state, { type: 'ROLL' }, 'host', r)).toBe('mx.error.rolling');
    expect(mexico.validate(state, { type: 'SETTLED', rollId: 99 }, 'host', r)).toBe(
      'mx.error.staleRoll',
    );

    const settled = act(state, { type: 'SETTLED', rollId: 1 }, r).state;
    expect(settled.roll?.settled).toBe(true);
    expect(mexico.validate(settled, { type: 'SETTLED', rollId: 1 }, 'host', r)).toBe(
      'mx.error.staleRoll',
    );
  });

  it('roll ids keep increasing across turns and rounds', () => {
    const r = rules({ maxRolls: 1 });
    let s = start(r);
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = roll(s, [3, 4], r).state;
      ids.push(s.roll?.id ?? -1);
      if (s.phase === 'roundOver') s = act(s, { type: 'NEXT_ROUND' }, r).state;
    }
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it('KEEP ends the turn early and passes to the next player', () => {
    const r = rules({ leaderSetsRolls: false });
    const { state, effects } = turns(start(r), [[[6, 4]]], r);
    expect(state.results).toEqual([{ player: 'p1', faces: [6, 4], rank: 64, rolls: 1, stage: 0 }]);
    expect(state.turn).toBe(1);
    expect(state.rollsUsed).toBe(0);
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);
    // The kept dice stay on the table until the next roll.
    expect(state.roll).toMatchObject({ faces: [6, 4], settled: true });
  });

  it('a turn ends by itself after the last allowed roll', () => {
    const r = rules({ leaderSetsRolls: false });
    let s = start(r);
    s = roll(s, [3, 1], r).state;
    s = roll(s, [4, 1], r).state;
    expect(s.turn).toBe(0);
    const { state, effects } = roll(s, [5, 1], r);
    expect(state.turn).toBe(1);
    expect(state.results[0]).toMatchObject({ player: 'p1', faces: [5, 1], rolls: 3 });
    expect(effects).toContainEqual({ type: 'passTo', player: 'p2', private: false });
  });

  it('Mexico ends the turn at once and announces itself', () => {
    const r = rules();
    const { state, effects } = roll(start(r), [1, 2], r);
    expect(state.mexicos).toBe(1);
    expect(state.results[0]).toMatchObject({ player: 'p1', rank: MEXICO_RANK, rolls: 1 });
    expect(effects).toContainEqual({
      type: 'notice',
      msg: { key: 'mx.notice.mexico', params: { name: 'Ana' } },
    });
    expect(state.turn).toBe(1);
  });

  it('the first player’s roll count caps everyone else (leaderSetsRolls)', () => {
    const r = rules();
    const { state, effects } = turns(start(r), [[[6, 4]]], r);
    expect(state.cap).toBe(1);
    expect(effects[0]).toEqual({
      type: 'notice',
      msg: { key: 'mx.notice.cap', params: { name: 'Ana', rolls: 1 } },
    });
    // Ben gets one roll only: it settles and the turn is over.
    const ben = roll(state, [3, 1], r).state;
    expect(ben.turn).toBe(2);
    expect(ben.results[1]).toMatchObject({ player: 'p2', rolls: 1 });
  });

  it('with leaderSetsRolls off, everyone keeps maxRolls', () => {
    const r = rules({ leaderSetsRolls: false });
    const { state } = turns(start(r), [[[6, 4]]], r);
    expect(state.cap).toBe(3);
    const ben = roll(state, [3, 1], r).state;
    expect(ben.turn).toBe(1);
    expect(mexico.project(ben, 'table')).toMatchObject({ current: 'p2', rollsLeft: 2 });
  });

  it('rejects rolls past the cap', () => {
    const r = rules({ maxRolls: 2, leaderSetsRolls: false });
    let s = roll(start(r), [3, 1], r).state;
    s = { ...s, rollsUsed: 2 };
    expect(mexico.validate(s, { type: 'ROLL' }, 'host', r)).toBe('mx.error.noRollsLeft');
  });
});

describe('mexico rounds', () => {
  it('the lowest roll drinks loserSips and the round is over', () => {
    const r = rules({ loserSips: 2 });
    const { state, effects } = turns(start(r), [[[6, 4]], [[3, 1]], [[5, 5]]], r);
    expect(state.phase).toBe('roundOver');
    expect(state.losers).toEqual(['p2']);
    expect(state.stake).toBe(2);
    expect(drinks(effects)).toEqual([
      { type: 'drink', to: ['p2'], amount: 2, kind: 'drink', reason: { key: 'mx.reason.lowest' } },
    ]);
    expect(notices(effects)).toContain('mx.notice.lost');
    expect(mexico.activeActor(state)).toBe('any');
    expect(mexico.validate(state, { type: 'ROLL' }, 'host', r)).toBe('mx.error.roundOver');
    expect(mexico.validate(state, { type: 'KEEP' }, 'host', r)).toBe('mx.error.roundOver');
  });

  it('each Mexico doubles the loser’s sips', () => {
    const r = rules({ loserSips: 1 });
    const { state, effects } = turns(start(r), [[[2, 1]], [[1, 2]], [[4, 3]]], r);
    expect(state.mexicos).toBe(2);
    expect(state.losers).toEqual(['p3']);
    expect(drinks(effects)).toEqual([
      {
        type: 'drink',
        to: ['p3'],
        amount: 4,
        kind: 'drink',
        reason: { key: 'mx.reason.lowestDoubled', params: { count: 2 } },
      },
    ]);
  });

  it('mexicoDoubles off keeps the base sips', () => {
    const r = rules({ loserSips: 3, mexicoDoubles: false });
    const { effects } = turns(start(r), [[[2, 1]], [[6, 6]], [[4, 3]]], r);
    expect(drinks(effects)[0]).toMatchObject({
      to: ['p3'],
      amount: 3,
      reason: { key: 'mx.reason.lowest' },
    });
  });

  it("tie 'all': every lowest-tied player drinks", () => {
    const r = rules();
    const { state, effects } = turns(start(r), [[[3, 1]], [[6, 4]], [[1, 3]]], r);
    expect(state.losers).toEqual(['p1', 'p3']);
    expect(drinks(effects)).toHaveLength(1);
    expect(drinks(effects)[0]?.to).toEqual(['p1', 'p3']);
  });

  it("tie 'rolloff': only the tied players roll again, until one loses", () => {
    const r = rules({ tie: 'rolloff', leaderSetsRolls: false });
    const main = turns(start(r), [[[3, 1]], [[6, 4]], [[1, 3]]], r);
    expect(main.state.phase).toBe('rolling');
    expect(main.state.stage).toBe(1);
    expect(main.state.turnOrder).toEqual(['p1', 'p3']);
    expect(main.state.cap).toBe(3);
    expect(drinks(main.effects)).toEqual([]);
    expect(main.effects).toContainEqual({
      type: 'notice',
      msg: { key: 'mx.notice.rolloff', params: { names: 'Ana, Cy' } },
    });
    expect(main.effects).toContainEqual({ type: 'passTo', player: 'p1', private: false });
    expect(mexico.validate(main.state, { type: 'ROLL' }, 'p2', r)).toBe('error.notYourTurn');

    // Tie again: a second roll-off.
    const again = turns(main.state, [[[4, 2]], [[2, 4]]], r);
    expect(again.state.stage).toBe(2);
    expect(again.state.turnOrder).toEqual(['p1', 'p3']);

    const done = turns(again.state, [[[5, 5]], [[4, 1]]], r);
    expect(done.state.phase).toBe('roundOver');
    expect(done.state.losers).toEqual(['p3']);
    expect(drinks(done.effects)).toEqual([
      { type: 'drink', to: ['p3'], amount: 1, kind: 'drink', reason: { key: 'mx.reason.lowest' } },
    ]);
    // The leaderboard keeps every stage.
    expect(done.state.results.map((x) => [x.player, x.stage])).toEqual([
      ['p1', 0],
      ['p2', 0],
      ['p3', 0],
      ['p1', 1],
      ['p3', 1],
      ['p1', 2],
      ['p3', 2],
    ]);
  });

  it('Mexicos in a roll-off still double the stake', () => {
    const r = rules({ tie: 'rolloff' });
    const main = turns(start(r), [[[3, 1]], [[6, 4]], [[1, 3]]], r);
    const done = turns(main.state, [[[2, 1]], [[5, 4]]], r);
    expect(done.state.losers).toEqual(['p3']);
    expect(drinks(done.effects)[0]).toMatchObject({ amount: 2 });
  });

  it('NEXT_ROUND starts a fresh round with the loser rolling first', () => {
    const r = rules();
    const over = turns(start(r), [[[6, 4]], [[3, 1]], [[5, 5]]], r).state;
    expect(mexico.validate(over, { type: 'NEXT_ROUND' }, 'p3', r)).toBeNull();
    expect(mexico.validate(over, { type: 'NEXT_ROUND' }, 'stranger', r)).toBe('error.notYourTurn');
    const { state, effects } = act(over, { type: 'NEXT_ROUND' }, r);
    expect(state).toMatchObject({
      round: 2,
      turnOrder: ['p2', 'p3', 'p1'],
      turn: 0,
      stage: 0,
      rollsUsed: 0,
      cap: 3,
      results: [],
      mexicos: 0,
      phase: 'rolling',
      losers: [],
      stake: 0,
    });
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);
    expect(mexico.activeActor(state)).toBe('p2');
  });

  it('NEXT_ROUND is rejected mid-round', () => {
    expect(mexico.validate(start(), { type: 'NEXT_ROUND' }, 'host', rules())).toBe(
      'mx.error.roundNotOver',
    );
  });
});

describe('mexico validation', () => {
  it('only the current seat may act remotely; the host always may', () => {
    const r = rules();
    const s = start(r);
    expect(mexico.validate(s, { type: 'ROLL' }, 'p2', r)).toBe('error.notYourTurn');
    expect(mexico.validate(s, { type: 'ROLL' }, 'p1', r)).toBeNull();
    expect(mexico.validate(s, { type: 'ROLL' }, 'host', r)).toBeNull();
    const rolled = act(s, { type: 'ROLL' }, r, createRng(3), 'p1').state;
    expect(mexico.validate(rolled, { type: 'SETTLED', rollId: 1 }, 'p2', r)).toBe(
      'error.notYourTurn',
    );
    expect(mexico.validate(rolled, { type: 'SETTLED', rollId: 1 }, 'p1', r)).toBeNull();
  });

  it('KEEP needs a settled roll first', () => {
    expect(mexico.validate(start(), { type: 'KEEP' }, 'host', rules())).toBe('mx.error.noRoll');
  });

  it('no players means no game', () => {
    const s = mexico.setup(rules(), { players: [], rng: createRng(1) }, {});
    expect(mexico.isOver(s)).toBe(true);
    expect(mexico.activeActor(s)).toBeNull();
    expect(mexico.validate(s, { type: 'ROLL' }, 'host', rules())).toBe('error.noPlayers');
  });

  it('project shows the public roll plus who is up', () => {
    const r = rules();
    const rolled = act(start(r), { type: 'ROLL' }, r, scripted([5, 2])).state;
    const view = mexico.project(rolled, 'table') as View;
    expect(view.roll).toEqual({ id: 1, faces: [5, 2], settled: false });
    expect(view.current).toBe('p1');
    expect(view.rollsLeft).toBe(2);
  });
});

describe('mexico invariants', () => {
  type Choice = { keepAfter: number };
  const arbRules = fc.record({
    maxRolls: fc.integer({ min: 1, max: 3 }),
    leaderSetsRolls: fc.boolean(),
    loserSips: fc.integer({ min: 1, max: 5 }),
    mexicoDoubles: fc.boolean(),
    tie: fc.constantFrom('all' as const, 'rolloff' as const),
  });

  it('every round ends with exactly one set of losers: the lowest of the final stage', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        arbRules,
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.record({ keepAfter: fc.integer({ min: 1, max: 3 }) }), {
          minLength: 1,
          maxLength: 40,
        }),
        (seed, ruleInput, n, choices: Choice[]) => {
          const r = rules(ruleInput);
          const c = {
            players: players(...Array.from({ length: n }, (_, i) => `P${i}`)),
            rng: createRng(seed),
          };
          let s = mexico.setup(r, c, {});
          let ci = 0;
          for (let round = 0; round < 3; round++) {
            const roundDrinks: DrinkEffect[] = [];
            for (let guard = 0; s.phase === 'rolling'; guard++) {
              if (guard > 500) throw new Error('round never ended');
              const choice = choices[ci++ % choices.length] as Choice;
              const a: Action =
                s.roll && !s.roll.settled
                  ? { type: 'SETTLED', rollId: s.roll.id }
                  : s.rollsUsed >= choice.keepAfter
                    ? { type: 'KEEP' }
                    : { type: 'ROLL' };
              expect(mexico.validate(s, a, 'host', r)).toBeNull();
              const step = mexico.reduce(s, a, c, r);
              roundDrinks.push(...drinks(step.effects));
              s = step.state;
            }

            const finalStage = s.results.filter((x) => x.stage === s.stage);
            const low = Math.min(...finalStage.map((x) => x.rank));
            expect(s.losers).toEqual(finalStage.filter((x) => x.rank === low).map((x) => x.player));
            expect(s.losers.length).toBeGreaterThan(0);
            if (r.tie === 'rolloff') expect(s.losers).toHaveLength(1);
            expect(roundDrinks).toHaveLength(1);
            expect(roundDrinks[0]?.to).toEqual(s.losers);
            const mexicos = s.results.filter((x) => x.rank === MEXICO_RANK).length;
            expect(s.mexicos).toBe(mexicos);
            expect(roundDrinks[0]?.amount).toBe(r.loserSips * (r.mexicoDoubles ? 2 ** mexicos : 1));

            // Every player rolled exactly once in the main round; nobody exceeded the cap.
            expect(
              s.results
                .filter((x) => x.stage === 0)
                .map((x) => x.player)
                .sort(),
            ).toEqual([...s.order].sort());
            for (let stage = 0; stage <= s.stage; stage++) {
              const rs = s.results.filter((x) => x.stage === stage);
              const leader = rs[0]?.rolls ?? 0;
              for (const x of rs) {
                expect(x.rolls).toBeGreaterThanOrEqual(1);
                expect(x.rolls).toBeLessThanOrEqual(r.maxRolls);
                if (r.leaderSetsRolls) expect(x.rolls).toBeLessThanOrEqual(leader);
              }
            }

            const loser = s.losers[0];
            s = mexico.reduce(s, { type: 'NEXT_ROUND' }, c, r).state;
            expect(s.turnOrder[0]).toBe(loser);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('runs through the session reducer', () => {
    let session = startSession(mexico, {
      rules: {},
      players: players('Ana', 'Ben'),
      intensity: intensity(),
      seed: 9,
    });
    let rounds = 0;
    for (let i = 0; i < 200 && rounds < 3; i++) {
      const g = session.game as State;
      const action: Action =
        g.phase === 'roundOver'
          ? { type: 'NEXT_ROUND' }
          : g.roll && !g.roll.settled
            ? { type: 'SETTLED', rollId: g.roll.id }
            : g.rollsUsed > 0
              ? { type: 'KEEP' }
              : { type: 'ROLL' };
      if (action.type === 'NEXT_ROUND') rounds += 1;
      const step = sessionReducer(mexico, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(rounds).toBe(3);
    expect(session.drinks.length).toBeGreaterThanOrEqual(3);
    expect(session.over).toBe(false);
  });
});
