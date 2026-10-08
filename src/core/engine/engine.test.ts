import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from './rng';
import { resolveDrink } from './drink';
import { sessionReducer, startSession } from './session';
import { higherLower } from '../games/higher-lower/logic';
import { intensity, players } from '../test/fixtures';
import type { DrinkEffect } from './types';

const drink = (patch: Partial<DrinkEffect> = {}): DrinkEffect => ({
  type: 'drink',
  to: ['p1'],
  amount: 2,
  kind: 'drink',
  reason: { key: 'x' },
  ...patch,
});

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.random())).toEqual(
      Array.from({ length: 5 }, () => b.random()),
    );
  });

  it('int stays in range and shuffle is a permutation', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (seed, min, span) => {
          const rng = createRng(seed);
          const n = rng.int(min, min + span);
          expect(n).toBeGreaterThanOrEqual(min);
          expect(n).toBeLessThanOrEqual(min + span);
          const items = Array.from({ length: span }, (_, i) => i);
          expect(rng.shuffle(items).sort((x, y) => x - y)).toEqual(items);
        },
      ),
    );
  });
});

describe('resolveDrink', () => {
  const ps = players('Ana', 'Ben');

  it('applies the multiplier and per-turn cap', () => {
    expect(resolveDrink(drink({ amount: 3 }), intensity({ multiplier: 2 }), ps)[0]?.amount).toBe(4);
    expect(resolveDrink(drink({ amount: 1 }), intensity({ multiplier: 0.5 }), ps)[0]?.amount).toBe(
      1,
    );
  });

  it('converts to tagay (1 tagay per 3 sips, rounded up)', () => {
    const [e] = resolveDrink(drink({ amount: 4 }), intensity({ unit: 'tagay' }), ps);
    expect(e).toMatchObject({ unit: 'tagay', amount: 2 });
  });

  it('downgrades a finish to the cap unless allowed', () => {
    expect(resolveDrink(drink({ finish: true }), intensity(), ps)[0]).toMatchObject({
      finish: false,
      amount: 4,
    });
    expect(
      resolveDrink(drink({ finish: true }), intensity({ allowFinish: true }), ps)[0]?.finish,
    ).toBe(true);
  });

  it('skips sitting-out players and marks non-alcoholic ones', () => {
    const roster = [
      { ...ps[0]!, sittingOut: true },
      { ...ps[1]!, nonAlcoholic: true },
    ];
    const out = resolveDrink(drink({ to: ['p1', 'p2'] }), intensity({ unit: 'tagay' }), roster);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ playerId: 'p2', alcoholic: false, unit: 'sip' });
  });

  it('non-alcoholic mode never finishes', () => {
    const out = resolveDrink(
      drink({ finish: true }),
      intensity({ mode: 'non-alcoholic', allowFinish: true }),
      ps,
    );
    expect(out[0]).toMatchObject({ alcoholic: false, finish: false });
  });
});

describe('session', () => {
  const start = (seed = 7) =>
    startSession(higherLower, {
      rules: {},
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed,
    });

  it('replays identically from the same seed and actions', () => {
    const run = () => {
      let s = start(123);
      for (const guess of ['higher', 'lower', 'higher', 'higher', 'lower'] as const) {
        s = sessionReducer(higherLower, s, {
          type: 'GAME',
          action: { type: 'GUESS', guess },
        }).state;
      }
      return s;
    };
    expect(run()).toEqual(run());
  });

  it('rejects malformed actions without changing state', () => {
    const s = start();
    const step = sessionReducer(higherLower, s, {
      type: 'GAME',
      action: { type: 'GUESS', guess: 'sideways' },
    });
    expect(step.error).toBe('error.badAction');
    expect(step.state).toBe(s);
  });

  it('rejects a remote actor acting out of turn', () => {
    const step = sessionReducer(
      higherLower,
      start(),
      { type: 'GAME', action: { type: 'GUESS', guess: 'higher' } },
      'p2',
    );
    expect(step.error).toBe('error.notYourTurn');
  });

  it('logs manual drinks and renames players', () => {
    let s = start();
    s = sessionReducer(higherLower, s, { type: 'MANUAL_DRINK', to: ['p2'], amount: 2 }).state;
    expect(s.drinks).toHaveLength(1);
    s = sessionReducer(higherLower, s, {
      type: 'UPDATE_PLAYER',
      playerId: 'p2',
      patch: { name: '  Benjie ' },
    }).state;
    expect(s.players[1]?.name).toBe('Benjie');
  });
});

describe('give drinks', () => {
  it('shows sips a player hands out but never logs them as drunk', () => {
    const s = startSession(higherLower, {
      rules: {},
      players: players('Ana', 'Ben'),
      intensity: intensity(),
      seed: 1,
    });
    // Exercise applyEffects through a game-agnostic path: a manual drink is logged, a give is not.
    const logic = {
      ...higherLower,
      reduce: (st: unknown) => ({
        state: st,
        effects: [
          {
            type: 'drink' as const,
            to: ['p1'],
            amount: 2,
            kind: 'give' as const,
            reason: { key: 'x' },
          },
        ],
      }),
    };
    const step = sessionReducer(logic, s, {
      type: 'GAME',
      action: { type: 'GUESS', guess: 'higher' },
    });
    expect(step.effects).toEqual([expect.objectContaining({ type: 'drinks', kind: 'give' })]);
    expect(step.state.drinks).toHaveLength(0);
  });
});
