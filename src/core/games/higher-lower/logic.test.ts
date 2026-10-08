import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../../engine/rng';
import { players } from '../../test/fixtures';
import { higherLower, rulesSchema, type State } from './logic';

const rules = (patch = {}) => rulesSchema.parse(patch);
const ctx = (seed = 1) => ({ players: players('Ana', 'Ben', 'Cy'), rng: createRng(seed) });

/** Build a state whose current card and next card are fixed. 0 = 2♠ … 12 = A♠, 13 = 2♥ … */
const rigged = (current: number, next: number, patch: Partial<State> = {}): State => ({
  order: ['p1', 'p2', 'p3'],
  turn: 0,
  deck: [5, 6, next],
  pile: [current],
  streak: 0,
  last: null,
  ...patch,
});

describe('higher or lower', () => {
  it('deals one face-up card from a full deck', () => {
    const s = higherLower.setup(rules(), ctx(), {});
    expect(s.pile).toHaveLength(1);
    expect(s.deck).toHaveLength(51);
  });

  it('a correct guess grows the streak and keeps the turn', () => {
    const { state, effects } = higherLower.reduce(rigged(3, 8), { type: 'GUESS', guess: 'higher' }, ctx(), rules());
    expect(state.last?.outcome).toBe('correct');
    expect(state.streak).toBe(1);
    expect(state.turn).toBe(0);
    expect(effects).toEqual([]);
  });

  it('a wrong guess drinks and passes the turn', () => {
    const { state, effects } = higherLower.reduce(rigged(8, 3), { type: 'GUESS', guess: 'higher' }, ctx(), rules());
    expect(state.turn).toBe(1);
    expect(effects[0]).toMatchObject({ type: 'drink', to: ['p1'], amount: 1 });
    expect(effects[1]).toMatchObject({ type: 'passTo', player: 'p2' });
  });

  it('streak penalty adds the streak to the sips', () => {
    const s = rigged(8, 3, { streak: 2 });
    const { effects } = higherLower.reduce(s, { type: 'GUESS', guess: 'higher' }, ctx(), rules({ penalty: 'streak', passAfter: 0 }));
    expect(effects[0]).toMatchObject({ amount: 3 });
  });

  it('passes the turn after the safe streak', () => {
    const { state, effects } = higherLower.reduce(rigged(3, 8, { streak: 2 }), { type: 'GUESS', guess: 'higher' }, ctx(), rules());
    expect(state.turn).toBe(1);
    expect(state.streak).toBe(0);
    expect(effects.map((e) => e.type)).toEqual(['notice', 'passTo']);
  });

  it('handles ties per rule', () => {
    // 3 (2+3=5) vs 16 (5♥): same rank
    const lose = higherLower.reduce(rigged(3, 16), { type: 'GUESS', guess: 'higher' }, ctx(), rules());
    expect(lose.effects[0]).toMatchObject({ type: 'drink', to: ['p1'] });
    const social = higherLower.reduce(rigged(3, 16), { type: 'GUESS', guess: 'higher' }, ctx(), rules({ tie: 'social' }));
    expect(social.effects[0]).toMatchObject({ kind: 'social', to: ['p1', 'p2', 'p3'] });
    expect(social.state.streak).toBe(1);
  });

  it('ace low flips the comparison', () => {
    // 12 = A♠ vs 0 = 2♠: lower when aces are high, higher when low
    expect(higherLower.reduce(rigged(12, 0), { type: 'GUESS', guess: 'lower' }, ctx(), rules()).state.last?.outcome).toBe('correct');
    expect(higherLower.reduce(rigged(12, 0), { type: 'GUESS', guess: 'higher' }, ctx(), rules({ aceHigh: false })).state.last?.outcome).toBe('correct');
  });

  it('never loses or duplicates a card across many guesses (reshuffles included)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.constantFrom('higher' as const, 'lower' as const), { maxLength: 150 }), (seed, guesses) => {
        const c = ctx(seed);
        let s = higherLower.setup(rules(), c, {});
        for (const guess of guesses) s = higherLower.reduce(s, { type: 'GUESS', guess }, c, rules()).state;
        const all = [...s.deck, ...s.pile].sort((a, b) => a - b);
        expect(all).toEqual(Array.from({ length: 52 }, (_, i) => i));
      }),
    );
  });

  it('project hides the draw order', () => {
    const view = higherLower.project(rigged(3, 8), 'table') as Record<string, unknown>;
    expect(view.deck).toBeUndefined();
    expect(view.deckCount).toBe(3);
  });
});
