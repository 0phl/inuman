import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { z } from 'zod';
import type { PromptItem } from '../../content/schemas';
import { createRng } from '../../engine/rng';
import { sessionReducer, startSession } from '../../engine/session';
import type { Actor, DrinkEffect, Effect, PlayerId } from '../../engine/types';
import { intensity, players } from '../../test/fixtures';
import {
  mostLikelyTo as mlt,
  rulesSchema,
  voterOf,
  type Action,
  type Rules,
  type State,
  type View,
} from './logic';

const rules = (patch: Partial<Rules> = {}): Rules => rulesSchema.parse(patch);
const PLAYERS = players('Ana', 'Ben', 'Cy', 'Dee');
const ctx = (seed = 1) => ({ players: PLAYERS, rng: createRng(seed) });
type Step = { state: State; effects: Effect[] };

const prompt = (id: string, spice = 0, patch: Partial<PromptItem> = {}): PromptItem => ({
  id,
  text: `Most likely to ${id}`,
  spice,
  ...patch,
});
const POOL = Array.from({ length: 8 }, (_, i) => prompt(`m${i}`, i % 3));
const SECRET = rules({ voting: 'secret' });

const act = (s: State, a: Action, r: Rules = rules(), actor: Actor = 'host'): Step => {
  expect(mlt.validate(s, a, actor, r)).toBeNull();
  return mlt.reduce(s, a, ctx(), r);
};
const drinks = (effects: Effect[]) => effects.filter((e): e is DrinkEffect => e.type === 'drink');
const vote = (id: PlayerId): Action => ({ type: 'VOTE', for: id });
const pickPlayers = (...ids: PlayerId[]): Action => ({ type: 'PICK', players: ids });

/** Casts `fors` in voting order. */
const voteAll = (s: State, fors: PlayerId[]): Step => {
  let step: Step = { state: s, effects: [] };
  for (const f of fors) step = act(step.state, vote(f), SECRET);
  return step;
};

describe('most likely to rules', () => {
  it('parses defaults and bounds', () => {
    expect(rules()).toEqual({ voting: 'point', sips: 1, maxSpice: 1, rounds: 0 });
    expect(rulesSchema.safeParse({ voting: 'loud' }).success).toBe(false);
    expect(rulesSchema.safeParse({ sips: 0 }).success).toBe(false);
    expect(mlt.meta).toMatchObject({ hiddenInfo: true, needsContent: true, min: 3 });
  });

  it('labels every field in the generated editor schema', () => {
    const json = z.toJSONSchema(rulesSchema, { io: 'input' }) as {
      properties: Record<string, { label?: string; default?: unknown }>;
    };
    for (const [key, field] of Object.entries(json.properties)) {
      expect(field.label).toBe(`rules.mlt.${key}`);
      expect(field.default).toBeDefined();
    }
  });

  it('rejects malformed actions at the schema', () => {
    expect(mlt.actionSchema.safeParse(pickPlayers()).success).toBe(false);
    expect(mlt.actionSchema.safeParse({ type: 'VOTE' }).success).toBe(false);
    expect(mlt.actionSchema.safeParse({ type: 'VOTE', for: '' }).success).toBe(false);
  });
});

describe('setup', () => {
  it('filters by spice, draws the first prompt and starts with the first reader', () => {
    const s = mlt.setup(rules(), ctx(), { prompts: POOL });
    const held = [s.prompt?.item, ...s.deck].map((p) => p?.id).sort();
    expect(held).toEqual(['m0', 'm1', 'm3', 'm4', 'm6', 'm7']);
    expect(s).toMatchObject({ reader: 0, round: 1, phase: 'read', cast: 0 });
    expect(mlt.activeActor(s)).toBe('p1');
    expect(mlt.setup(SECRET, ctx(), { prompts: POOL }).phase).toBe('vote');
  });

  it('is over immediately with no content', () => {
    for (const content of [{}, { prompts: [] }, { prompts: [prompt('hot', 3)] }]) {
      const s = mlt.setup(rules(), ctx(), content);
      expect(s.phase).toBe('over');
      expect(s.round).toBe(0);
      expect(mlt.isOver(s)).toBe(true);
      expect(mlt.activeActor(s)).toBeNull();
      expect(mlt.validate(s, { type: 'NEXT' }, 'host', rules())).toBe('error.gameOver');
    }
  });

  it('picks a {random} target other than the reader', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const items = [prompt('r', 0, { text: 'Most likely to marry {random}' })];
        const s = mlt.setup(
          rules(),
          { players: PLAYERS, rng: createRng(seed) },
          { prompts: items },
        );
        expect(['p2', 'p3', 'p4']).toContain(s.prompt?.targets.random);
      }),
    );
  });
});

describe('point mode', () => {
  it('PICK makes the picked players drink and moves on', () => {
    const r = rules({ sips: 2 });
    const s0 = mlt.setup(r, ctx(), { prompts: POOL });
    const { state, effects } = act(s0, pickPlayers('p2', 'p4'), r);
    expect(effects).toEqual([
      {
        type: 'drink',
        to: ['p2', 'p4'],
        amount: 2,
        kind: 'drink',
        reason: { key: 'mlt.reason.most' },
      },
      { type: 'passTo', player: 'p2', private: false },
    ]);
    expect(state).toMatchObject({ reader: 1, round: 2, phase: 'read' });
    expect(state.last).toEqual({
      round: 1,
      item: s0.prompt?.item,
      picked: ['p2', 'p4'],
      tally: null,
      votes: null,
    });
    expect(state.deck).toHaveLength(s0.deck.length - 1);
  });

  it('a prompt’s own sips override the rule', () => {
    const own = (sips: number) =>
      drinks(
        act(mlt.setup(rules(), ctx(), { prompts: [prompt('x', 0, { sips })] }), pickPlayers('p3'))
          .effects,
      );
    expect(own(4)).toMatchObject([{ to: ['p3'], amount: 4 }]);
    expect(own(0)).toEqual([]);
  });

  it('NEXT skips a prompt with no drinks', () => {
    const s0 = mlt.setup(rules(), ctx(), { prompts: POOL });
    const { state, effects } = act(s0, { type: 'NEXT' });
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: false }]);
    expect(state.last).toBeNull();
    expect(state.round).toBe(2);
  });

  it('validates PICK', () => {
    const r = rules();
    const s = mlt.setup(r, ctx(), { prompts: POOL });
    const v = (a: Action, actor: Actor = 'host') => mlt.validate(s, a, actor, r);
    expect(v(pickPlayers('p1', 'zz'))).toBe('mlt.error.badPlayer');
    expect(v(pickPlayers('p2', 'p2'))).toBe('mlt.error.duplicate');
    expect(v(pickPlayers('p2'), 'p2')).toBe('error.notYourTurn');
    expect(v(pickPlayers('p2'), 'p1')).toBeNull();
    expect(v(vote('p2'))).toBe('mlt.error.pointMode');
    expect(v({ type: 'NEXT' }, 'p3')).toBe('error.notYourTurn');
  });

  it('ends when the deck runs out, or at the rounds limit', () => {
    let s = mlt.setup(rules(), ctx(), { prompts: [prompt('a'), prompt('b')] });
    s = act(s, pickPlayers('p1')).state;
    const last = act(s, pickPlayers('p2'));
    expect(mlt.isOver(last.state)).toBe(true);
    expect(last.state.phase).toBe('over');
    expect(last.effects.map((e) => e.type)).toEqual(['drink']);

    const r = rules({ rounds: 2 });
    let t = mlt.setup(r, ctx(), { prompts: POOL });
    t = act(t, { type: 'NEXT' }, r).state;
    expect(mlt.isOver(t)).toBe(false);
    t = act(t, pickPlayers('p1'), r).state;
    expect(mlt.isOver(t)).toBe(true);
    expect(t.round).toBe(2);
  });
});

describe('secret mode', () => {
  it('voting goes around from the reader with private passes', () => {
    const s0 = mlt.setup(SECRET, ctx(), { prompts: POOL });
    expect(voterOf(s0)).toBe('p1');
    const one = act(s0, vote('p3'), SECRET, 'p1');
    expect(one.effects).toEqual([{ type: 'passTo', player: 'p2', private: true }]);
    expect(one.state.votes).toEqual(['p3', null, null, null]);
    expect(mlt.activeActor(one.state)).toBe('p2');
    // A remote seat may only cast its own vote when it's up.
    expect(mlt.validate(one.state, vote('p1'), 'p1', SECRET)).toBe('error.notYourTurn');
    expect(mlt.validate(one.state, vote('p1'), 'p3', SECRET)).toBe('error.notYourTurn');
    expect(mlt.validate(one.state, vote('p1'), 'p2', SECRET)).toBeNull();
    expect(mlt.validate(one.state, vote('zz'), 'host', SECRET)).toBe('mlt.error.badPlayer');
    expect(mlt.validate(one.state, pickPlayers('p1'), 'host', SECRET)).toBe('mlt.error.secretMode');
    expect(mlt.validate(one.state, { type: 'NEXT' }, 'host', SECRET)).toBe('mlt.error.voting');
  });

  it('the last vote reveals the tally and the top vote-getter drinks', () => {
    const s0 = mlt.setup(SECRET, ctx(), { prompts: POOL });
    const { state, effects } = voteAll(s0, ['p3', 'p3', 'p1', 'p3']);
    expect(state.phase).toBe('reveal');
    expect(state.last).toEqual({
      round: 1,
      item: s0.prompt?.item,
      picked: ['p3'],
      tally: [1, 0, 3, 0],
      votes: ['p3', 'p3', 'p1', 'p3'],
    });
    expect(effects).toEqual([
      { type: 'notice', msg: { key: 'mlt.notice.most', params: { names: 'Cy', votes: 3 } } },
      { type: 'drink', to: ['p3'], amount: 1, kind: 'drink', reason: { key: 'mlt.reason.most' } },
    ]);
    expect(mlt.activeActor(state)).toBe('any');
    expect(mlt.validate(state, vote('p1'), 'host', SECRET)).toBe('mlt.error.notVoting');
  });

  it('ties: everyone with the most votes drinks', () => {
    const s0 = mlt.setup(SECRET, ctx(), { prompts: POOL });
    const { state, effects } = voteAll(s0, ['p2', 'p4', 'p2', 'p4']);
    expect(state.last?.picked).toEqual(['p2', 'p4']);
    expect(drinks(effects)).toMatchObject([{ to: ['p2', 'p4'] }]);
    expect(effects[0]).toEqual({
      type: 'notice',
      msg: { key: 'mlt.notice.most', params: { names: 'Ben, Dee', votes: 2 } },
    });
  });

  it('NEXT after the reveal rotates the reader, who votes first', () => {
    const s0 = mlt.setup(SECRET, ctx(), { prompts: POOL });
    const revealed = voteAll(s0, ['p2', 'p2', 'p2', 'p2']).state;
    expect(mlt.validate(revealed, { type: 'NEXT' }, 'p4', SECRET)).toBeNull();
    expect(mlt.validate(revealed, { type: 'NEXT' }, 'stranger', SECRET)).toBe('error.notYourTurn');
    const { state, effects } = act(revealed, { type: 'NEXT' }, SECRET);
    expect(effects).toEqual([{ type: 'passTo', player: 'p2', private: true }]);
    expect(state).toMatchObject({ reader: 1, round: 2, phase: 'vote', cast: 0 });
    expect(state.votes).toEqual([null, null, null, null]);
    expect(voterOf(state)).toBe('p2');
    // The voting order wraps around the table.
    const order = voteAll(state, ['p1', 'p1', 'p1']).state;
    expect(voterOf(order)).toBe('p1');
  });

  it('a prompt can be skipped before anyone votes', () => {
    const s0 = mlt.setup(SECRET, ctx(), { prompts: POOL });
    expect(mlt.validate(s0, { type: 'NEXT' }, 'p2', SECRET)).toBe('error.notYourTurn');
    const { state } = act(s0, { type: 'NEXT' }, SECRET, 'p1');
    expect(state).toMatchObject({ reader: 1, round: 2, phase: 'vote', last: null });
  });

  it('project shows a viewer only their own vote until the reveal', () => {
    const s0 = mlt.setup(SECRET, ctx(), { prompts: POOL });
    const mid = voteAll(s0, ['p3', 'p4']).state;
    const table = mlt.project(mid, 'table') as View & Record<string, unknown>;
    expect(table.votes).toBeUndefined();
    expect(table.deck).toBeUndefined();
    expect(table.myVote).toBeNull();
    expect(table.voted).toEqual([true, true, false, false]);
    expect(table.voter).toBe('p3');
    expect(table.remaining).toBe(mid.deck.length);
    expect((mlt.project(mid, 'p1') as View).myVote).toBe('p3');
    expect((mlt.project(mid, 'p2') as View).myVote).toBe('p4');
    expect((mlt.project(mid, 'p3') as View).myVote).toBeNull();
    expect((mlt.project(mid, 'stranger') as View).myVote).toBeNull();
    expect(table.last).toBeNull();

    const done = voteAll(mid, ['p1', 'p1']).state;
    expect((mlt.project(done, 'table') as View).last?.votes).toEqual(['p3', 'p4', 'p1', 'p1']);
  });
});

describe('most likely to properties', () => {
  /** A legal action, steered by `choice`. */
  function pick(s: State, r: Rules, choice: number): Action {
    if (s.phase === 'reveal') return { type: 'NEXT' };
    if (r.voting === 'secret') {
      if (s.cast === 0 && choice % 9 === 0) return { type: 'NEXT' };
      return vote(s.order[choice % s.order.length] as PlayerId);
    }
    if (choice % 7 === 0) return { type: 'NEXT' };
    const k = 1 + (choice % s.order.length);
    return pickPlayers(...s.order.slice(0, k));
  }

  /** Reassigns every cast vote except `keep`'s to a different seat. */
  const scramble = (s: State, keep: number, shift: number): State => ({
    ...s,
    votes: s.votes.map((v, i) => {
      if (i === keep || v === null) return v;
      const j = (s.order.indexOf(v) + 1 + (shift % (s.order.length - 1))) % s.order.length;
      return s.order[j] as PlayerId;
    }),
  });

  const arbGame = fc.record({
    seed: fc.integer(),
    n: fc.integer({ min: 3, max: 7 }),
    sips: fc.integer({ min: 1, max: 5 }),
    shift: fc.nat(10),
    choices: fc.array(fc.nat(1000), { minLength: 1, maxLength: 50 }),
  });

  it('no projection leaks votes before the reveal', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const r = rules({ voting: 'secret', sips: g.sips });
        const c = {
          players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
          rng: createRng(g.seed),
        };
        let s = mlt.setup(r, c, { prompts: POOL.map((p) => ({ ...p, spice: 0 })) });
        for (let step = 0; step < 120 && !mlt.isOver(s); step++) {
          if (s.phase === 'vote') {
            const viewers: (PlayerId | 'table')[] = ['table', ...s.order, 'stranger'];
            for (const viewer of viewers) {
              const seat = viewer === 'table' ? -1 : s.order.indexOf(viewer);
              const view = mlt.project(s, viewer) as View & Record<string, unknown>;
              // Changing anyone else's vote must not change what this viewer sees.
              expect(mlt.project(scramble(s, seat, g.shift), viewer)).toEqual(view);
              expect(view.votes).toBeUndefined();
              expect(view.last?.round ?? 0).toBeLessThan(s.round);
              expect(view.myVote).toBe(seat >= 0 ? s.votes[seat] : null);
            }
          }
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          expect(mlt.validate(s, a, 'host', r)).toBeNull();
          s = mlt.reduce(s, a, c, r).state;
        }
      }),
      { numRuns: 150 },
    );
  });

  it('at every reveal exactly the top vote-getters drink, and the tally adds up', () => {
    fc.assert(
      fc.property(arbGame, (g) => {
        const r = rules({ voting: 'secret', sips: g.sips });
        const c = {
          players: players(...Array.from({ length: g.n }, (_, i) => `P${i}`)),
          rng: createRng(g.seed),
        };
        let s = mlt.setup(r, c, { prompts: POOL.map((p) => ({ ...p, spice: 0 })) });
        for (let step = 0; step < 120 && !mlt.isOver(s); step++) {
          const a = pick(s, r, g.choices[step % g.choices.length] as number);
          const out = mlt.reduce(s, a, c, r);
          const d = drinks(out.effects);
          if (out.state.phase === 'reveal' && s.phase === 'vote') {
            const last = out.state.last;
            expect(last?.tally?.reduce((x, y) => x + y, 0)).toBe(g.n);
            const top = Math.max(...(last?.tally ?? []));
            expect(last?.picked).toEqual(s.order.filter((_, i) => last?.tally?.[i] === top));
            expect(d).toEqual([
              {
                type: 'drink',
                to: last?.picked,
                amount: g.sips,
                kind: 'drink',
                reason: { key: 'mlt.reason.most' },
              },
            ]);
          } else {
            expect(d).toEqual([]);
          }
          s = out.state;
        }
      }),
      { numRuns: 100 },
    );
  });

  it('plays every prompt exactly once through the session (point mode)', () => {
    let session = startSession(mlt, {
      rules: { maxSpice: 2 },
      players: players('Ana', 'Ben', 'Cy'),
      intensity: intensity(),
      seed: 3,
      content: { prompts: POOL },
    });
    const seen: string[] = [];
    for (let i = 0; i < 50 && !session.over; i++) {
      seen.push((session.game as State).prompt?.item.id ?? '');
      const step = sessionReducer(mlt, session, {
        type: 'GAME',
        action: pick(session.game as State, session.rules as Rules, i + 1),
      });
      expect(step.error).toBeNull();
      session = step.state;
    }
    expect(session.over).toBe(true);
    expect(seen.sort()).toEqual(POOL.map((p) => p.id).sort());
  });
});
