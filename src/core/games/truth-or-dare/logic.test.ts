import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import type { PromptItem } from '../../content/schemas';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect } from '../../engine/types';
import { intensity, players } from '../../test/fixtures';
import {
  rulesSchema,
  truthOrDare as tod,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';
import { buildDecks, drawPrompt, kindOf, type Kind } from './prompts';

const rules = (patch: Partial<Rules> = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy');
const ctx = (seed = 1) => ({ players: PLAYERS, rng: createRng(seed) });
type Step = { state: State; effects: Effect[] };

const item = (id: string, kind: PromptItem['kind'], spice = 0, patch: Partial<PromptItem> = {}) =>
  ({ id, text: `${kind ?? 'q'} ${id}`, kind, spice, ...patch }) as PromptItem;
const truths = (n: number, spice = 0) =>
  Array.from({ length: n }, (_, i) => item(`t${i}`, 'truth', spice));
const dares = (n: number, spice = 0) =>
  Array.from({ length: n }, (_, i) => item(`d${i}`, 'dare', spice));
const POOL = [...truths(3), ...dares(3), item('hot', 'dare', 3)];

const act = (s: State, a: Action, r: Rules = rules(), actor: Actor = 'host', seed = 1): Step => {
  expect(tod.validate(s, a, actor, r)).toBeNull();
  return tod.reduce(s, a, ctx(seed), r);
};
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');
const choose = (kind: Kind): Action => ({ type: 'CHOOSE', kind });

describe('truth or dare rules', () => {
  it('parses defaults and bounds', () => {
    expect(rules()).toEqual({ choice: 'player', refuseSips: 2, maxSpice: 1, rounds: 0 });
    expect(rulesSchema.safeParse({ refuseSips: 0 }).success).toBe(false);
    expect(rulesSchema.safeParse({ refuseSips: 6 }).success).toBe(false);
    expect(rulesSchema.safeParse({ rounds: 201 }).success).toBe(false);
    expect(rulesSchema.safeParse({ choice: 'coin' }).success).toBe(false);
    expect(tod.meta.needsContent).toBe(true);
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.tod.${key}`);
      expect(field.default).toBeDefined();
    }
  });

  it('rejects malformed actions at the schema', () => {
    expect(tod.actionSchema.safeParse({ type: 'CHOOSE', kind: 'both' }).success).toBe(false);
    expect(tod.actionSchema.safeParse({ type: 'SETTLED' }).success).toBe(false);
    expect(tod.actionSchema.safeParse({ type: 'SETTLED', wheelId: -1 }).success).toBe(false);
  });
});

describe('truth/dare decks', () => {
  it('splits by kind (unmarked items are questions) and filters by spice', () => {
    const d = buildDecks([...POOL, item('plain', undefined), item('p', 'prompt')], 1, createRng(1));
    expect(d.truth.map((p) => p.id).sort()).toEqual(['p', 'plain', 't0', 't1', 't2']);
    expect(d.dare.map((p) => p.id).sort()).toEqual(['d0', 'd1', 'd2']);
    expect(d.idx).toEqual({ truth: 0, dare: 0 });
    expect(kindOf(item('x', undefined))).toBe('truth');
  });

  it('falls back to the other kind, and returns null only for an empty pool', () => {
    const onlyTruths = buildDecks(truths(2), 3, createRng(1));
    const { prompt } = drawPrompt(onlyTruths, 'dare', ['p1', 'p2'], 0, createRng(1));
    expect(prompt).toMatchObject({ kind: 'truth', asked: 'dare', targets: { player: 'p1' } });
    const empty = buildDecks([], 3, createRng(1));
    expect(drawPrompt(empty, 'truth', ['p1'], 0, createRng(1))).toEqual({
      decks: empty,
      prompt: null,
    });
  });

  it('plays each prompt once per cycle and never repeats across a reshuffle', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 8 }), (seed, n) => {
        const rng = createRng(seed);
        let decks = buildDecks(truths(n), 3, rng);
        const seen: string[] = [];
        for (let i = 0; i < n * 4; i++) {
          const out = drawPrompt(decks, 'truth', ['p1', 'p2'], 0, rng);
          decks = out.decks;
          seen.push(out.prompt?.item.id ?? '');
        }
        for (let c = 0; c < 4; c++) {
          expect(seen.slice(c * n, (c + 1) * n).sort()).toEqual(
            truths(n)
              .map((p) => p.id)
              .sort(),
          );
        }
        if (n > 1) for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
      }),
      { numRuns: 200 },
    );
  });

  it('fixes {random} to someone other than the player (alt texts count)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 0, max: 3 }), (seed, subject) => {
        const order = ['p1', 'p2', 'p3', 'p4'];
        const items = [
          item('r', 'dare', 0, { text: 'Give {random} a high five' }),
          item('a', 'truth', 0, { alt: { en: 'What do you think of {random}?' } }),
        ];
        const decks = buildDecks(items, 3, createRng(seed));
        for (const kind of ['truth', 'dare'] as const) {
          const { prompt } = drawPrompt(decks, kind, order, subject, createRng(seed));
          expect(prompt?.targets.player).toBe(order[subject]);
          expect(order).toContain(prompt?.targets.random);
          expect(prompt?.targets.random).not.toBe(order[subject]);
        }
      }),
    );
    const plain = buildDecks([item('x', 'truth')], 3, createRng(1));
    expect(drawPrompt(plain, 'truth', ['p1', 'p2'], 1, createRng(1)).prompt?.targets).toEqual({
      player: 'p2',
    });
  });
});

describe('truth or dare: player mode', () => {
  it('starts in choose with the first seat, nothing drawn yet', () => {
    const s = tod.setup(rules(), ctx(), { prompts: POOL });
    expect(s).toMatchObject({ turn: 0, round: 1, phase: 'choose', prompt: null, wheel: null });
    expect(s.decks.dare).toHaveLength(3); // the spice-3 dare is filtered out
    expect(tod.activeActor(s)).toBe('p1');
    expect(tod.isOver(s)).toBe(false);
  });

  it('is over immediately with no content', () => {
    for (const content of [{}, { prompts: [] }, { prompts: [item('hot', 'dare', 3)] }]) {
      const s = tod.setup(rules(), ctx(), content);
      expect(s.phase).toBe('over');
      expect(s.round).toBe(0);
      expect(tod.isOver(s)).toBe(true);
      expect(tod.activeActor(s)).toBeNull();
      expect(tod.validate(s, choose('truth'), 'host', rules())).toBe('error.gameOver');
    }
  });

  it('CHOOSE draws a prompt of that kind for the current player', () => {
    const s0 = tod.setup(rules(), ctx(), { prompts: POOL });
    const { state, effects } = act(s0, choose('dare'));
    expect(state.phase).toBe('prompt');
    expect(state.prompt).toMatchObject({ kind: 'dare', asked: 'dare', targets: { player: 'p1' } });
    expect(state.decks.idx).toEqual({ truth: 0, dare: 1 });
    expect(effects).toEqual([]);
  });

  it('CHOOSE falls back to the other kind with a notice', () => {
    const s0 = tod.setup(rules(), ctx(), { prompts: truths(2) });
    const { state, effects } = act(s0, choose('dare'));
    expect(state.prompt).toMatchObject({ kind: 'truth', asked: 'dare' });
    expect(effects).toEqual([{ type: 'notice', msg: { key: 'tod.notice.onlyTruths' } }]);
    const d0 = tod.setup(rules(), ctx(), { prompts: dares(2) });
    expect(act(d0, choose('truth')).effects).toEqual([
      { type: 'notice', msg: { key: 'tod.notice.onlyDares' } },
    ]);
  });

  it('DONE passes the turn without a drink', () => {
    const s1 = act(tod.setup(rules(), ctx(), { prompts: POOL }), choose('truth')).state;
    const { state, effects } = act(s1, { type: 'DONE' });
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);
    expect(state).toMatchObject({ turn: 1, round: 2, phase: 'choose', prompt: null });
    expect(state.last).toEqual({ player: 'p1', kind: 'truth', outcome: 'done' });
  });

  it('REFUSE costs refuseSips (or the prompt’s own sips) and passes the turn', () => {
    const r = rules({ refuseSips: 3 });
    const s1 = act(tod.setup(r, ctx(), { prompts: POOL }), choose('dare'), r).state;
    const { state, effects } = act(s1, { type: 'REFUSE' }, r);
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p1'],
        amount: 3,
        kind: 'drink',
        reason: { key: 'tod.reason.refused' },
      },
      { type: 'passTo', player: 'p2', private: false },
    ]);
    expect(state.last).toEqual({ player: 'p1', kind: 'dare', outcome: 'refused' });

    const own = (sips: number) => {
      const s = tod.setup(r, ctx(), { prompts: [item('x', 'dare', 0, { sips })] });
      return drinks(act(act(s, choose('dare'), r).state, { type: 'REFUSE' }, r).effects);
    };
    expect(own(5)).toMatchObject([{ amount: 5 }]);
    expect(own(0)).toEqual([]);
  });

  it('rotates around the table and wraps', () => {
    let s = tod.setup(rules(), ctx(), { prompts: POOL });
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(tod.activeActor(s) as string);
      s = act(act(s, choose('truth')).state, { type: 'DONE' }).state;
    }
    expect(seen).toEqual(['p1', 'p2', 'p3', 'p1']);
    expect(s.round).toBe(5);
  });

  it('ends after the rounds limit', () => {
    const r = rules({ rounds: 2 });
    let s = tod.setup(r, ctx(), { prompts: POOL });
    s = act(act(s, choose('truth'), r).state, { type: 'DONE' }, r).state;
    expect(tod.isOver(s)).toBe(false);
    const end = act(act(s, choose('dare'), r).state, { type: 'REFUSE' }, r);
    expect(tod.isOver(end.state)).toBe(true);
    expect(end.state.round).toBe(2);
    expect(end.effects.map((e) => e.type)).toEqual(['drink']);
    expect(tod.activeActor(end.state)).toBeNull();
  });

  it('validates phase, mode and turn ownership', () => {
    const r = rules();
    const s0 = tod.setup(r, ctx(), { prompts: POOL });
    const v = (s: State, a: Action, actor: Actor = 'host', rr = r) => tod.validate(s, a, actor, rr);
    expect(v(s0, { type: 'DONE' })).toBe('tod.error.noPrompt');
    expect(v(s0, { type: 'REFUSE' })).toBe('tod.error.noPrompt');
    expect(v(s0, { type: 'SPIN_WHEEL' })).toBe('tod.error.playerMode');
    expect(v(s0, { type: 'SETTLED', wheelId: 1 })).toBe('tod.error.staleWheel');
    expect(v(s0, choose('truth'), 'p2')).toBe('error.notYourTurn');
    expect(v(s0, choose('truth'), 'p1')).toBeNull();
    const s1 = act(s0, choose('truth'), r, 'p1').state;
    expect(v(s1, choose('dare'))).toBe('tod.error.notChoosing');
    expect(v(s1, { type: 'DONE' }, 'p3')).toBe('error.notYourTurn');
    expect(v(s1, { type: 'DONE' }, 'p1')).toBeNull();
    expect(v(s0, choose('truth'), 'host', rules({ choice: 'wheel' }))).toBe('tod.error.wheelMode');
  });

  it('project hides the decks', () => {
    const s = act(tod.setup(rules(), ctx(), { prompts: POOL }), choose('truth')).state;
    const view = tod.project(s, 'table') as View & Record<string, unknown>;
    expect(view.decks).toBeUndefined();
    expect(view.pool).toEqual({ truth: 3, dare: 3 });
    expect(view.player).toBe('p1');
    expect(view.prompt).toEqual(s.prompt);
    // No dare was drawn, so no dare id may appear anywhere in the view.
    for (const d of s.decks.dare) expect(JSON.stringify(view)).not.toContain(`"${d.id}"`);
  });
});

describe('truth or dare: wheel mode', () => {
  const r = rules({ choice: 'wheel' });

  it('SPIN_WHEEL decides the kind up front; SETTLED draws it', () => {
    const s0 = tod.setup(r, ctx(), { prompts: POOL });
    const spun = act(s0, { type: 'SPIN_WHEEL' }, r);
    expect(spun.effects).toEqual([]);
    const wheel = spun.state.wheel;
    expect(wheel).toMatchObject({ id: 1, settled: false });
    expect(['truth', 'dare']).toContain(wheel?.kind);
    expect(spun.state.phase).toBe('choose');
    expect(tod.validate(spun.state, { type: 'SPIN_WHEEL' }, 'host', r)).toBe('tod.error.spinning');
    expect(tod.validate(spun.state, { type: 'SETTLED', wheelId: 2 }, 'host', r)).toBe(
      'tod.error.staleWheel',
    );
    expect(tod.validate(spun.state, { type: 'SETTLED', wheelId: 1 }, 'p2', r)).toBe(
      'error.notYourTurn',
    );
    const settled = act(spun.state, { type: 'SETTLED', wheelId: 1 }, r, 'p1').state;
    expect(settled.wheel).toEqual({ ...wheel, settled: true });
    expect(settled.phase).toBe('prompt');
    expect(settled.prompt?.kind).toBe(wheel?.kind);
    expect(tod.validate(settled, { type: 'SETTLED', wheelId: 1 }, 'host', r)).toBe(
      'tod.error.staleWheel',
    );
    // The next player's spin gets a new id.
    const next = act(settled, { type: 'DONE' }, r).state;
    expect(next.wheel?.settled).toBe(true);
    expect(act(next, { type: 'SPIN_WHEEL' }, r).state.wheel?.id).toBe(2);
  });

  it('the wheel only lands on kinds the pool has, and lands on both over time', () => {
    const only = tod.setup(r, ctx(), { prompts: dares(2) });
    for (let seed = 0; seed < 30; seed++) {
      expect(act(only, { type: 'SPIN_WHEEL' }, r, 'host', seed).state.wheel?.kind).toBe('dare');
    }
    const both = tod.setup(r, ctx(), { prompts: POOL });
    const kinds = new Set(
      Array.from(
        { length: 40 },
        (_, seed) => act(both, { type: 'SPIN_WHEEL' }, r, 'host', seed).state.wheel?.kind,
      ),
    );
    expect(kinds).toEqual(new Set(['truth', 'dare']));
  });

  it('player-mode actions are rejected', () => {
    const s0 = tod.setup(r, ctx(), { prompts: POOL });
    expect(tod.validate(s0, choose('dare'), 'host', r)).toBe('tod.error.wheelMode');
  });
});

describe('truth or dare properties', () => {
  /** A legal action for the current state, steered by `choice`. */
  function pick(s: State, r: Rules, choice: number): Action {
    if (s.phase === 'prompt') return { type: choice % 3 === 0 ? 'REFUSE' : 'DONE' };
    if (r.choice === 'player') return choose(choice % 2 ? 'truth' : 'dare');
    if (s.wheel && !s.wheel.settled) return { type: 'SETTLED', wheelId: s.wheel.id };
    return { type: 'SPIN_WHEEL' };
  }

  it('turns rotate, only the current player ever drinks, and refusals cost the right sips', () => {
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer(),
          n: fc.integer({ min: 2, max: 6 }),
          wheel: fc.boolean(),
          refuseSips: fc.integer({ min: 1, max: 5 }),
          nt: fc.integer({ min: 0, max: 4 }),
          nd: fc.integer({ min: 0, max: 4 }),
          choices: fc.array(fc.nat(100), { minLength: 1, maxLength: 40 }),
        }),
        (g) => {
          fc.pre(g.nt + g.nd > 0);
          const r = rules({ choice: g.wheel ? 'wheel' : 'player', refuseSips: g.refuseSips });
          const c = {
            players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
            rng: createRng(g.seed),
          };
          let s = tod.setup(r, c, { prompts: [...truths(g.nt), ...dares(g.nd)] });
          for (let step = 0; step < 60; step++) {
            const player = tod.activeActor(s);
            const a = pick(s, r, g.choices[step % g.choices.length] as number);
            expect(tod.validate(s, a, 'host', r)).toBeNull();
            const out = tod.reduce(s, a, c, r);
            for (const d of drinks(out.effects)) {
              expect(a.type).toBe('REFUSE');
              expect(d).toMatchObject({ to: [player], amount: g.refuseSips });
            }
            if (a.type === 'DONE' || a.type === 'REFUSE') {
              expect(out.state.turn).toBe((s.turn + 1) % g.n);
              expect(out.state.round).toBe(s.round + 1);
            } else {
              expect(out.state.turn).toBe(s.turn);
            }
            if (out.state.prompt) {
              expect(out.state.prompt.targets.player).toBe(player);
              expect(out.state.prompt.item.id[0]).toBe(out.state.prompt.kind[0]);
            }
            s = out.state;
          }
          expect(tod.isOver(s)).toBe(false);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('runs through the session reducer to the rounds limit', () => {
    let session = startSession(tod, {
      rules: { rounds: 6, choice: 'wheel' },
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 4,
      content: { prompts: POOL },
    });
    for (let i = 0; i < 100 && !session.over; i++) {
      const action = pick(session.game as State, session.rules as Rules, i);
      const step = sessionReducer(tod, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect((session.game as State).round).toBe(6);
  });
});
