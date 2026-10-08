import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect, Player } from '../../engine/types';
import { intensity, players } from '../../test/fixtures';
import {
  FORMATIONS,
  FORMATION_SLOTS,
  MAX_IMPULSE,
  MAX_ORIGIN,
  actionSchema,
  beerPong,
  rerackFits,
  rulesSchema,
  type Action,
  type Formation,
  type Hit,
  type Rules,
  type State,
  type View,
} from './logic';
import { formTeams, isSaneThrow } from './skill';

const rules = (patch: unknown = {}): Rules => rulesSchema.parse(patch);
const FOUR = players('Ana', 'Ben', 'Cy', 'Dee');

const ctx = (ps: Player[] = FOUR) => ({ players: ps, rng: createRng(1) });
const start = (r: Rules = rules(), ps: Player[] = FOUR) => beerPong.setup(r, ctx(ps), {});

type Step = { state: State; effects: Effect[] };

/** Validate (as `actor`) and reduce, failing the test on a rejected action. */
const act = (s: State, a: Action, r: Rules, actor: Actor = 'host', ps: Player[] = FOUR): Step => {
  expect(beerPong.validate(s, a, actor, r)).toBeNull();
  return beerPong.reduce(s, a, ctx(ps), r);
};

const shot = (hit: Hit | null): Action => ({
  type: 'THROW_RESOLVED',
  impulse: [0.2, 1.5, -3],
  origin: [0, 0.8, 2],
  hit,
});
const MISS = shot(null);
const hitOn = (team: 0 | 1, cupId: number) => shot({ team, cupId });

/** Run actions in order (all must be legal), concatenating effects. */
const play = (s: State, actions: Action[], r: Rules, ps: Player[] = FOUR): Step => {
  let state = s;
  const effects: Effect[] = [];
  for (const a of actions) {
    const step = act(state, a, r, 'host', ps);
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
const ids = (s: State, team: 0 | 1) => s.teams[team].cups.map((c) => c.id);

describe('beer pong rules', () => {
  it('parses defaults', () => {
    expect(rules()).toEqual({
      teams: 'alternate',
      cups: 6,
      throwsPerTurn: 2,
      ballsBack: true,
      cupSips: 2,
      drinker: 'rotate',
      reracks: 1,
      aimAssist: 2,
      loserSips: 2,
    });
    expect(rulesSchema.safeParse({ cups: 8 }).success).toBe(false);
    expect(rulesSchema.safeParse({ throwsPerTurn: 3 }).success).toBe(false);
    expect(rulesSchema.safeParse({ cupSips: 0 }).success).toBe(false);
    expect(rulesSchema.safeParse({ reracks: 4 }).success).toBe(false);
    expect(rulesSchema.safeParse({ aimAssist: -1 }).success).toBe(false);
    expect(rulesSchema.safeParse({ drinker: 'captain' }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown; enum?: unknown[] }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.bp.${key}`);
      expect(field.default).toBeDefined();
    }
    // Numeric choices render as enums in the editor.
    expect(json.properties.cups?.enum).toEqual([6, 10]);
    expect(json.properties.throwsPerTurn?.enum).toEqual([1, 2]);
  });
});

describe('beer pong formations', () => {
  it('each formation has one slot per cup it holds', () => {
    expect(Object.fromEntries(FORMATIONS.map((f) => [f, FORMATION_SLOTS[f].length]))).toEqual({
      tri10: 10,
      tri6: 6,
      tri3: 3,
      line2: 2,
      single: 1,
    });
  });

  it('is normalized: front cup at the origin, everything else further away, cups never overlap', () => {
    for (const f of FORMATIONS) {
      const slots = FORMATION_SLOTS[f];
      expect(slots[0]).toEqual({ x: 0, y: 0 });
      for (const s of slots) expect(s.y).toBeGreaterThanOrEqual(0);
      let closest = Infinity;
      for (let i = 0; i < slots.length; i++)
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i] as { x: number; y: number };
          const b = slots[j] as { x: number; y: number };
          closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
        }
      // Touching cups are one diameter apart.
      if (slots.length > 1) expect(closest).toBeCloseTo(1, 9);
    }
  });

  it('triangles are symmetric and the small ones are the front of the big one', () => {
    expect(FORMATION_SLOTS.tri6).toEqual(FORMATION_SLOTS.tri10.slice(0, 6));
    expect(FORMATION_SLOTS.tri3).toEqual(FORMATION_SLOTS.tri10.slice(0, 3));
    const xs = FORMATION_SLOTS.tri10.map((s) => s.x);
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
    expect(FORMATION_SLOTS.tri10[9]?.y).toBeCloseTo(3 * (Math.sqrt(3) / 2), 9);
  });

  it('rerackFits lists the other shapes with the same cup count', () => {
    const cups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, slot: i }));
    expect(rerackFits({ cups: cups(6), formation: 'tri10' })).toEqual(['tri6']);
    expect(rerackFits({ cups: cups(6), formation: 'tri6' })).toEqual([]);
    expect(rerackFits({ cups: cups(3), formation: 'tri6' })).toEqual(['tri3']);
    expect(rerackFits({ cups: cups(4), formation: 'tri6' })).toEqual([]);
  });
});

describe('beer pong setup', () => {
  it('forms alternating teams by seat and racks 6 cups each', () => {
    const s = start();
    expect(s.teams[0]).toMatchObject({ members: ['p1', 'p3'], formation: 'tri6', reracksLeft: 1 });
    expect(s.teams[1]).toMatchObject({ members: ['p2', 'p4'], formation: 'tri6' });
    expect(ids(s, 0)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s.teams[1].cups.map((c) => c.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(s).toMatchObject({
      turn: 0,
      turnNo: 1,
      throwsTaken: 0,
      throwsLeft: 2,
      phase: 'throwing',
    });
    expect(beerPong.activeActor(s)).toBe('p1');
    expect(beerPong.isOver(s)).toBe(false);
  });

  it("'halves' splits the seats down the middle; 10 cups use the big triangle", () => {
    const s = start(
      rules({ teams: 'halves', cups: 10, reracks: 3 }),
      players('A', 'B', 'C', 'D', 'E'),
    );
    expect(s.teams[0].members).toEqual(['p1', 'p2', 'p3']);
    expect(s.teams[1].members).toEqual(['p4', 'p5']);
    expect(s.teams[0]).toMatchObject({ formation: 'tri10', reracksLeft: 3 });
    expect(s.teams[1].cups).toHaveLength(10);
  });

  it('formTeams never leaves a team empty with 2+ players', () => {
    for (let n = 2; n <= 20; n++) {
      const order = Array.from({ length: n }, (_, i) => `p${i}`);
      for (const mode of ['alternate', 'halves'] as const) {
        const [a, b] = formTeams(order, mode);
        expect(a.length).toBeGreaterThan(0);
        expect(b.length).toBeGreaterThan(0);
        expect([...a, ...b].sort()).toEqual([...order].sort());
        expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('needs two players', () => {
    const s = start(rules(), players('Solo'));
    expect(beerPong.isOver(s)).toBe(true);
    expect(beerPong.activeActor(s)).toBeNull();
    expect(beerPong.validate(s, MISS, 'host', rules())).toBe('error.noPlayers');
  });
});

describe('beer pong throwing', () => {
  it('a miss rotates to the teammate, then the turn passes to the other team', () => {
    const r = rules();
    const one = act(start(r), MISS, r);
    expect(one.state).toMatchObject({ turn: 0, throwsTaken: 1, throwsLeft: 1 });
    expect(one.state.lastThrow).toMatchObject({ id: 1, team: 0, thrower: 'p1', hit: null });
    expect(one.effects).toEqual([{ type: 'passTo', player: 'p3', private: false }]);
    expect(beerPong.activeActor(one.state)).toBe('p3');

    const two = act(one.state, MISS, r);
    expect(two.state).toMatchObject({ turn: 1, turnNo: 2, throwsTaken: 0, throwsLeft: 2 });
    expect(two.effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);

    // Team 1 throws twice, then team 0's rotation wraps back to the first thrower.
    const back = play(two.state, [MISS, MISS], r);
    expect(passes(back.effects)).toEqual(['p4', 'p1']);
    expect(back.state.stats).toEqual({
      p1: { throws: 1, hits: 0 },
      p2: { throws: 1, hits: 0 },
      p3: { throws: 1, hits: 0 },
      p4: { throws: 1, hits: 0 },
    });
  });

  it('a solo team keeps the ball: no pass between its own throws', () => {
    const r = rules();
    const ps = players('Ana', 'Ben');
    const one = act(start(r, ps), MISS, r, 'host', ps);
    expect(one.effects).toEqual([]);
    expect(beerPong.activeActor(one.state)).toBe('p1');
    const two = act(one.state, MISS, r, 'host', ps);
    expect(passes(two.effects)).toEqual(['p2']);
  });

  it('a hit sinks the cup and the next drinker of the defending team drinks', () => {
    const r = rules({ cupSips: 3 });
    const { state, effects } = act(start(r), hitOn(1, 4), r);
    expect(ids(state, 1)).toEqual([0, 1, 2, 3, 5]);
    expect(ids(state, 0)).toHaveLength(6);
    expect(state.teams[1].drinker).toBe(1);
    expect(state.hitsThisTurn).toBe(1);
    expect(state.stats.p1).toEqual({ throws: 1, hits: 1 });
    expect(effects).toEqual([
      {
        type: 'notice',
        msg: { key: 'bp.notice.hit', params: { name: 'Ana', drinkers: 'Ben', left: 5 } },
      },
      { type: 'drink', to: ['p2'], amount: 3, kind: 'drink', reason: { key: 'bp.reason.cup' } },
      { type: 'passTo', player: 'p3', private: false },
    ]);
    // Drinkers rotate through the defending team.
    const next = act(state, hitOn(1, 0), rules({ cupSips: 3, ballsBack: false }));
    expect(drinks(next.effects)[0]?.to).toEqual(['p4']);
  });

  it("drinker 'team': every defender drinks a sunk cup", () => {
    const r = rules({ drinker: 'team' });
    const { state, effects } = act(start(r), hitOn(1, 0), r);
    expect(drinks(effects)).toEqual([
      {
        type: 'drink',
        to: ['p2', 'p4'],
        amount: 2,
        kind: 'drink',
        reason: { key: 'bp.reason.cup' },
      },
    ]);
    expect(state.teams[1].drinker).toBe(0);
  });

  it('balls back: two hits in a turn and the same team throws again', () => {
    const r = rules();
    const { state, effects } = play(start(r), [hitOn(1, 0), hitOn(1, 1)], r);
    expect(state).toMatchObject({ turn: 0, turnNo: 2, throwsTaken: 0, throwsLeft: 2 });
    expect(effects).toContainEqual({
      type: 'notice',
      msg: { key: 'bp.notice.ballsBack', params: { names: 'Ana, Cy' } },
    });
    // The rotation continues: Ana throws next.
    expect(passes(effects)).toEqual(['p3', 'p1']);
    expect(beerPong.activeActor(state)).toBe('p1');
  });

  it('no balls back with the rule off, after a single hit, or with one throw per turn', () => {
    const off = rules({ ballsBack: false });
    expect(play(start(off), [hitOn(1, 0), hitOn(1, 1)], off).state.turn).toBe(1);
    const r = rules();
    expect(play(start(r), [hitOn(1, 0), MISS], r).state.turn).toBe(1);
    const single = rules({ throwsPerTurn: 1 });
    const one = act(start(single), hitOn(1, 0), single);
    expect(one.state).toMatchObject({ turn: 1, throwsLeft: 1 });
    expect(notices(one.effects)).not.toContain('bp.notice.ballsBack');
  });
});

describe('beer pong validation', () => {
  it('a hit must name a standing cup on the defending rack', () => {
    const r = rules();
    const s = start(r);
    expect(beerPong.validate(s, hitOn(0, 0), 'host', r)).toBe('bp.error.ownCup');
    expect(beerPong.validate(s, hitOn(1, 6), 'host', r)).toBe('bp.error.noCup');
    const sunk = act(s, hitOn(1, 2), r).state;
    expect(beerPong.validate(sunk, hitOn(1, 2), 'host', r)).toBe('bp.error.noCup');
    expect(beerPong.validate(sunk, hitOn(1, 3), 'host', r)).toBeNull();
  });

  it('impulses must be finite and within the exported bounds', () => {
    const r = rules();
    const s = start(r);
    const bad = (impulse: number[], origin: number[] = [0, 0, 0]) =>
      beerPong.validate(
        s,
        { type: 'THROW_RESOLVED', impulse, origin, hit: null } as unknown as Action,
        'host',
        r,
      );
    expect(bad([MAX_IMPULSE, 0, 0])).toBeNull();
    expect(bad([MAX_IMPULSE, 1, 0])).toBe('bp.error.badThrow');
    expect(bad([NaN, 0, 0])).toBe('bp.error.badThrow');
    expect(bad([0, Infinity, 0])).toBe('bp.error.badThrow');
    expect(bad([0, 0])).toBe('bp.error.badThrow');
    expect(bad([0, 1, 0], [0, 0, MAX_ORIGIN + 1])).toBe('bp.error.badThrow');
    expect(isSaneThrow([1, 2, 3], [0, 0, 0])).toBe(true);
  });

  it('the action schema rejects non-finite numbers and malformed vectors', () => {
    const parse = (a: unknown) => actionSchema.safeParse(a).success;
    expect(
      parse({ type: 'THROW_RESOLVED', impulse: [0, 1, 2], origin: [0, 0, 0], hit: null }),
    ).toBe(true);
    expect(parse({ type: 'THROW_RESOLVED', impulse: [0, 1], origin: [0, 0, 0], hit: null })).toBe(
      false,
    );
    expect(
      parse({ type: 'THROW_RESOLVED', impulse: [0, Infinity, 2], origin: [0, 0, 0], hit: null }),
    ).toBe(false);
    expect(
      parse({
        type: 'THROW_RESOLVED',
        impulse: [0, 1, 2],
        origin: [0, 0, 0],
        hit: { team: 2, cupId: 0 },
      }),
    ).toBe(false);
    expect(parse({ type: 'THROW_RESOLVED', impulse: [0, 1, 2], origin: [0, 0, 0] })).toBe(false);
    expect(parse({ type: 'RERACK', formation: 'diamond' })).toBe(false);
  });

  it('only the current thrower may throw remotely; the host always may', () => {
    const r = rules();
    const s = start(r);
    expect(beerPong.validate(s, MISS, 'p3', r)).toBe('error.notYourTurn');
    expect(beerPong.validate(s, MISS, 'p2', r)).toBe('error.notYourTurn');
    expect(beerPong.validate(s, MISS, 'p1', r)).toBeNull();
    expect(beerPong.validate(s, MISS, 'host', r)).toBeNull();
  });
});

describe('beer pong reracks', () => {
  /** Team 0 sinks team 1's cups 0, 1 and 4 over two turns, leaving 3 cups in tri6 slots 2, 3, 5. */
  const threeLeft = (r: Rules) =>
    play(start(r), [hitOn(1, 0), MISS, MISS, MISS, hitOn(1, 1), hitOn(1, 4)], r);

  it('reshapes the rack the throwing team shoots at, front cups first', () => {
    const r = rules({ ballsBack: false });
    const s = threeLeft(r).state;
    expect(s.turn).toBe(1);
    // It's team 1's turn now: team 0's rack still has 6 cups. Let team 1 miss twice.
    const t0 = play(s, [MISS, MISS], r).state;
    expect(t0.turn).toBe(0);
    expect(ids(t0, 1)).toEqual([2, 3, 5]);
    const view = beerPong.project(t0, 'table') as View;
    expect(view.rerackOptions).toEqual(['tri3']);
    expect(beerPong.validate(t0, { type: 'RERACK', formation: 'tri3' }, 'p2', r)).toBe(
      'error.notYourTurn',
    );
    expect(beerPong.validate(t0, { type: 'RERACK', formation: 'tri3' }, 'p3', r)).toBeNull();

    const { state, effects } = act(t0, { type: 'RERACK', formation: 'tri3' }, r);
    expect(state.teams[1].formation).toBe('tri3');
    expect(state.teams[1].cups).toEqual([
      { id: 2, slot: 0 },
      { id: 3, slot: 1 },
      { id: 5, slot: 2 },
    ]);
    expect(state.teams[0].reracksLeft).toBe(0);
    expect(state.teams[1].reracksLeft).toBe(1);
    expect(state).toMatchObject({ turn: 0, throwsTaken: 0, throwsLeft: 2 });
    expect(effects).toEqual([
      { type: 'notice', msg: { key: 'bp.notice.rerack', params: { name: 'Ana' } } },
    ]);
    expect(beerPong.validate(state, { type: 'RERACK', formation: 'tri3' }, 'host', r)).toBe(
      'bp.error.noReracks',
    );
    expect((beerPong.project(state, 'table') as View).rerackOptions).toEqual([]);
  });

  it('only fits the remaining count, never the same shape, and only before throwing', () => {
    const r = rules({ ballsBack: false, reracks: 2 });
    const s = start(r);
    const rerack = (st: State, formation: Formation) =>
      beerPong.validate(st, { type: 'RERACK', formation }, 'host', r);
    expect(rerack(s, 'tri6')).toBe('bp.error.sameFormation');
    expect(rerack(s, 'tri3')).toBe('bp.error.formation');
    expect(rerack(s, 'tri10')).toBe('bp.error.formation');
    const thrown = act(s, MISS, r).state;
    expect(rerack(thrown, 'tri6')).toBe('bp.error.rerackLate');
    expect((beerPong.project(thrown, 'table') as View).rerackOptions).toEqual([]);

    const none = rules({ reracks: 0 });
    expect(
      beerPong.validate(start(none), { type: 'RERACK', formation: 'tri6' }, 'host', none),
    ).toBe('bp.error.noReracks');
  });
});

describe('beer pong game over', () => {
  it('sinking the last cup wins; the losing team drinks a social', () => {
    const r = rules({ loserSips: 4, ballsBack: false, throwsPerTurn: 1 });
    const ps = players('Ana', 'Ben');
    let s = start(r, ps);
    const effects: Effect[] = [];
    for (let cup = 0; cup < 6; cup++) {
      const step = play(s, [hitOn(1, cup), ...(cup < 5 ? [MISS] : [])], r, ps);
      s = step.state;
      effects.push(...step.effects);
    }
    expect(s).toMatchObject({ phase: 'over', winner: 0, throwsLeft: 0 });
    expect(s.teams[1].cups).toEqual([]);
    expect(beerPong.isOver(s)).toBe(true);
    expect(beerPong.activeActor(s)).toBeNull();
    expect(effects.slice(-2)).toEqual([
      { type: 'notice', msg: { key: 'bp.notice.win.0', params: { names: 'Ana' } } },
      { type: 'drink', to: ['p2'], amount: 4, kind: 'social', reason: { key: 'bp.reason.lost' } },
    ]);
    expect(passes(effects.slice(-3))).toEqual([]);
    expect(beerPong.validate(s, MISS, 'host', r)).toBe('error.gameOver');
    expect((beerPong.project(s, 'table') as View).current).toBeNull();
  });

  it('team 1 can win too', () => {
    const r = rules({ throwsPerTurn: 1 });
    const ps = players('Ana', 'Ben');
    let s = start(r, ps);
    let last: Effect[] = [];
    for (let cup = 0; cup < 6; cup++) {
      const step = play(s, [MISS, hitOn(0, cup)], r, ps);
      s = step.state;
      last = step.effects;
    }
    expect(s.winner).toBe(1);
    expect(notices(last)).toContain('bp.notice.win.1');
    expect(drinks(last).at(-1)).toMatchObject({ to: ['p1'], kind: 'social' });
  });

  it('project exposes who is up, the defending rack and cup counts', () => {
    const r = rules();
    const s = act(start(r), hitOn(1, 0), r).state;
    const view = beerPong.project(s, 'table') as View;
    expect(view).toMatchObject({
      current: 'p3',
      defending: 1,
      cupsLeft: [6, 5],
      rerackOptions: [],
    });
  });
});

describe('beer pong invariants', () => {
  const arbRules = fc.record({
    teams: fc.constantFrom('alternate' as const, 'halves' as const),
    cups: fc.constantFrom(6 as const, 10 as const),
    throwsPerTurn: fc.constantFrom(1 as const, 2 as const),
    ballsBack: fc.boolean(),
    cupSips: fc.integer({ min: 1, max: 5 }),
    drinker: fc.constantFrom('rotate' as const, 'team' as const),
    reracks: fc.integer({ min: 0, max: 3 }),
    aimAssist: fc.integer({ min: 0, max: 3 }),
    loserSips: fc.integer({ min: 1, max: 5 }),
  });
  const arbMove = fc.record({
    kind: fc.constantFrom('miss', 'hit', 'hit', 'hit', 'wild', 'rerack'),
    a: fc.nat(),
    b: fc.nat(),
  });

  it('cups never come back, hits only sink standing cups, and a bare rack ends the game', () => {
    fc.assert(
      fc.property(
        arbRules,
        fc.integer({ min: 2, max: 8 }),
        fc.array(arbMove, { minLength: 1, maxLength: 120 }),
        (ruleInput, n, moves) => {
          const r = rules(ruleInput);
          const c = {
            players: players(...Array.from({ length: n }, (_, i) => `P${i}`)),
            rng: createRng(1),
          };
          let s = beerPong.setup(r, c, {});
          let thrown = 0;
          let hits = 0;

          for (const m of moves) {
            if (beerPong.isOver(s)) break;
            const defending = s.turn === 0 ? 1 : 0;
            let a: Action;
            if (m.kind === 'miss') a = MISS;
            else if (m.kind === 'hit') {
              const cups = s.teams[defending].cups;
              a = hitOn(defending, (cups[m.a % cups.length] as { id: number }).id);
            } else if (m.kind === 'wild') a = hitOn((m.a % 2) as 0 | 1, m.b % 10);
            else
              a = { type: 'RERACK', formation: FORMATIONS[m.a % FORMATIONS.length] as Formation };

            const error = beerPong.validate(s, a, 'host', r);
            if (a.type === 'THROW_RESOLVED' && a.hit) {
              const standing = s.teams[a.hit.team].cups.some((x) => x.id === a.hit?.cupId);
              expect(error === null).toBe(a.hit.team === defending && standing);
            }
            if (error) continue;

            const before = [ids(s, 0), ids(s, 1)];
            const step = beerPong.reduce(s, a, c, r);
            s = step.state;
            for (const t of [0, 1] as const) {
              const after = ids(s, t);
              // Never grows, and only ever loses cups it had.
              expect(after.length).toBeLessThanOrEqual(before[t]?.length ?? 0);
              for (const id of after) expect(before[t]).toContain(id);
              // Slots stay unique and inside the rack's formation.
              const slots = s.teams[t].cups.map((x) => x.slot);
              expect(new Set(slots).size).toBe(slots.length);
              for (const slot of slots)
                expect(slot).toBeLessThan(FORMATION_SLOTS[s.teams[t].formation].length);
            }
            if (a.type === 'THROW_RESOLVED') {
              thrown += 1;
              if (a.hit) {
                hits += 1;
                expect(ids(s, a.hit.team)).not.toContain(a.hit.cupId);
                expect(ids(s, a.hit.team)).toHaveLength((before[a.hit.team]?.length ?? 0) - 1);
                expect(drinks(step.effects).some((d) => d.reason.key === 'bp.reason.cup')).toBe(
                  true,
                );
              }
            }
            const bare = s.teams.some((t) => t.cups.length === 0);
            expect(beerPong.isOver(s)).toBe(bare);
            if (bare) {
              expect(s.winner).toBe(s.teams[0].cups.length === 0 ? 1 : 0);
              expect(drinks(step.effects).at(-1)).toMatchObject({
                kind: 'social',
                amount: r.loserSips,
              });
            }
          }

          // Cups only leave the table through hits.
          expect(s.teams[0].cups.length + s.teams[1].cups.length).toBe(2 * r.cups - hits);
          const st = Object.values(s.stats);
          expect(st.reduce((sum, x) => sum + x.throws, 0)).toBe(thrown);
          expect(st.reduce((sum, x) => sum + x.hits, 0)).toBe(hits);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('always ends once one side has sunk every cup', () => {
    fc.assert(
      fc.property(
        arbRules,
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.boolean(), { maxLength: 30 }),
        (ruleInput, n, rest) => {
          const r = rules(ruleInput);
          const c = {
            players: players(...Array.from({ length: n }, (_, i) => `P${i}`)),
            rng: createRng(1),
          };
          let s = beerPong.setup(r, c, {});
          // Team 0 hits by pattern (at least once per cycle), team 1 always misses.
          const pattern = [true, ...rest];
          let k = 0;
          for (let i = 0; !beerPong.isOver(s); i++) {
            if (i > 4 * r.cups * pattern.length + 8) throw new Error('game never ended');
            const cups = s.teams[1].cups;
            // `k` only advances on team 0's throws (short-circuit).
            const hit = s.turn === 0 && pattern[k++ % pattern.length];
            const a = hit ? hitOn(1, (cups[0] as { id: number }).id) : MISS;
            expect(beerPong.validate(s, a, 'host', r)).toBeNull();
            s = beerPong.reduce(s, a, c, r).state;
          }
          expect(s.teams[1].cups).toEqual([]);
          expect(s.winner).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('runs through the session reducer to a winner', () => {
    let session = startSession(beerPong, {
      rules: { throwsPerTurn: 1 },
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 4,
    });
    for (let i = 0; i < 200 && !session.over; i++) {
      const g = session.game as State;
      const defending = g.turn === 0 ? 1 : 0;
      const cup = g.teams[defending].cups[0];
      const action: Action = i % 3 === 0 && cup ? hitOn(defending, cup.id) : MISS;
      const step = sessionReducer(beerPong, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect((session.game as State).winner).not.toBeNull();
    expect(session.drinks.some((d) => d.kind === 'social')).toBe(true);
    expect(
      sessionReducer(beerPong, session, {
        type: 'GAME',
        action: { type: 'THROW_RESOLVED', impulse: [0, 0], origin: [0, 0, 0], hit: null },
      }).error,
    ).toBe('error.gameOver');
  });
});
