import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect } from '../../engine/types';
import { intensity, players } from '../../test/fixtures';
import {
  MAX_HOUSE_RULES,
  MAX_IMPULSE,
  MAX_RULE_LENGTH,
  quarters,
  rulesSchema,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: unknown = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy');
const ctx = () => ({ players: PLAYERS, rng: createRng(1) });
const start = (r: Rules = rules()) => quarters.setup(r, ctx(), {});

type Step = { state: State; effects: Effect[] };

const act = (s: State, a: Action, r: Rules, actor: Actor = 'host'): Step => {
  expect(quarters.validate(s, a, actor, r)).toBeNull();
  return quarters.reduce(s, a, ctx(), r);
};

const shot = (made: boolean, bounced = true): Action => ({
  type: 'THROW_RESOLVED',
  impulse: [0, -1.2, -0.8],
  origin: [0, 0.4, 0.9],
  made,
  bounced,
});
const MAKE = shot(true);
const MISS = shot(false);
const pick = (target: string): Action => ({ type: 'RESOLVE', target });
const SKIP: Action = { type: 'SKIP' };

const play = (s: State, actions: Action[], r: Rules): Step => {
  let state = s;
  const effects: Effect[] = [];
  for (const a of actions) {
    const step = act(state, a, r);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
};

const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');
const notices = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'notice' ? [e.msg.key] : []));

describe('quarters rules', () => {
  it('parses defaults', () => {
    expect(rules()).toEqual({
      mustBounce: true,
      aimAssist: 2,
      sips: 1,
      missesBeforePass: 1,
      streakRule: 'makeRule',
      streakLength: 3,
    });
    expect(rulesSchema.safeParse({ missesBeforePass: 4 }).success).toBe(false);
    expect(rulesSchema.safeParse({ streakLength: 1 }).success).toBe(false);
    expect(rulesSchema.safeParse({ sips: 6 }).success).toBe(false);
    expect(rulesSchema.safeParse({ streakRule: 'shots' }).success).toBe(false);
    expect(rulesSchema.safeParse({ aimAssist: 4 }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.qt.${key}`);
      expect(field.default).toBeDefined();
    }
  });
});

describe('quarters shooting', () => {
  it('starts with the first seat shooting', () => {
    const s = start();
    expect(s).toMatchObject({ shooter: 0, turnNo: 1, streak: 0, misses: 0, pending: null });
    expect(quarters.activeActor(s)).toBe('p1');
    expect(quarters.isOver(s)).toBe(false);
  });

  it('a make asks the shooter who drinks; the target drinks', () => {
    const r = rules({ sips: 2 });
    const made = act(start(r), MAKE, r);
    expect(made.state.pending).toEqual({ kind: 'pick', by: 'p1', sips: 2, thenRule: false });
    expect(made.state.lastShot).toMatchObject({ id: 1, shooter: 'p1', made: true, counted: true });
    expect(made.effects).toEqual([
      { type: 'notice', msg: { key: 'qt.notice.made', params: { name: 'Ana' } } },
    ]);
    expect(quarters.activeActor(made.state)).toBe('p1');
    expect(quarters.validate(made.state, MAKE, 'host', r)).toBe('qt.error.pending');

    const { state, effects } = act(made.state, pick('p3'), r, 'p1');
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p3'],
        amount: 2,
        kind: 'drink',
        reason: { key: 'qt.reason.picked', params: { name: 'Ana' } },
      },
    ]);
    // The make keeps the coin with the shooter.
    expect(state).toMatchObject({ shooter: 0, streak: 1, pending: null });
    expect(quarters.activeActor(state)).toBe('p1');
  });

  it('the pick must be someone else at the table, chosen by the shooter', () => {
    const r = rules();
    const made = act(start(r), MAKE, r).state;
    expect(quarters.validate(made, pick('p1'), 'host', r)).toBe('qt.error.badTarget');
    expect(quarters.validate(made, pick('stranger'), 'host', r)).toBe('qt.error.badTarget');
    expect(quarters.validate(made, { type: 'RESOLVE' }, 'host', r)).toBe('qt.error.badTarget');
    expect(quarters.validate(made, pick('p2'), 'p2', r)).toBe('error.notYourTurn');
    expect(quarters.validate(made, SKIP, 'p2', r)).toBe('error.notYourTurn');
    expect(quarters.validate(start(r), pick('p2'), 'host', r)).toBe('qt.error.noPending');
    expect(quarters.validate(start(r), SKIP, 'host', r)).toBe('qt.error.noPending');
  });

  it('SKIP settles a pick without a drink', () => {
    const r = rules();
    const { state, effects } = play(start(r), [MAKE, SKIP], r);
    expect(state.pending).toBeNull();
    expect(drinks(effects)).toEqual([]);
  });

  it('a miss passes the coin to the next seat', () => {
    const r = rules();
    const { state, effects } = act(start(r), MISS, r);
    expect(state).toMatchObject({ shooter: 1, turnNo: 2, misses: 0, streak: 0 });
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);
    expect(drinks(effects)).toEqual([]);
  });

  it('misses add up across makes until missesBeforePass', () => {
    const r = rules({ missesBeforePass: 2 });
    const first = act(start(r), MISS, r);
    expect(first.state).toMatchObject({ shooter: 0, misses: 1 });
    expect(first.effects).toEqual([]);
    const { state, effects } = play(first.state, [MAKE, SKIP, MISS], r);
    expect(state).toMatchObject({ shooter: 1, misses: 0 });
    expect(effects).toContainEqual({ type: 'passTo', player: 'p2', private: false });
  });

  it('mustBounce: a clean drop is a miss (with a notice); off, it counts', () => {
    const r = rules();
    const drop = shot(true, false);
    const { state, effects } = act(start(r), drop, r);
    expect(state.lastShot).toMatchObject({ made: true, bounced: false, counted: false });
    expect(state.pending).toBeNull();
    expect(state.shooter).toBe(1);
    expect(effects[0]).toEqual({
      type: 'notice',
      msg: { key: 'qt.notice.noBounce', params: { name: 'Ana' } },
    });

    const lax = rules({ mustBounce: false });
    const ok = act(start(lax), drop, lax).state;
    expect(ok.lastShot?.counted).toBe(true);
    expect(ok.pending?.kind).toBe('pick');
  });

  it('a bounce that misses the glass is still a miss', () => {
    const r = rules();
    const s = act(start(r), shot(false, true), r).state;
    expect(s.lastShot?.counted).toBe(false);
    expect(s.shooter).toBe(1);
  });

  it('only the shooter may shoot remotely, and the throw must be sane', () => {
    const r = rules();
    const s = start(r);
    expect(quarters.validate(s, MISS, 'p2', r)).toBe('error.notYourTurn');
    expect(quarters.validate(s, MISS, 'p1', r)).toBeNull();
    const huge: Action = { ...shot(true), impulse: [MAX_IMPULSE, MAX_IMPULSE, 0] } as Action;
    expect(quarters.validate(s, huge, 'host', r)).toBe('qt.error.badThrow');
    const nan = { ...shot(true), origin: [0, NaN, 0] } as Action;
    expect(quarters.validate(s, nan, 'host', r)).toBe('qt.error.badThrow');
  });

  it('keeps per-player stats and the best streak', () => {
    const r = rules({ streakRule: 'none' });
    const { state } = play(start(r), [MAKE, SKIP, MAKE, SKIP, MISS, MAKE, SKIP, MISS], r);
    expect(state.stats).toEqual({
      p1: { shots: 3, makes: 2, bestStreak: 2 },
      p2: { shots: 2, makes: 1, bestStreak: 1 },
      p3: { shots: 0, makes: 0, bestStreak: 0 },
    });
    expect(state.lastShot?.id).toBe(5);
  });
});

describe('quarters streak rules', () => {
  it('three makes in a row: pick who drinks, then make a house rule', () => {
    const r = rules();
    const two = play(start(r), [MAKE, SKIP, MAKE, pick('p2')], r).state;
    expect(two.streak).toBe(2);
    const third = act(two, MAKE, r);
    expect(third.state.pending).toEqual({ kind: 'pick', by: 'p1', sips: 1, thenRule: true });
    expect(third.effects).toContainEqual({
      type: 'notice',
      msg: { key: 'qt.notice.streak', params: { name: 'Ana', streak: 3 } },
    });

    const picked = act(third.state, pick('p3'), r);
    expect(drinks(picked.effects)).toHaveLength(1);
    expect(picked.state.pending).toEqual({ kind: 'rule', by: 'p1', sips: 0, thenRule: false });
    expect(quarters.activeActor(picked.state)).toBe('p1');
    expect(quarters.validate(picked.state, { type: 'RESOLVE', text: '   ' }, 'host', r)).toBe(
      'qt.error.ruleText',
    );
    expect(
      quarters.validate(
        picked.state,
        { type: 'RESOLVE', text: 'x'.repeat(MAX_RULE_LENGTH + 1) },
        'host',
        r,
      ),
    ).toBe('qt.error.ruleText');

    const ruled = act(picked.state, { type: 'RESOLVE', text: '  Bawal magmura  ' }, r, 'p1');
    expect(ruled.state.houseRules).toEqual(['Bawal magmura']);
    expect(ruled.state.pending).toBeNull();
    expect(ruled.effects).toEqual([]);
    expect(ruled.state.shooter).toBe(0);
  });

  it('skipping the pick still leaves the rule owed; the rule can be skipped too', () => {
    const r = rules({ streakLength: 2 });
    const owed = play(start(r), [MAKE, SKIP, MAKE, SKIP], r).state;
    expect(owed.pending?.kind).toBe('rule');
    const done = act(owed, SKIP, r).state;
    expect(done.pending).toBeNull();
    expect(done.houseRules).toEqual([]);
  });

  it('every streakLength makes in a row earns another rule', () => {
    const r = rules({ streakLength: 2 });
    let s = start(r);
    const earned: number[] = [];
    for (let i = 1; i <= 6; i++) {
      s = act(s, MAKE, r).state;
      if (s.pending?.thenRule) earned.push(i);
      s = play(s, s.pending?.thenRule ? [SKIP, SKIP] : [SKIP], r).state;
    }
    expect(earned).toEqual([2, 4, 6]);
  });

  it("streakRule 'none' never asks for a rule", () => {
    const r = rules({ streakRule: 'none' });
    const s = play(start(r), [MAKE, SKIP, MAKE, SKIP, MAKE], r).state;
    expect(s.pending).toEqual({ kind: 'pick', by: 'p1', sips: 1, thenRule: false });
  });

  it(`keeps at most ${MAX_HOUSE_RULES} house rules, dropping the oldest`, () => {
    const r = rules({ streakLength: 2 });
    let s = start(r);
    for (let i = 0; i < MAX_HOUSE_RULES + 2; i++) {
      s = play(s, [MAKE, SKIP, MAKE, SKIP, { type: 'RESOLVE', text: `rule ${i}` }], r).state;
    }
    expect(s.houseRules).toHaveLength(MAX_HOUSE_RULES);
    expect(s.houseRules[0]).toBe('rule 2');
  });

  it('a miss resets the streak', () => {
    const r = rules({ missesBeforePass: 3 });
    const s = play(start(r), [MAKE, SKIP, MAKE, SKIP, MISS, MAKE], r).state;
    expect(s.streak).toBe(1);
    expect(s.pending?.thenRule).toBe(false);
  });
});

describe('quarters views and session', () => {
  it('project shows who acts', () => {
    const r = rules();
    const made = act(act(start(r), MISS, r).state, MAKE, r).state;
    expect((quarters.project(made, 'table') as View).current).toBe('p2');
  });

  it('needs two players', () => {
    const s = quarters.setup(rules(), { players: players('Solo'), rng: createRng(1) }, {});
    expect(quarters.isOver(s)).toBe(true);
    expect(quarters.activeActor(s)).toBeNull();
    expect(quarters.validate(s, MISS, 'host', rules())).toBe('error.noPlayers');
    expect((quarters.project(s, 'table') as View).current).toBeNull();
  });

  it('runs through the session reducer and logs the drinks of picked players', () => {
    let session = startSession(quarters, {
      rules: {},
      players: PLAYERS,
      intensity: intensity(),
      seed: 2,
    });
    const script: Action[] = [
      MAKE,
      pick('p2'),
      MAKE,
      SKIP,
      MAKE,
      pick('p3'),
      { type: 'RESOLVE', text: 'Left hand only' },
      MISS,
    ];
    for (const action of script) {
      const step = sessionReducer(quarters, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    const g = session.game as State;
    expect(g.houseRules).toEqual(['Left hand only']);
    expect(g.shooter).toBe(1);
    expect(session.drinks.map((d) => d.playerId)).toEqual(['p2', 'p3']);
    expect(session.over).toBe(false);
  });
});

describe('quarters invariants', () => {
  const arbRules = fc.record({
    mustBounce: fc.boolean(),
    sips: fc.integer({ min: 1, max: 5 }),
    missesBeforePass: fc.integer({ min: 1, max: 3 }),
    streakRule: fc.constantFrom('makeRule' as const, 'none' as const),
    streakLength: fc.integer({ min: 2, max: 5 }),
  });
  const arbShot = fc.record({ made: fc.boolean(), bounced: fc.boolean(), skip: fc.boolean() });

  it('the coin always passes within missesBeforePass misses, and only on a miss', () => {
    fc.assert(
      fc.property(
        arbRules,
        fc.integer({ min: 2, max: 8 }),
        fc.array(arbShot, { minLength: 1, maxLength: 150 }),
        (ruleInput, n, shots) => {
          const r = rules(ruleInput);
          const ps = players(...Array.from({ length: n }, (_, i) => `P${i}`));
          const c = { players: ps, rng: createRng(1) };
          let s = quarters.setup(r, c, {});
          let missesThisTurn = 0;
          let passesSeen = 0;

          for (const x of shots) {
            // Settle anything pending first (pick someone else, or write a rule).
            while (s.pending) {
              const p = s.pending;
              const target = s.order.find((id) => id !== p.by) as string;
              const a: Action = x.skip
                ? SKIP
                : p.kind === 'pick'
                  ? pick(target)
                  : { type: 'RESOLVE', text: 'rule' };
              expect(quarters.validate(s, a, 'host', r)).toBeNull();
              const step = quarters.reduce(s, a, c, r);
              expect(step.state.shooter).toBe(s.shooter);
              s = step.state;
            }

            const a = shot(x.made, x.bounced);
            expect(quarters.validate(s, a, 'host', r)).toBeNull();
            const before = s.shooter;
            const step = quarters.reduce(s, a, c, r);
            const counted = x.made && (x.bounced || !r.mustBounce);
            expect(step.state.lastShot?.counted).toBe(counted);
            if (counted) {
              // A make never passes the coin.
              expect(step.state.shooter).toBe(before);
              expect(step.state.pending?.kind).toBe('pick');
            } else {
              missesThisTurn += 1;
              expect(missesThisTurn).toBeLessThanOrEqual(r.missesBeforePass);
              const passed = step.state.shooter !== before;
              expect(passed).toBe(missesThisTurn === r.missesBeforePass);
              if (passed) {
                passesSeen += 1;
                missesThisTurn = 0;
                expect(step.state.shooter).toBe((before + 1) % n);
                expect(step.effects).toContainEqual({
                  type: 'passTo',
                  player: step.state.order[step.state.shooter],
                  private: false,
                });
              }
            }
            expect(step.state.misses).toBe(missesThisTurn);
            s = step.state;
          }
          expect(s.turnNo).toBe(1 + passesSeen);
          expect(s.houseRules.length).toBeLessThanOrEqual(MAX_HOUSE_RULES);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('every pick drinks exactly the configured sips', () => {
    fc.assert(
      fc.property(
        arbRules,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 60 }),
        (ruleInput, makes) => {
          const r = rules(ruleInput);
          let s = quarters.setup(r, ctx(), {});
          const all: Effect[] = [];
          let picks = 0;
          for (const made of makes) {
            const step = quarters.reduce(s, shot(made), ctx(), r);
            s = step.state;
            while (s.pending) {
              const a: Action =
                s.pending.kind === 'pick'
                  ? pick(s.order.find((id) => id !== s.pending?.by) as string)
                  : SKIP;
              if (a.type === 'RESOLVE') picks += 1;
              const settled = quarters.reduce(s, a, ctx(), r);
              all.push(...settled.effects);
              s = settled.state;
            }
          }
          expect(drinks(all)).toHaveLength(picks);
          for (const d of drinks(all)) expect(d).toMatchObject({ amount: r.sips, kind: 'drink' });
          expect(notices(all)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
