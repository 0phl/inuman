import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import { createRng, type Rng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect } from '../../engine/types';
import { FACES, type Face } from '../../primitives/dice';
import { intensity, players } from '../../test/fixtures';
import {
  ROLE_FACE,
  cargoOf,
  hasCrew,
  lockDice,
  rulesSchema,
  shipCaptainCrew as scc,
  type Action,
  type Die,
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

const act = (
  s: State,
  a: Action,
  r: Rules,
  rng: Rng = createRng(1),
  actor: Actor = 'host',
): Step => {
  expect(scc.validate(s, a, actor, r)).toBeNull();
  return scc.reduce(s, a, ctx(rng), r);
};

/** ROLL the unlocked dice to the given faces (in die order), then SETTLED. */
const roll = (s: State, faces: Face[], r: Rules): Step => {
  const rolled = act(s, { type: 'ROLL' }, r, scripted(faces));
  const settled = act(rolled.state, { type: 'SETTLED', rollId: rolled.state.roll?.id ?? -1 }, r);
  return { state: settled.state, effects: [...rolled.effects, ...settled.effects] };
};

/** A full turn: the listed rolls, then KEEP if the turn hasn't ended by itself. */
const turn = (s: State, rolls: Face[][], r: Rules): Step => {
  let state = s;
  const effects: Effect[] = [];
  const who = s.turn;
  for (const faces of rolls) {
    const step = roll(state, faces, r);
    state = step.state;
    effects.push(...step.effects);
  }
  if (state.turn === who && state.phase === 'rolling') {
    const step = act(state, { type: 'KEEP' }, r);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
};

const start = (r: Rules = rules()) => scc.setup(r, ctx(), {});
const dice = (...spec: [Face | null, Die['lockedAs']][]): Die[] =>
  spec.map(([face, lockedAs]) => ({ face, lockedAs }));
const unlocked = (...faces: Face[]): Die[] => faces.map((face) => ({ face, lockedAs: null }));
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');

describe('ship captain crew rules', () => {
  it('parses defaults', () => {
    expect(rules()).toEqual({ maxRolls: 3, loserSips: 1, winnerGivesSips: 0 });
    expect(rulesSchema.safeParse({ winnerGivesSips: 6 }).success).toBe(false);
    expect(rulesSchema.safeParse({ maxRolls: 0 }).success).toBe(false);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.scc.${key}`);
      expect(field.default).toBeDefined();
    }
  });
});

describe('locking', () => {
  it('6-5-4 in one roll locks ship, captain and crew together', () => {
    const out = lockDice(unlocked(4, 2, 6, 5, 3));
    expect(out.map((d) => d.lockedAs)).toEqual(['crew', null, 'ship', 'captain', null]);
    expect(hasCrew(out)).toBe(true);
    expect(cargoOf(out)).toBe(5);
  });

  it('nothing locks without a ship', () => {
    expect(lockDice(unlocked(5, 4, 3, 2, 1)).every((d) => d.lockedAs === null)).toBe(true);
  });

  it('a crew needs the captain first', () => {
    const out = lockDice(unlocked(6, 4, 4, 2, 1));
    expect(out.map((d) => d.lockedAs)).toEqual(['ship', null, null, null, null]);
    expect(hasCrew(out)).toBe(false);
    expect(cargoOf(out)).toBe(0);
  });

  it('locks only one die per role', () => {
    const out = lockDice(unlocked(6, 6, 5, 5, 4));
    expect(out.map((d) => d.lockedAs)).toEqual(['ship', null, 'captain', null, 'crew']);
    expect(cargoOf(out)).toBe(11);
  });

  it('builds on earlier locks', () => {
    const out = lockDice(dice([6, 'ship'], [4, null], [5, null], [1, null], [2, null]));
    expect(out.map((d) => d.lockedAs)).toEqual(['ship', 'crew', 'captain', null, null]);
  });

  it('cargo showing 6, 5 or 4 stays cargo', () => {
    const full = dice([6, 'ship'], [5, 'captain'], [4, 'crew'], [6, null], [5, null]);
    expect(lockDice(full)).toEqual(full);
    expect(cargoOf(full)).toBe(11);
  });
});

describe('ship captain crew turns', () => {
  it('sets up five blank dice and the first seat rolling', () => {
    const s = start();
    expect(s.dice).toEqual(
      dice([null, null], [null, null], [null, null], [null, null], [null, null]),
    );
    expect(s).toMatchObject({
      round: 1,
      turnOrder: ['p1', 'p2', 'p3'],
      turn: 0,
      rollsUsed: 0,
      cap: 3,
      phase: 'rolling',
    });
    expect(scc.activeActor(s)).toBe('p1');
  });

  it('ROLL throws all five dice first; dice change only once SETTLED', () => {
    const r = rules();
    const rolled = act(start(r), { type: 'ROLL' }, r, scripted([6, 2, 3, 1, 1])).state;
    expect(rolled.roll).toEqual({
      id: 1,
      faces: [6, 2, 3, 1, 1],
      indices: [0, 1, 2, 3, 4],
      settled: false,
    });
    expect(rolled.dice.every((d) => d.face === null)).toBe(true);
    expect(scc.validate(rolled, { type: 'ROLL' }, 'host', r)).toBe('scc.error.rolling');
    expect(scc.validate(rolled, { type: 'KEEP' }, 'host', r)).toBe('scc.error.rolling');
    expect(scc.validate(rolled, { type: 'SETTLED', rollId: 2 }, 'host', r)).toBe(
      'scc.error.staleRoll',
    );

    const { state } = act(rolled, { type: 'SETTLED', rollId: 1 }, r);
    expect(state.dice).toEqual(dice([6, 'ship'], [2, null], [3, null], [1, null], [1, null]));
    expect(state.roll?.settled).toBe(true);
  });

  it('re-rolls only the unlocked dice', () => {
    const r = rules();
    const first = roll(start(r), [2, 6, 3, 1, 1], r).state;
    const rolled = act(first, { type: 'ROLL' }, r, scripted([5, 4, 1, 2])).state;
    expect(rolled.roll?.indices).toEqual([0, 2, 3, 4]);
    expect(rolled.roll?.faces).toHaveLength(4);
    const { state, effects } = act(rolled, { type: 'SETTLED', rollId: 2 }, r);
    expect(state.dice).toEqual(
      dice([5, 'captain'], [6, 'ship'], [4, 'crew'], [1, null], [2, null]),
    );
    expect(effects).toEqual([
      { type: 'notice', msg: { key: 'scc.notice.crew', params: { name: 'Ana' } } },
    ]);
    // With the crew aboard, only the two cargo dice roll.
    expect(act(state, { type: 'ROLL' }, r, scripted([3, 3])).state.roll?.indices).toEqual([3, 4]);
  });

  it('KEEP needs a full crew, then scores the cargo and passes on', () => {
    const r = rules();
    const noCrew = roll(start(r), [6, 5, 1, 1, 2], r).state;
    expect(scc.validate(noCrew, { type: 'KEEP' }, 'host', r)).toBe('scc.error.noCrew');
    expect(scc.validate(start(r), { type: 'KEEP' }, 'host', r)).toBe('scc.error.noCrew');

    const crewed = roll(start(r), [6, 5, 4, 3, 6], r).state;
    const { state, effects } = act(crewed, { type: 'KEEP' }, r);
    expect(state.scores).toEqual([
      { player: 'p1', score: 9, qualified: true, rolls: 1, faces: [6, 5, 4, 3, 6] },
    ]);
    expect(state.turn).toBe(1);
    expect(state.rollsUsed).toBe(0);
    expect(state.dice.every((d) => d.face === null && d.lockedAs === null)).toBe(true);
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);
  });

  it('rolling the cargo again can improve (or worsen) the score', () => {
    const r = rules();
    let s = roll(start(r), [6, 5, 4, 1, 1], r).state;
    s = roll(s, [6, 3], r).state;
    expect(cargoOf(s.dice)).toBe(9);
    s = roll(s, [2, 1], r).state;
    // Third roll was the last: the turn ends with whatever landed.
    expect(s.scores[0]).toMatchObject({ player: 'p1', score: 3, qualified: true, rolls: 3 });
    expect(s.turn).toBe(1);
  });

  it('no full crew after the last roll scores 0', () => {
    const r = rules({ maxRolls: 2 });
    let s = roll(start(r), [1, 2, 3, 4, 5], r).state;
    const { state, effects } = roll(s, [6, 5, 3, 3, 3], r);
    s = state;
    expect(s.scores[0]).toEqual({
      player: 'p1',
      score: 0,
      qualified: false,
      rolls: 2,
      faces: [6, 5, 3, 3, 3],
    });
    expect(effects).toContainEqual({
      type: 'notice',
      msg: { key: 'scc.notice.sunk', params: { name: 'Ana' } },
    });
    expect(effects).toContainEqual({ type: 'passTo', player: 'p2', private: false });
  });

  it('a perfect 12 cargo ends the turn at once', () => {
    const r = rules();
    const { state } = roll(start(r), [6, 5, 4, 6, 6], r);
    expect(state.scores[0]).toMatchObject({ score: 12, rolls: 1 });
    expect(state.turn).toBe(1);
  });

  it('rejects rolls past maxRolls', () => {
    const r = rules({ maxRolls: 2 });
    const s = { ...roll(start(r), [1, 1, 1, 1, 1], r).state, rollsUsed: 2 };
    expect(scc.validate(s, { type: 'ROLL' }, 'host', r)).toBe('scc.error.noRollsLeft');
  });
});

describe('ship captain crew rounds', () => {
  const play = (r: Rules, plan: Face[][][]) => {
    let s = start(r);
    const effects: Effect[] = [];
    for (const rolls of plan) {
      const step = turn(s, rolls, r);
      s = step.state;
      effects.push(...step.effects);
    }
    return { state: s, effects };
  };

  it('the lowest score drinks; a winner give is off by default', () => {
    const { state, effects } = play(rules({ loserSips: 2 }), [
      [[6, 5, 4, 5, 5]],
      [[6, 5, 4, 1, 2]],
      [[6, 5, 4, 6, 3]],
    ]);
    expect(state.phase).toBe('roundOver');
    expect(state.losers).toEqual(['p2']);
    expect(state.winners).toEqual(['p1']);
    expect(drinks(effects)).toEqual([
      { type: 'drink', to: ['p2'], amount: 2, kind: 'drink', reason: { key: 'scc.reason.lowest' } },
    ]);
    expect(effects).toContainEqual({
      type: 'notice',
      msg: { key: 'scc.notice.lost', params: { names: 'Ben', round: 1 } },
    });
    expect(scc.activeActor(state)).toBe('any');
    expect(scc.validate(state, { type: 'ROLL' }, 'host', rules())).toBe('scc.error.roundOver');
  });

  it('ties for lowest all drink', () => {
    const r = rules({ maxRolls: 1 });
    const { state, effects } = play(r, [[[1, 1, 1, 1, 1]], [[6, 5, 4, 2, 2]], [[2, 2, 2, 2, 2]]]);
    expect(state.losers).toEqual(['p1', 'p3']);
    expect(drinks(effects)[0]?.to).toEqual(['p1', 'p3']);
  });

  it('winnerGivesSips gives the top scorer sips to hand out', () => {
    const r = rules({ winnerGivesSips: 3 });
    const { effects } = play(r, [[[6, 5, 4, 5, 5]], [[6, 5, 4, 1, 2]], [[6, 5, 4, 6, 3]]]);
    expect(drinks(effects)).toEqual([
      { type: 'drink', to: ['p2'], amount: 1, kind: 'drink', reason: { key: 'scc.reason.lowest' } },
      { type: 'drink', to: ['p1'], amount: 3, kind: 'give', reason: { key: 'scc.reason.give' } },
    ]);
  });

  it('nobody gives when everyone ties', () => {
    const r = rules({ maxRolls: 1, winnerGivesSips: 3 });
    const { state, effects } = play(r, [[[1, 1, 1, 1, 1]], [[2, 2, 2, 2, 2]], [[3, 3, 3, 3, 3]]]);
    expect(state.losers).toEqual(['p1', 'p2', 'p3']);
    expect(state.winners).toEqual([]);
    expect(drinks(effects)).toHaveLength(1);
  });

  it('NEXT_ROUND starts fresh with the loser first', () => {
    const r = rules();
    const over = play(r, [[[6, 5, 4, 5, 5]], [[6, 5, 4, 6, 3]], [[6, 5, 4, 1, 2]]]).state;
    expect(scc.validate(start(r), { type: 'NEXT_ROUND' }, 'host', r)).toBe(
      'scc.error.roundNotOver',
    );
    expect(scc.validate(over, { type: 'NEXT_ROUND' }, 'stranger', r)).toBe('error.notYourTurn');
    const { state, effects } = act(over, { type: 'NEXT_ROUND' }, r, createRng(1), 'p1');
    expect(state).toMatchObject({
      round: 2,
      turnOrder: ['p3', 'p1', 'p2'],
      turn: 0,
      scores: [],
      losers: [],
      winners: [],
      phase: 'rolling',
    });
    expect(effects).toEqual([{ type: 'passTo', player: 'p3', private: false }]);
  });
});

describe('ship captain crew validation and views', () => {
  it('only the current seat may act remotely; the host always may', () => {
    const r = rules();
    const s = start(r);
    expect(scc.validate(s, { type: 'ROLL' }, 'p2', r)).toBe('error.notYourTurn');
    expect(scc.validate(s, { type: 'ROLL' }, 'p1', r)).toBeNull();
    const rolled = act(s, { type: 'ROLL' }, r, createRng(5), 'p1').state;
    expect(scc.validate(rolled, { type: 'SETTLED', rollId: 1 }, 'p3', r)).toBe('error.notYourTurn');
    expect(scc.validate(rolled, { type: 'SETTLED', rollId: 1 }, 'p1', r)).toBeNull();
  });

  it('project adds who is up, rolls left, and the current cargo', () => {
    const r = rules();
    const s = roll(start(r), [6, 5, 4, 2, 3], r).state;
    expect(scc.project(s, 'table')).toMatchObject({
      current: 'p1',
      rollsLeft: 2,
      qualified: true,
      cargo: 5,
    } satisfies Partial<View>);
  });

  it('no players means no game', () => {
    const s = scc.setup(rules(), { players: [], rng: createRng(1) }, {});
    expect(scc.isOver(s)).toBe(true);
    expect(scc.activeActor(s)).toBeNull();
    expect(scc.validate(s, { type: 'ROLL' }, 'host', rules())).toBe('error.noPlayers');
  });
});

describe('ship captain crew invariants', () => {
  it('dice never unlock mid-turn, locks follow ship → captain → crew, and rounds end with the lowest drinking', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
        (seed, maxRolls, n, keepChoices) => {
          const r = rules({ maxRolls });
          const c = {
            players: players(...Array.from({ length: n }, (_, i) => `P${i}`)),
            rng: createRng(seed),
          };
          let s = scc.setup(r, c, {});
          let k = 0;
          for (let round = 0; round < 2; round++) {
            const roundDrinks: DrinkEffect[] = [];
            for (let guard = 0; s.phase === 'rolling'; guard++) {
              if (guard > 200) throw new Error('round never ended');
              const wantKeep = keepChoices[k++ % keepChoices.length] as boolean;
              const a: Action =
                s.roll && !s.roll.settled
                  ? { type: 'SETTLED', rollId: s.roll.id }
                  : wantKeep && hasCrew(s.dice)
                    ? { type: 'KEEP' }
                    : { type: 'ROLL' };
              expect(scc.validate(s, a, 'host', r)).toBeNull();
              const step = scc.reduce(s, a, c, r);
              const next = step.state;
              roundDrinks.push(...drinks(step.effects));

              if (a.type === 'ROLL') {
                // Exactly the unlocked dice are thrown, one face each.
                expect(next.roll?.indices).toEqual(
                  s.dice.flatMap((d, i) => (d.lockedAs ? [] : [i])),
                );
                expect(next.roll?.faces).toHaveLength(next.roll?.indices.length ?? -1);
              }
              if (next.turn === s.turn && next.phase === 'rolling') {
                // Same turn: every locked die keeps its role and face.
                s.dice.forEach((d, i) => {
                  if (d.lockedAs) expect(next.dice[i]).toEqual(d);
                });
              }
              // Role chain and faces.
              const roles = next.dice.map((d) => d.lockedAs).filter(Boolean);
              expect(new Set(roles).size).toBe(roles.length);
              if (roles.includes('crew')) expect(roles).toContain('captain');
              if (roles.includes('captain')) expect(roles).toContain('ship');
              for (const d of next.dice) if (d.lockedAs) expect(d.face).toBe(ROLE_FACE[d.lockedAs]);
              expect(next.rollsUsed).toBeLessThanOrEqual(maxRolls);
              s = next;
            }

            expect(s.scores.map((x) => x.player)).toEqual(s.turnOrder);
            for (const x of s.scores) {
              expect(x.score).toBeGreaterThanOrEqual(x.qualified ? 2 : 0);
              expect(x.score).toBeLessThanOrEqual(12);
              if (!x.qualified) expect(x.score).toBe(0);
              for (const f of x.faces) expect(FACES).toContain(f);
            }
            const low = Math.min(...s.scores.map((x) => x.score));
            expect(s.losers).toEqual(s.scores.filter((x) => x.score === low).map((x) => x.player));
            expect(roundDrinks).toHaveLength(1);
            expect(roundDrinks[0]?.to).toEqual(s.losers);

            const loser = s.losers[0];
            s = scc.reduce(s, { type: 'NEXT_ROUND' }, c, r).state;
            expect(s.turnOrder[0]).toBe(loser);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('runs through the session reducer', () => {
    let session = startSession(scc, {
      rules: { winnerGivesSips: 2 },
      players: players('Ana', 'Ben'),
      intensity: intensity(),
      seed: 4,
    });
    let rounds = 0;
    for (let i = 0; i < 300 && rounds < 3; i++) {
      const g = session.game as State;
      const action: Action =
        g.phase === 'roundOver'
          ? { type: 'NEXT_ROUND' }
          : g.roll && !g.roll.settled
            ? { type: 'SETTLED', rollId: g.roll.id }
            : { type: 'ROLL' };
      if (action.type === 'NEXT_ROUND') rounds += 1;
      const step = sessionReducer(scc, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(rounds).toBe(3);
    expect(session.drinks.length).toBeGreaterThanOrEqual(3);
  });
});
