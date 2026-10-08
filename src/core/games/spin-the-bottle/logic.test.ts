import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import type { PromptItem } from '../../content/schemas';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect, Player } from '../../engine/types';
import { intensity, players } from '../../test/fixtures';
import {
  candidates,
  rulesSchema,
  spinTheBottle as stb,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: Partial<Rules> = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy', 'Dee');
const ctx = (seed = 1, roster: Player[] = PLAYERS) => ({ players: roster, rng: createRng(seed) });
type Step = { state: State; effects: Effect[] };

const item = (id: string, kind: 'truth' | 'dare', spice = 0): PromptItem => ({
  id,
  text: `${kind} ${id}`,
  kind,
  spice,
});
const POOL = [item('t1', 'truth'), item('t2', 'truth'), item('d1', 'dare'), item('d2', 'dare', 2)];

const act = (s: State, a: Action, r: Rules = rules(), actor: Actor = 'host', seed = 1): Step => {
  expect(stb.validate(s, a, actor, r)).toBeNull();
  return stb.reduce(s, a, ctx(seed), r);
};
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');

/** SPIN then SETTLED. */
const spinAndSettle = (s: State, r: Rules = rules(), seed = 1) => {
  const spun = act(s, { type: 'SPIN', power: 0.7 }, r, 'host', seed).state;
  return act(spun, { type: 'SETTLED', spinId: spun.spin?.id ?? 0 }, r, 'host', seed);
};

describe('spin the bottle rules', () => {
  it('parses defaults and bounds', () => {
    expect(rules()).toEqual({
      outcome: 'truthOrDare',
      sips: 1,
      allowSelf: false,
      nextSpinner: 'picked',
      maxSpice: 1,
    });
    expect(rulesSchema.safeParse({ sips: 6 }).success).toBe(false);
    expect(rulesSchema.safeParse({ outcome: 'kiss' }).success).toBe(false);
    expect(rulesSchema.safeParse({ maxSpice: 4 }).success).toBe(false);
    expect(stb.meta).toMatchObject({ family: 'party', hiddenInfo: false });
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.stb.${key}`);
      expect(field.default).toBeDefined();
    }
  });

  it('rejects malformed actions at the schema', () => {
    expect(stb.actionSchema.safeParse({ type: 'SPIN' }).success).toBe(false);
    expect(stb.actionSchema.safeParse({ type: 'SPIN', power: Infinity }).success).toBe(false);
    expect(stb.actionSchema.safeParse({ type: 'SPIN', power: Number.NaN }).success).toBe(false);
    expect(stb.actionSchema.safeParse({ type: 'SETTLED', spinId: 1.5 }).success).toBe(false);
    expect(stb.actionSchema.safeParse({ type: 'CHOOSE', kind: 'kiss' }).success).toBe(false);
  });
});

describe('spinning', () => {
  it('starts with the first seat holding the bottle', () => {
    const s = stb.setup(rules(), ctx(), {});
    expect(s).toMatchObject({ spinner: 0, round: 1, phase: 'spin', spin: null, prompt: null });
    expect(stb.activeActor(s)).toBe('p1');
    expect(stb.isOver(s)).toBe(false);
  });

  it('SPIN decides the target up front, clamps power and keeps the phase', () => {
    const s0 = stb.setup(rules(), ctx(), {});
    const { state, effects } = act(s0, { type: 'SPIN', power: 3 });
    expect(effects).toEqual([]);
    expect(state.phase).toBe('spin');
    expect(state.spin).toMatchObject({ id: 1, spinner: 'p1', power: 1, settled: false });
    expect(['p2', 'p3', 'p4']).toContain(state.spin?.target);
    expect(state.spin?.extraTurns).toBeGreaterThanOrEqual(2);
    expect(state.spin?.extraTurns).toBeLessThanOrEqual(4);
    expect(act(s0, { type: 'SPIN', power: -2 }).state.spin?.power).toBe(0);
    expect(act(s0, { type: 'SPIN', power: 0.25 }).state.spin?.power).toBe(0.25);
  });

  it('is deterministic for a seed and spreads over every other seat', () => {
    const s0 = stb.setup(rules(), ctx(), {});
    const a = act(s0, { type: 'SPIN', power: 0.5 }, rules(), 'host', 9).state.spin;
    const b = act(s0, { type: 'SPIN', power: 0.5 }, rules(), 'host', 9).state.spin;
    expect(a).toEqual(b);
    const hits = new Set(
      Array.from(
        { length: 60 },
        (_, seed) =>
          act(s0, { type: 'SPIN', power: 0.5 }, rules(), 'host', seed).state.spin?.target,
      ),
    );
    expect(hits).toEqual(new Set(['p2', 'p3', 'p4']));
    const self = new Set(
      Array.from(
        { length: 80 },
        (_, seed) =>
          act(s0, { type: 'SPIN', power: 0.5 }, rules({ allowSelf: true }), 'host', seed).state.spin
            ?.target,
      ),
    );
    expect(self).toEqual(new Set(['p1', 'p2', 'p3', 'p4']));
  });

  it('skips players sitting out (unless nobody else is left)', () => {
    const s0 = stb.setup(rules(), ctx(), {});
    const roster = PLAYERS.map((p) =>
      p.id === 'p2' || p.id === 'p3' ? { ...p, sittingOut: true } : p,
    );
    expect(candidates(s0, ctx(1, roster), rules())).toEqual(['p4']);
    const allOut = PLAYERS.map((p) => (p.id === 'p1' ? p : { ...p, sittingOut: true }));
    expect(candidates(s0, ctx(1, allOut), rules())).toEqual(['p2', 'p3', 'p4']);
  });

  it('validates SPIN and SETTLED', () => {
    const r = rules();
    const s0 = stb.setup(r, ctx(), {});
    expect(stb.validate(s0, { type: 'SPIN', power: 1 }, 'p2', r)).toBe('error.notYourTurn');
    expect(stb.validate(s0, { type: 'SETTLED', spinId: 0 }, 'host', r)).toBe('stb.error.staleSpin');
    const spun = act(s0, { type: 'SPIN', power: 1 }, r, 'p1').state;
    expect(stb.validate(spun, { type: 'SPIN', power: 1 }, 'host', r)).toBe('stb.error.spinning');
    expect(stb.validate(spun, { type: 'SETTLED', spinId: 2 }, 'host', r)).toBe(
      'stb.error.staleSpin',
    );
    expect(stb.validate(spun, { type: 'SETTLED', spinId: 1 }, 'p3', r)).toBe('error.notYourTurn');
    expect(stb.validate(spun, { type: 'SETTLED', spinId: 1 }, 'p1', r)).toBeNull();
    expect(stb.validate(spun, { type: 'NEXT' }, 'host', r)).toBe('stb.error.notResolved');
    expect(stb.validate(spun, { type: 'CHOOSE', kind: 'truth' }, 'host', r)).toBe(
      'stb.error.notChoosing',
    );
    expect(stb.validate(spun, { type: 'DONE' }, 'host', r)).toBe('stb.error.noTask');
  });

  it('needs at least two seats', () => {
    const s = stb.setup(rules(), ctx(1, players('Solo')), {});
    expect(stb.isOver(s)).toBe(true);
    expect(stb.activeActor(s)).toBeNull();
    expect(stb.validate(s, { type: 'SPIN', power: 1 }, 'host', rules())).toBe('error.noPlayers');
  });
});

describe('outcomes', () => {
  it('drink: the target drinks on SETTLED and the round is resolved', () => {
    const r = rules({ outcome: 'drink', sips: 3 });
    const { state, effects } = spinAndSettle(stb.setup(r, ctx(), {}), r);
    const target = state.spin?.target as string;
    expect(state.spin?.settled).toBe(true);
    expect(state).toMatchObject({ phase: 'resolved', result: 'drank' });
    expect(effects).toEqual([
      {
        type: 'notice',
        msg: {
          key: 'stb.notice.picked',
          params: { name: PLAYERS.find((p) => p.id === target)?.name },
        },
      },
      {
        type: 'drink',
        to: [target],
        amount: 3,
        kind: 'drink',
        reason: { key: 'stb.reason.picked' },
      },
    ]);
    expect(stb.activeActor(state)).toBe('any');
  });

  it('free: the app just shows the pick', () => {
    const r = rules({ outcome: 'free' });
    const { state, effects } = spinAndSettle(stb.setup(r, ctx(), {}), r);
    expect(state).toMatchObject({ phase: 'resolved', result: 'free', prompt: null });
    expect(effects.map((e) => e.type)).toEqual(['notice']);
  });

  it('truthOrDare: the target chooses and gets a prompt', () => {
    const r = rules();
    const settled = spinAndSettle(stb.setup(r, ctx(), { prompts: POOL }), r);
    const target = settled.state.spin?.target as string;
    expect(settled.state.phase).toBe('choose');
    expect(settled.effects).toContainEqual({ type: 'passTo', player: target, private: false });
    expect(stb.activeActor(settled.state)).toBe(target);
    expect(stb.validate(settled.state, { type: 'CHOOSE', kind: 'dare' }, 'p1', r)).toBe(
      target === 'p1' ? null : 'error.notYourTurn',
    );

    const chosen = act(settled.state, { type: 'CHOOSE', kind: 'dare' }, r, target);
    expect(chosen.state.phase).toBe('prompt');
    expect(chosen.state.chosen).toBe('dare');
    // d2 is spice 2, above the default maxSpice.
    expect(chosen.state.prompt).toMatchObject({
      item: { id: 'd1' },
      kind: 'dare',
      targets: { player: target },
    });
    expect(chosen.effects).toEqual([]);

    const done = act(chosen.state, { type: 'DONE' }, r, target);
    expect(done.state).toMatchObject({ phase: 'resolved', result: 'done' });
    expect(done.effects).toEqual([]);
  });

  it('truthOrDare: CHOOSE falls back to the other kind, or lets the table make one up', () => {
    const r = rules();
    const truthsOnly = spinAndSettle(stb.setup(r, ctx(), { prompts: POOL.slice(0, 2) }), r).state;
    const fb = act(truthsOnly, { type: 'CHOOSE', kind: 'dare' }, r);
    expect(fb.state.prompt).toMatchObject({ kind: 'truth', asked: 'dare' });
    expect(fb.effects).toEqual([{ type: 'notice', msg: { key: 'stb.notice.onlyTruths' } }]);

    const none = spinAndSettle(stb.setup(r, ctx(), {}), r).state;
    const free = act(none, { type: 'CHOOSE', kind: 'dare' }, r);
    expect(free.state).toMatchObject({ phase: 'prompt', prompt: null, chosen: 'dare' });
    expect(act(free.state, { type: 'DONE' }, r).state.result).toBe('done');
  });

  it('REFUSE costs sips + 1', () => {
    const r = rules({ sips: 2 });
    const settled = spinAndSettle(stb.setup(r, ctx(), { prompts: POOL }), r).state;
    const target = settled.spin?.target;
    const chosen = act(settled, { type: 'CHOOSE', kind: 'truth' }, r).state;
    const { state, effects } = act(chosen, { type: 'REFUSE' }, r);
    expect(state).toMatchObject({ phase: 'resolved', result: 'refused' });
    expect(effects).toEqual([
      {
        type: 'drink',
        to: [target],
        amount: 3,
        kind: 'drink',
        reason: { key: 'stb.reason.refused' },
      },
    ]);
  });
});

describe('passing the bottle', () => {
  const resolved = (r: Rules, seed = 1) => spinAndSettle(stb.setup(r, ctx(), {}), r, seed).state;

  it('picked: whoever the bottle picked spins next', () => {
    const r = rules({ outcome: 'free' });
    const s = resolved(r);
    const target = s.spin?.target as string;
    const { state, effects } = act(s, { type: 'NEXT' }, r, 'p4');
    expect(state.spinner).toBe(s.order.indexOf(target));
    expect(state).toMatchObject({
      phase: 'spin',
      round: 2,
      prompt: null,
      chosen: null,
      result: null,
    });
    expect(state.spin?.settled).toBe(true);
    expect(effects).toEqual([{ type: 'passTo', player: target, private: false }]);
    expect(stb.activeActor(state)).toBe(target);
    expect(act(state, { type: 'SPIN', power: 0.5 }, r).state.spin?.id).toBe(2);
  });

  it('clockwise: the next seat spins', () => {
    const r = rules({ outcome: 'free', nextSpinner: 'clockwise' });
    let s = stb.setup(r, ctx(), {});
    const spinners: string[] = [];
    for (let i = 0; i < 5; i++) {
      spinners.push(stb.activeActor(s) as string);
      s = act(spinAndSettle(s, r, i).state, { type: 'NEXT' }, r).state;
    }
    expect(spinners).toEqual(['p1', 'p2', 'p3', 'p4', 'p1']);
  });

  it('a self-pick with allowSelf keeps the bottle (no pass)', () => {
    const r = rules({ outcome: 'free', allowSelf: true });
    for (let seed = 0; seed < 40; seed++) {
      const s = resolved(r, seed);
      if (s.spin?.target !== 'p1') continue;
      const { state, effects } = act(s, { type: 'NEXT' }, r);
      expect(state.spinner).toBe(0);
      expect(effects).toEqual([]);
      return;
    }
    throw new Error('no self-pick in 40 seeds');
  });

  it('NEXT is only legal once the round is resolved, for anyone at the table', () => {
    const r = rules();
    const settled = spinAndSettle(stb.setup(r, ctx(), { prompts: POOL }), r).state;
    expect(stb.validate(settled, { type: 'NEXT' }, 'host', r)).toBe('stb.error.notResolved');
    const chosen = act(settled, { type: 'CHOOSE', kind: 'truth' }, r).state;
    expect(stb.validate(chosen, { type: 'NEXT' }, 'host', r)).toBe('stb.error.notResolved');
    const done = act(chosen, { type: 'DONE' }, r).state;
    expect(stb.validate(done, { type: 'NEXT' }, 'stranger', r)).toBe('error.notYourTurn');
    expect(stb.validate(done, { type: 'NEXT' }, 'p3', r)).toBeNull();
    expect(stb.validate(done, { type: 'SPIN', power: 1 }, 'host', r)).toBe('stb.error.notResolved');
  });

  it('project hides the prompt decks', () => {
    const s = stb.setup(rules(), ctx(), { prompts: POOL });
    const view = stb.project(s, 'table') as View & Record<string, unknown>;
    expect(view.decks).toBeUndefined();
    expect(view.pool).toEqual({ truth: 2, dare: 1 });
    expect(view.current).toBe('p1');
  });
});

describe('spin the bottle properties', () => {
  function pick(s: State, choice: number): Action {
    switch (s.phase) {
      case 'spin':
        return s.spin && !s.spin.settled
          ? { type: 'SETTLED', spinId: s.spin.id }
          : { type: 'SPIN', power: (choice % 11) / 10 };
      case 'choose':
        return { type: 'CHOOSE', kind: choice % 2 ? 'truth' : 'dare' };
      case 'prompt':
        return { type: choice % 3 ? 'DONE' : 'REFUSE' };
      case 'resolved':
        return { type: 'NEXT' };
    }
  }

  it('targets are always seated and never the spinner unless allowSelf', () => {
    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer(),
          n: fc.integer({ min: 2, max: 8 }),
          outcome: fc.constantFrom('truthOrDare', 'drink', 'free' as const),
          allowSelf: fc.boolean(),
          nextSpinner: fc.constantFrom('picked', 'clockwise' as const),
          sips: fc.integer({ min: 1, max: 5 }),
          choices: fc.array(fc.nat(100), { minLength: 1, maxLength: 30 }),
        }),
        (g) => {
          const r = rules({
            outcome: g.outcome,
            allowSelf: g.allowSelf,
            nextSpinner: g.nextSpinner,
            sips: g.sips,
          });
          const c = {
            players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
            rng: createRng(g.seed),
          };
          let s = stb.setup(r, c, { prompts: POOL });
          for (let step = 0; step < 80; step++) {
            const a = pick(s, g.choices[step % g.choices.length] as number);
            expect(stb.validate(s, a, 'host', r)).toBeNull();
            const out = stb.reduce(s, a, c, r);
            if (a.type === 'SPIN') {
              const spin = out.state.spin;
              expect(s.order).toContain(spin?.target);
              expect(spin?.spinner).toBe(s.order[s.spinner]);
              if (!g.allowSelf) expect(spin?.target).not.toBe(spin?.spinner);
              expect(spin?.power).toBeGreaterThanOrEqual(0);
              expect(spin?.power).toBeLessThanOrEqual(1);
            }
            // Only the target ever drinks: sips on a drink outcome, sips + 1 on a refusal.
            for (const d of drinks(out.effects)) {
              expect(d.to).toEqual([s.spin?.target]);
              expect(d.amount).toBe(a.type === 'REFUSE' ? g.sips + 1 : g.sips);
            }
            if (a.type === 'NEXT' && g.nextSpinner === 'picked') {
              expect(out.state.order[out.state.spinner]).toBe(s.spin?.target);
            }
            s = out.state;
          }
          expect(stb.isOver(s)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('runs through the session reducer', () => {
    let session = startSession(stb, {
      rules: { outcome: 'truthOrDare' },
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 2,
      content: { prompts: POOL },
    });
    for (let i = 0; i < 40; i++) {
      const action = pick(session.game as State, i);
      const step = sessionReducer(stb, session, { type: 'GAME', action });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect((session.game as State).round).toBeGreaterThan(5);
  });
});
