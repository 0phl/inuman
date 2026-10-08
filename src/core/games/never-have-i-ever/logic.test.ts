import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PromptItem } from '../../content/schemas';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import { intensity, players } from '../../test/fixtures';
import { neverHaveIEver as nhie, rulesSchema, type Action, type Rules, type State } from './logic';

const rules = (patch: Partial<Rules> = {}): Rules => rulesSchema.parse(patch);
const ctx = (seed = 1, names = ['Ana', 'Ben', 'Cy']) => ({
  players: players(...names),
  rng: createRng(seed),
});

const prompt = (id: string, spice = 0, patch: Partial<PromptItem> = {}): PromptItem => ({
  id,
  text: `Never have I ever ${id}`,
  spice,
  ...patch,
});
const spread = [
  prompt('s0a', 0),
  prompt('s0b', 0),
  prompt('s1', 1),
  prompt('s2', 2),
  prompt('s3', 3),
];

/** Every prompt the game still holds: the current one plus the deck. */
const held = (s: State) => [...(s.current ? [s.current.item] : []), ...s.deck];

const next = (did: string[] = []): Action => ({ type: 'NEXT', did });

describe('never have i ever', () => {
  it('parses default rules', () => {
    expect(rules()).toEqual({ sips: 1, maxSpice: 2, rounds: 0 });
    expect(rulesSchema.safeParse({ maxSpice: 4 }).success).toBe(false);
    expect(nhie.meta.needsContent).toBe(true);
  });

  it('filters prompts by max spice and draws the first one', () => {
    const s = nhie.setup(rules({ maxSpice: 1 }), ctx(), { prompts: spread });
    expect(
      held(s)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['s0a', 's0b', 's1']);
    expect(s.current).not.toBeNull();
    expect(s.round).toBe(1);
    expect(s.reader).toBe(0);
    expect(nhie.activeActor(s)).toBe('p1');
    expect(held(nhie.setup(rules({ maxSpice: 3 }), ctx(), { prompts: spread }))).toHaveLength(5);
    expect(held(nhie.setup(rules({ maxSpice: 0 }), ctx(), { prompts: spread }))).toHaveLength(2);
  });

  it('shuffles deterministically from the seed', () => {
    const many = Array.from({ length: 20 }, (_, i) => prompt(`p${i}`));
    const a = nhie.setup(rules(), ctx(5), { prompts: many });
    const b = nhie.setup(rules(), ctx(5), { prompts: many });
    expect(held(a)).toEqual(held(b));
    expect(held(a).map((p) => p.id)).not.toEqual(many.map((p) => p.id).reverse());
  });

  it('is over immediately with no content (or nothing under the spice cap)', () => {
    for (const content of [{}, { prompts: [] }, { prompts: [prompt('hot', 3)] }]) {
      const s = nhie.setup(rules(), ctx(), content);
      expect(s.current).toBeNull();
      expect(s.round).toBe(0);
      expect(nhie.isOver(s)).toBe(true);
      expect(nhie.activeActor(s)).toBeNull();
    }
    const session = startSession(nhie, {
      rules: {},
      players: players('Ana', 'Ben'),
      intensity: intensity(),
      seed: 1,
    });
    expect(session.over).toBe(true);
  });

  it('picks a deterministic {random} target that is seated and not the reader', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const items = [
          prompt('r', 1, { text: 'Never have I ever crushed on the sibling of {random}' }),
        ];
        const a = nhie.setup(rules(), ctx(seed), { prompts: items });
        const b = nhie.setup(rules(), ctx(seed), { prompts: items });
        expect(a.current?.targets).toEqual(b.current?.targets);
        expect(['p2', 'p3']).toContain(a.current?.targets.random);
      }),
    );
  });

  it('detects {random} in alt texts and skips it otherwise', () => {
    const alt = prompt('alt', 0, { alt: { en: 'Never have I ever texted {random}' } });
    expect(nhie.setup(rules(), ctx(), { prompts: [alt] }).current?.targets.random).toBeDefined();
    expect(nhie.setup(rules(), ctx(), { prompts: [prompt('plain')] }).current?.targets).toEqual({});
    // A solo table can only pick the reader.
    expect(nhie.setup(rules(), ctx(1, ['Solo']), { prompts: [alt] }).current?.targets.random).toBe(
      'p1',
    );
  });

  it('NEXT makes everyone who did it drink, rotates the reader and draws', () => {
    const s0 = nhie.setup(rules({ sips: 2 }), ctx(), { prompts: spread });
    const { state, effects } = nhie.reduce(s0, next(['p1', 'p3']), ctx(), rules({ sips: 2 }));
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p1', 'p3'],
        amount: 2,
        kind: 'drink',
        reason: { key: 'nhie.reason.did' },
      },
      { type: 'passTo', player: 'p2', private: false },
    ]);
    expect(state.reader).toBe(1);
    expect(state.round).toBe(2);
    expect(state.current?.item.id).not.toBe(s0.current?.item.id);
    expect(state.deck).toHaveLength(s0.deck.length - 1);
  });

  it('nobody did it: no drink, still moves on', () => {
    const s0 = nhie.setup(rules(), ctx(), { prompts: spread });
    const { effects } = nhie.reduce(s0, next(), ctx(), rules());
    expect(effects.map((e) => e.type)).toEqual(['passTo']);
  });

  it('a prompt’s own sips override the rule', () => {
    const drinksFor = (item: PromptItem) =>
      nhie
        .reduce(nhie.setup(rules(), ctx(), { prompts: [item] }), next(['p2']), ctx(), rules())
        .effects.filter((e) => e.type === 'drink');
    expect(drinksFor(prompt('big', 1, { sips: 3 }))).toMatchObject([{ to: ['p2'], amount: 3 }]);
    expect(drinksFor(prompt('zero', 1, { sips: 0 }))).toEqual([]);
  });

  it('ends when the deck runs out', () => {
    let s = nhie.setup(rules(), ctx(), { prompts: [prompt('a'), prompt('b')] });
    s = nhie.reduce(s, next(), ctx(), rules()).state;
    expect(nhie.isOver(s)).toBe(false);
    const last = nhie.reduce(s, next(['p1']), ctx(), rules());
    expect(nhie.isOver(last.state)).toBe(true);
    expect(last.effects.map((e) => e.type)).toEqual(['drink']);
    expect(nhie.validate(last.state, next(), 'host', rules())).toBe('error.gameOver');
  });

  it('ends at the rounds limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => prompt(`p${i}`));
    let s = nhie.setup(rules({ rounds: 3 }), ctx(), { prompts: many });
    const r = rules({ rounds: 3 });
    for (let i = 0; i < 2; i++) s = nhie.reduce(s, next(), ctx(), r).state;
    expect(s.round).toBe(3);
    expect(nhie.isOver(s)).toBe(false);
    s = nhie.reduce(s, next(), ctx(), r).state;
    expect(nhie.isOver(s)).toBe(true);
    expect(s.round).toBe(3);
  });

  it('validates NEXT', () => {
    const s = nhie.setup(rules(), ctx(), { prompts: spread });
    const v = (a: Action, actor = 'host') => nhie.validate(s, a, actor, rules());
    expect(v(next(['p1', 'p2']))).toBeNull();
    expect(v(next(['p1', 'zz']))).toBe('nhie.error.badPlayer');
    expect(v(next(['p2', 'p2']))).toBe('nhie.error.duplicate');
    expect(v(next(), 'p2')).toBe('error.notYourTurn');
    expect(v(next(), 'p1')).toBeNull();
    expect(nhie.actionSchema.safeParse({ type: 'NEXT' }).success).toBe(false);
  });

  it('project hides the deck', () => {
    const s = nhie.setup(rules(), ctx(), { prompts: spread });
    const view = nhie.project(s, 'table') as Record<string, unknown>;
    expect(view.deck).toBeUndefined();
    expect(view.remaining).toBe(s.deck.length);
    expect(view.current).toEqual(s.current);
  });

  it('plays every prompt exactly once through the session', () => {
    const many = Array.from({ length: 12 }, (_, i) => prompt(`p${i}`, i % 3));
    let session = startSession(nhie, {
      rules: {},
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 3,
      content: { prompts: many },
    });
    const seen: string[] = [];
    for (let i = 0; i < 50 && !session.over; i++) {
      seen.push((session.game as State).current?.item.id ?? '');
      const step = sessionReducer(nhie, session, { type: 'GAME', action: next(['p2']) });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect(seen.sort()).toEqual(
      many
        .filter((p) => p.spice <= 2)
        .map((p) => p.id)
        .sort(),
    );
    expect(session.drinks).toHaveLength(seen.length);
  });
});
