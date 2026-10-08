import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng, type Rng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect, Player } from '../../engine/types';
import { intensity, players } from '../../test/fixtures';
import {
  DIFFICULTIES,
  FLIP_ODDS,
  SUDDEN_DEATH_ROUNDS,
  actionSchema,
  flipChance,
  flipCup,
  rulesSchema,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: unknown = {}): Rules => rulesSchema.parse(patch);
const FOUR = players('Ana', 'Ben', 'Cy', 'Dee');
const TWO = players('Ana', 'Ben');

/** An RNG whose random() returns the scripted values in order. */
const scripted = (values: number[]): Rng => {
  const queue = [...values];
  return {
    random() {
      const v = queue.shift();
      if (v === undefined) throw new Error('script ran out');
      return v;
    },
    int: () => {
      throw new Error('int() not expected');
    },
    pick: () => {
      throw new Error('pick() not expected');
    },
    shuffle: (items) => items.slice(),
    get state() {
      return 0;
    },
  };
};

const ctx = (ps: Player[] = FOUR, rng: Rng = createRng(1)) => ({ players: ps, rng });
const start = (r: Rules = rules(), ps: Player[] = FOUR) => flipCup.setup(r, ctx(ps), {});

type Step = { state: State; effects: Effect[] };

const act = (
  s: State,
  a: Action,
  r: Rules,
  ps: Player[] = FOUR,
  rng: Rng = createRng(1),
  actor: Actor = 'host',
): Step => {
  expect(flipCup.validate(s, a, actor, r)).toBeNull();
  return flipCup.reduce(s, a, ctx(ps, rng), r);
};

const DRANK: Action = { type: 'DRANK' };
/** Quality 0.5: p ≥ 0.355 on every difficulty, so 0 always lands and 0.999 always misses. */
const flip = (quality = 0.5): Action => ({ type: 'FLIP_ATTEMPT', quality });

/** One FLIP_ATTEMPT with a forced outcome, then SETTLED. */
const attempt = (s: State, success: boolean, r: Rules, ps: Player[] = FOUR): Step => {
  const tried = act(s, flip(), r, ps, scripted([success ? 0 : 0.999]));
  const settled = act(tried.state, { type: 'SETTLED', flipId: tried.state.flip?.id ?? -1 }, r, ps);
  return { state: settled.state, effects: [...tried.effects, ...settled.effects] };
};

/** Play the current leg: drink if needed, miss `tries - 1` times, then land it. */
const runLeg = (s: State, tries: number, r: Rules, ps: Player[] = FOUR): Step => {
  let state = s;
  const effects: Effect[] = [];
  const push = (step: Step) => {
    state = step.state;
    effects.push(...step.effects);
  };
  if (state.phase === 'drink') push(act(state, DRANK, r, ps));
  for (let i = 1; i < tries; i++) push(attempt(state, false, r, ps));
  push(attempt(state, true, r, ps));
  return { state, effects };
};

const runLegs = (s: State, tries: number[], r: Rules, ps: Player[] = FOUR): Step => {
  let state = s;
  const effects: Effect[] = [];
  for (const t of tries) {
    const step = runLeg(state, t, r, ps);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
};

const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');
const notices = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'notice' ? [e.msg.key] : []));
const passes = (effects: Effect[]) =>
  effects.flatMap((e) => (e.type === 'passTo' ? [e.player] : []));
const legPlayers = (s: State) => s.legs.map((l) => `${l.player}:${l.team}`);

describe('flip cup rules', () => {
  it('parses defaults', () => {
    expect(rules()).toEqual({
      teams: 'alternate',
      drinkBeforeFlip: true,
      sips: 1,
      difficulty: 'normal',
      loserSips: 2,
      maxAttemptsPerLeg: 8,
    });
    expect(rulesSchema.safeParse({ difficulty: 'insane' }).success).toBe(false);
    expect(rulesSchema.safeParse({ maxAttemptsPerLeg: 2 }).success).toBe(false);
    expect(rulesSchema.safeParse({ loserSips: 0 }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.fc.${key}`);
      expect(field.default).toBeDefined();
    }
  });
});

describe('flip cup odds', () => {
  it('maps quality to a chance through the exported constants', () => {
    expect(flipChance('normal', 0)).toBeCloseTo(0.2, 9);
    expect(flipChance('normal', 0.5)).toBeCloseTo(0.5, 9);
    expect(flipChance('normal', 1)).toBeCloseTo(0.8, 9);
    expect(flipChance('easy', 1)).toBeCloseTo(FLIP_ODDS.easy.base + FLIP_ODDS.easy.gain, 9);
    // Quality is clamped to 0..1 first.
    expect(flipChance('hard', 7)).toBe(flipChance('hard', 1));
    expect(flipChance('hard', -2)).toBe(flipChance('hard', 0));
  });

  it('is a probability, rises with quality, and easy ≥ normal ≥ hard', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 2, noNaN: true }),
        fc.double({ min: -1, max: 2, noNaN: true }),
        (a, b) => {
          for (const d of DIFFICULTIES) {
            const p = flipChance(d, a);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
            if (a <= b) expect(p).toBeLessThanOrEqual(flipChance(d, b));
          }
          expect(flipChance('easy', a)).toBeGreaterThanOrEqual(flipChance('normal', a));
          expect(flipChance('normal', a)).toBeGreaterThanOrEqual(flipChance('hard', a));
        },
      ),
    );
  });
});

describe('flip cup setup', () => {
  it('alternates teams leg by leg', () => {
    const s = start();
    expect(s.teams).toEqual([
      ['p1', 'p3'],
      ['p2', 'p4'],
    ]);
    expect(legPlayers(s)).toEqual(['p1:0', 'p2:1', 'p3:0', 'p4:1']);
    expect(s).toMatchObject({
      leg: 0,
      phase: 'drink',
      flip: null,
      suddenDeath: 0,
      winner: null,
      draw: false,
    });
    expect(flipCup.activeActor(s)).toBe('p1');
  });

  it("'halves' teams still alternate legs", () => {
    const s = start(rules({ teams: 'halves' }));
    expect(s.teams).toEqual([
      ['p1', 'p2'],
      ['p3', 'p4'],
    ]);
    expect(legPlayers(s)).toEqual(['p1:0', 'p3:1', 'p2:0', 'p4:1']);
  });

  it('the shorter team doubles up so both run the same number of legs', () => {
    const s = start(rules(), players('Ana', 'Ben', 'Cy'));
    expect(legPlayers(s)).toEqual(['p1:0', 'p2:1', 'p3:0', 'p2:1']);
  });

  it('needs two players', () => {
    const s = start(rules(), players('Solo'));
    expect(s.legs).toEqual([]);
    expect(flipCup.isOver(s)).toBe(true);
    expect(flipCup.activeActor(s)).toBeNull();
    expect(flipCup.validate(s, DRANK, 'host', rules())).toBe('error.noPlayers');
    expect((flipCup.project(s, 'table') as View).current).toBeNull();
  });
});

describe('flip cup legs', () => {
  it('"Inom muna!": each leg starts with a drink before any flip', () => {
    const r = rules({ sips: 2 });
    const s = start(r);
    expect(flipCup.validate(s, flip(), 'host', r)).toBe('fc.error.drinkFirst');
    const { state, effects } = act(s, DRANK, r);
    expect(effects).toEqual([
      { type: 'drink', to: ['p1'], amount: 2, kind: 'drink', reason: { key: 'fc.reason.drink' } },
    ]);
    expect(state.phase).toBe('flip');
    expect(flipCup.validate(state, DRANK, 'host', r)).toBe('fc.error.notDrinking');
  });

  it('with drinkBeforeFlip off, legs start at the flip', () => {
    const r = rules({ drinkBeforeFlip: false });
    const s = start(r);
    expect(s.phase).toBe('flip');
    expect(flipCup.validate(s, DRANK, 'host', r)).toBe('fc.error.notDrinking');
    const done = runLeg(s, 1, r);
    expect(done.state.phase).toBe('flip');
    expect(drinks(done.effects)).toEqual([]);
  });

  it('the reducer decides the flip first; only SETTLED of a success moves on', () => {
    const r = rules();
    const ready = act(start(r), DRANK, r).state;
    const tried = act(ready, flip(1), r, FOUR, scripted([0.79]));
    expect(tried.state.flip).toEqual({ id: 1, quality: 1, success: true, settled: false });
    expect(tried.state.legs[0]?.attempts).toBe(1);
    expect(tried.state.leg).toBe(0);
    expect(tried.effects).toEqual([]);
    expect(flipCup.validate(tried.state, flip(), 'host', r)).toBe('fc.error.flipping');
    expect(flipCup.validate(tried.state, { type: 'SETTLED', flipId: 2 }, 'host', r)).toBe(
      'fc.error.staleFlip',
    );

    const { state, effects } = act(tried.state, { type: 'SETTLED', flipId: 1 }, r);
    expect(state.flip?.settled).toBe(true);
    expect(state.legs[0]).toMatchObject({ player: 'p1', attempts: 1, result: 'flipped' });
    expect(state).toMatchObject({ leg: 1, phase: 'drink' });
    expect(effects).toEqual([
      { type: 'notice', msg: { key: 'fc.notice.flipped', params: { name: 'Ana', attempts: 1 } } },
      { type: 'passTo', player: 'p2', private: false },
    ]);
    expect(flipCup.validate(state, { type: 'SETTLED', flipId: 1 }, 'host', r)).toBe(
      'fc.error.staleFlip',
    );
    expect(flipCup.activeActor(state)).toBe('p2');
  });

  it('a failed flip settles and the same player tries again', () => {
    const r = rules();
    const ready = act(start(r), DRANK, r).state;
    const tried = act(ready, flip(1), r, FOUR, scripted([0.8]));
    expect(tried.state.flip?.success).toBe(false);
    const { state, effects } = act(tried.state, { type: 'SETTLED', flipId: 1 }, r);
    expect(effects).toEqual([]);
    expect(state).toMatchObject({ leg: 0, phase: 'flip' });
    expect(state.legs[0]?.result).toBeNull();
    const again = act(state, flip(), r, FOUR, scripted([0.1]));
    expect(again.state.flip).toMatchObject({ id: 2, settled: false });
    expect(again.state.legs[0]?.attempts).toBe(2);
  });

  it('quality is clamped, and must be a finite number', () => {
    const r = rules({ drinkBeforeFlip: false });
    const s = start(r);
    expect(act(s, flip(9), r, FOUR, scripted([0.5])).state.flip?.quality).toBe(1);
    expect(act(s, flip(-3), r, FOUR, scripted([0.5])).state.flip?.quality).toBe(0);
    expect(flipCup.validate(s, flip(NaN), 'host', r)).toBe('fc.error.badQuality');
    expect(flipCup.validate(s, flip(Infinity), 'host', r)).toBe('fc.error.badQuality');
    expect(actionSchema.safeParse({ type: 'FLIP_ATTEMPT', quality: Infinity }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'FLIP_ATTEMPT', quality: 0.4 }).success).toBe(true);
  });

  it('the responsible cap auto-passes the player; the tries still count', () => {
    const r = rules({ maxAttemptsPerLeg: 3, drinkBeforeFlip: false });
    let s = start(r);
    s = attempt(s, false, r).state;
    s = attempt(s, false, r).state;
    expect(s.leg).toBe(0);
    const { state, effects } = attempt(s, false, r);
    expect(state.legs[0]).toMatchObject({ attempts: 3, result: 'capped' });
    expect(state.leg).toBe(1);
    expect(effects).toEqual([
      { type: 'notice', msg: { key: 'fc.notice.capped', params: { name: 'Ana', attempts: 3 } } },
      { type: 'passTo', player: 'p2', private: false },
    ]);
    expect((flipCup.project(state, 'table') as View).teamAttempts).toEqual([3, 0]);
  });

  it('only the leg’s player may act remotely; the host always may', () => {
    const r = rules();
    const s = start(r);
    expect(flipCup.validate(s, DRANK, 'p2', r)).toBe('error.notYourTurn');
    expect(flipCup.validate(s, DRANK, 'p1', r)).toBeNull();
    const ready = act(s, DRANK, r, FOUR, createRng(1), 'p1').state;
    expect(flipCup.validate(ready, flip(), 'p3', r)).toBe('error.notYourTurn');
    const tried = act(ready, flip(), r, FOUR, scripted([0]), 'p1').state;
    expect(flipCup.validate(tried, { type: 'SETTLED', flipId: 1 }, 'p2', r)).toBe(
      'error.notYourTurn',
    );
    expect(flipCup.validate(tried, { type: 'SETTLED', flipId: 1 }, 'p1', r)).toBeNull();
  });
});

describe('flip cup scoring', () => {
  it('fewer total tries wins; the losing team drinks a social', () => {
    const r = rules({ loserSips: 3 });
    const { state, effects } = runLegs(start(r), [1, 2, 3, 1], r);
    // Team 0: Ana 1 + Cy 3 = 4. Team 1: Ben 2 + Dee 1 = 3.
    expect(state).toMatchObject({ phase: 'over', winner: 1, draw: false });
    expect(flipCup.isOver(state)).toBe(true);
    expect(flipCup.activeActor(state)).toBeNull();
    expect(effects.slice(-2)).toEqual([
      { type: 'notice', msg: { key: 'fc.notice.win.1', params: { names: 'Ben, Dee' } } },
      {
        type: 'drink',
        to: ['p1', 'p3'],
        amount: 3,
        kind: 'social',
        reason: { key: 'fc.reason.lost' },
      },
    ]);
    // One "Inom muna!" per leg.
    expect(
      drinks(effects)
        .filter((d) => d.reason.key === 'fc.reason.drink')
        .map((d) => d.to),
    ).toEqual([['p1'], ['p2'], ['p3'], ['p4']]);
    expect(passes(effects)).toEqual(['p2', 'p3', 'p4']);
    expect(flipCup.validate(state, DRANK, 'host', r)).toBe('error.gameOver');

    const view = flipCup.project(state, 'table') as View;
    expect(view).toMatchObject({
      current: null,
      currentTeam: null,
      attempts: { p1: 1, p2: 2, p3: 3, p4: 1 },
      teamAttempts: [4, 3],
      roundAttempts: [4, 3],
    });
  });

  it('a tie goes to sudden death: one more leg each, continuing the rotation', () => {
    const r = rules({ drinkBeforeFlip: false });
    const tied = runLegs(start(r), [2, 1, 1, 2], r);
    expect(tied.state.suddenDeath).toBe(1);
    expect(tied.state.phase).toBe('flip');
    expect(tied.effects).toContainEqual({
      type: 'notice',
      msg: { key: 'fc.notice.suddenDeath', params: { round: 1 } },
    });
    expect(legPlayers(tied.state).slice(4)).toEqual(['p1:0', 'p2:1']);
    expect(tied.state.legs.slice(4).every((l) => l.round === 1)).toBe(true);
    expect(passes(tied.effects).at(-1)).toBe('p1');

    // Sudden death only compares its own round.
    const again = runLegs(tied.state, [3, 3], r);
    expect(again.state.suddenDeath).toBe(2);
    expect(legPlayers(again.state).slice(6)).toEqual(['p3:0', 'p4:1']);

    const done = runLegs(again.state, [1, 2], r);
    expect(done.state).toMatchObject({ phase: 'over', winner: 0 });
    expect(drinks(done.effects).at(-1)).toMatchObject({ to: ['p2', 'p4'], kind: 'social' });
    const view = flipCup.project(done.state, 'table') as View;
    expect(view.teamAttempts).toEqual([3, 3]);
    expect(view.roundAttempts).toEqual([1, 2]);
    expect(view.attempts).toEqual({ p1: 5, p2: 4, p3: 2, p4: 4 });
  });

  it(`${SUDDEN_DEATH_ROUNDS} tied sudden-death rounds make a draw: everyone drinks`, () => {
    const r = rules({ drinkBeforeFlip: false, loserSips: 1 });
    let s = runLegs(start(r, TWO), [1, 1], r, TWO).state;
    let last: Effect[] = [];
    for (let i = 0; i < SUDDEN_DEATH_ROUNDS; i++) {
      expect(s.suddenDeath).toBe(i + 1);
      const step = runLegs(s, [2, 2], r, TWO);
      s = step.state;
      last = step.effects;
    }
    expect(s).toMatchObject({ phase: 'over', winner: null, draw: true });
    expect(s.legs).toHaveLength(2 + 2 * SUDDEN_DEATH_ROUNDS);
    expect(notices(last)).toContain('fc.notice.draw');
    expect(drinks(last).at(-1)).toEqual({
      type: 'drink',
      to: ['p1', 'p2'],
      amount: 1,
      kind: 'social',
      reason: { key: 'fc.reason.draw' },
    });
  });

  it('runs through the session reducer to a result', () => {
    let session = startSession(flipCup, {
      rules: { difficulty: 'easy' },
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 11,
    });
    for (let i = 0; i < 500 && !session.over; i++) {
      const g = session.game as State;
      const action: Action =
        g.phase === 'drink'
          ? DRANK
          : g.flip && !g.flip.settled
            ? { type: 'SETTLED', flipId: g.flip.id }
            : flip(0.7);
      const step = sessionReducer(flipCup, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    const g = session.game as State;
    expect(g.winner !== null || g.draw).toBe(true);
    expect(session.drinks.filter((d) => d.reason.key === 'fc.reason.drink').length).toBe(
      g.legs.length,
    );
  });
});

describe('flip cup invariants', () => {
  const arbRules = fc.record({
    teams: fc.constantFrom('alternate' as const, 'halves' as const),
    drinkBeforeFlip: fc.boolean(),
    sips: fc.integer({ min: 1, max: 5 }),
    difficulty: fc.constantFrom(...DIFFICULTIES),
    loserSips: fc.integer({ min: 1, max: 5 }),
    maxAttemptsPerLeg: fc.integer({ min: 3, max: 15 }),
  });

  it('every leg ends within the cap, tries are conserved, and the race always ends', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        arbRules,
        fc.integer({ min: 2, max: 9 }),
        fc.array(fc.double({ min: -0.5, max: 1.5, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (seed, ruleInput, n, qualities) => {
          const r = rules(ruleInput);
          const c = {
            players: players(...Array.from({ length: n }, (_, i) => `P${i}`)),
            rng: createRng(seed),
          };
          let s = flipCup.setup(r, c, {});
          const legCount = s.legs.length;
          let flips = 0;
          let preDrinks = 0;
          const finalDrinks: DrinkEffect[] = [];
          const maxActions = (legCount + 2 * SUDDEN_DEATH_ROUNDS) * (2 * r.maxAttemptsPerLeg + 1);

          for (let i = 0; !flipCup.isOver(s); i++) {
            if (i > maxActions) throw new Error('race never ended');
            const a: Action =
              s.phase === 'drink'
                ? DRANK
                : s.flip && !s.flip.settled
                  ? { type: 'SETTLED', flipId: s.flip.id }
                  : flip(qualities[i % qualities.length]);
            expect(flipCup.validate(s, a, 'host', r)).toBeNull();
            const before = s;
            const step = flipCup.reduce(s, a, c, r);
            s = step.state;
            if (a.type === 'FLIP_ATTEMPT') flips += 1;
            for (const d of drinks(step.effects)) {
              if (d.reason.key === 'fc.reason.drink') preDrinks += 1;
              else finalDrinks.push(d);
            }

            // A leg never runs past the cap, and only a success or the cap closes it.
            for (const l of s.legs) {
              expect(l.attempts).toBeLessThanOrEqual(r.maxAttemptsPerLeg);
              if (l.result === 'capped') expect(l.attempts).toBe(r.maxAttemptsPerLeg);
              if (l.result !== null) expect(l.attempts).toBeGreaterThanOrEqual(1);
            }
            if (s.leg !== before.leg) {
              const closed = s.legs[before.leg];
              expect(closed?.result).not.toBeNull();
              expect(closed?.result === 'flipped').toBe(before.flip?.success === true);
            }
          }

          // Conservation: every FLIP_ATTEMPT is one try on exactly one leg, and the HUD totals agree.
          const view = flipCup.project(s, 'table') as View;
          const total = s.legs.reduce((sum, l) => sum + l.attempts, 0);
          expect(total).toBe(flips);
          expect(Object.values(view.attempts).reduce((a, b) => a + b, 0)).toBe(flips);
          const byRound = new Map<number, number>();
          for (const l of s.legs) byRound.set(l.round, (byRound.get(l.round) ?? 0) + l.attempts);
          expect(view.teamAttempts[0] + view.teamAttempts[1]).toBe(byRound.get(0));

          expect(s.legs.every((l) => l.result !== null)).toBe(true);
          expect(s.legs.length).toBe(legCount + 2 * s.suddenDeath);
          expect(s.suddenDeath).toBeLessThanOrEqual(SUDDEN_DEATH_ROUNDS);
          expect(preDrinks).toBe(r.drinkBeforeFlip ? s.legs.length : 0);

          // The decided round has a strict winner; a draw only after every sudden-death round tied.
          const [t0, t1] = view.roundAttempts;
          if (s.draw) {
            expect(s.winner).toBeNull();
            expect(s.suddenDeath).toBe(SUDDEN_DEATH_ROUNDS);
            expect(t0).toBe(t1);
            expect(finalDrinks).toEqual([expect.objectContaining({ to: s.order, kind: 'social' })]);
          } else {
            expect(s.winner).toBe(t0 < t1 ? 0 : 1);
            expect(t0).not.toBe(t1);
            const losers = s.teams[s.winner === 0 ? 1 : 0];
            expect(finalDrinks).toEqual([
              expect.objectContaining({ to: losers, amount: r.loserSips, kind: 'social' }),
            ]);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
