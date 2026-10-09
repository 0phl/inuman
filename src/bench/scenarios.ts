import { BUILTIN_PACKS, collectPrompts } from '@/core/content/builtin';
import type { PackGame } from '@/core/content/schemas';
import type { GameContent, GameId } from '@/core/engine/types';
import type { View as BpView } from '@/core/games/beer-pong/logic';
import type { View as FcView } from '@/core/games/flip-cup/logic';
import type { View as LdView } from '@/core/games/liars-dice/logic';
import type { View as MltView } from '@/core/games/most-likely-to/logic';
import type { View as QtView } from '@/core/games/quarters/logic';
import type { View as StbView } from '@/core/games/spin-the-bottle/logic';
import type { View as TodView } from '@/core/games/truth-or-dare/logic';
import {
  aimedThrow,
  defendingTargets,
  frontTarget,
  idealPower,
  parseTargetId,
  throwSeed,
} from '@/games/beer-pong/layout';
import { clearThrow, runThrow } from '@/games/beer-pong/throwBus';
import { GLASS } from '@/games/quarters/layout';
import { aimAssist } from '@/physics/throwMath';
import { DEFAULT_GLASS_POSITION } from '@/physics/throwConfig';
import type { BenchHost } from './session';

// One scripted run per game: ~6 s of the game's signature animation, driven by dispatching the
// same actions the HUD would (the scene reports SETTLED itself, as in real play). Every script is
// written against the reducer's validation, so a rejected action just moves on to the next try.

export interface ScenarioCtx {
  host: BenchHost;
  view<V>(): V;
  /** ms since the measured window started. */
  elapsed(): number;
  /** Waits `ms` (resolves early, with false, once the run is stopped or the window ends). */
  sleep(ms: number): Promise<boolean>;
  /** The run was stopped or the window ended. */
  done(): boolean;
  /** No new action starts after this many ms into the window, so the last animation lands in it. */
  lastAction: number;
}

export interface Scenario {
  id: GameId;
  /** What the run animates, for the results table. */
  action: string;
  rules?: Record<string, unknown>;
  content?: () => GameContent;
  run(ctx: ScenarioCtx): Promise<void>;
}

const prompts = (game: PackGame): GameContent => ({
  prompts: collectPrompts(BUILTIN_PACKS, { maxSpice: 0, game }),
});

/** Calls `act` every `everyMs` (first at `firstMs`) until ctx.lastAction. */
async function every(ctx: ScenarioCtx, firstMs: number, everyMs: number, act: (n: number) => void) {
  if (!(await ctx.sleep(firstMs))) return;
  for (let n = 0; ctx.elapsed() <= ctx.lastAction; n++) {
    act(n);
    if (!(await ctx.sleep(everyMs))) return;
  }
}

/** If the scene hasn't reported SETTLED after `ms` (e.g. its once-only guard already fired for that id), do it. */
async function settleLater(ctx: ScenarioCtx, ms: number, settled: () => boolean, action: unknown) {
  if (!(await ctx.sleep(ms))) return;
  if (!settled()) ctx.host.tryGame(action);
}

const BENCH_STARTED_AT = 1_700_000_000;

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'higher-lower',
    action: 'card flip',
    run: (ctx) =>
      every(ctx, 250, 1100, (n) =>
        ctx.host.tryGame({ type: 'GUESS', guess: n % 2 ? 'lower' : 'higher' }),
      ),
  },
  {
    id: 'kings-cup',
    action: 'draw + flip from ring',
    run: (ctx) => every(ctx, 250, 1150, () => ctx.host.tryGame({ type: 'SKIP' }, { type: 'DRAW' })),
  },
  {
    id: 'ride-the-bus',
    action: 'deal fly + flip',
    run: (ctx) =>
      every(ctx, 250, 1000, () =>
        ctx.host.tryGame(
          { type: 'RED_BLACK', guess: 'red' },
          { type: 'HIGHER_LOWER', guess: 'higher' },
          { type: 'INSIDE_OUTSIDE', guess: 'inside' },
          { type: 'SUIT', guess: 'hearts' },
          { type: 'FLIP' },
          { type: 'BOARD' },
        ),
      ),
  },
  {
    id: 'mexico',
    action: 'cup shake + dice roll',
    // Roll as soon as the last one has settled (the scene dispatches SETTLED when the dice stop).
    run: (ctx) =>
      every(ctx, 250, 300, () =>
        ctx.host.tryGame({ type: 'ROLL' }, { type: 'KEEP' }, { type: 'NEXT_ROUND' }),
      ),
  },
  {
    id: 'ship-captain-crew',
    action: 'dice roll + dock hop',
    run: (ctx) =>
      every(ctx, 250, 300, () =>
        ctx.host.tryGame({ type: 'ROLL' }, { type: 'KEEP' }, { type: 'NEXT_ROUND' }),
      ),
  },
  {
    id: 'liars-dice',
    action: 'cup shake + reveal lift',
    run: (ctx) =>
      every(ctx, 300, 1050, () => {
        const v = ctx.view<LdView>();
        if (v.phase === 'reveal') {
          ctx.host.tryGame({ type: 'NEXT_ROUND' });
          return;
        }
        const last = v.lastBid;
        // One bid, then call it: every round shows the shake and the reveal.
        if (last) ctx.host.tryGame({ type: 'CHALLENGE' });
        else ctx.host.tryGame({ type: 'BID', quantity: 2, face: 3 });
      }),
  },
  {
    id: 'spin-the-bottle',
    action: 'bottle spin',
    rules: { outcome: 'drink' },
    run: async (ctx) => {
      if (!(await ctx.sleep(250))) return;
      ctx.host.tryGame({ type: 'SPIN', power: 0.5 });
      const id = ctx.view<StbView>().spin?.id ?? 0;
      // durationFor(0.5) = 3.75 s; the scene settles it, this only covers a skipped settle.
      await settleLater(ctx, 4200, () => ctx.view<StbView>().spin?.settled ?? true, {
        type: 'SETTLED',
        spinId: id,
      });
    },
  },
  {
    id: 'truth-or-dare',
    action: 'prize wheel spin',
    rules: { choice: 'wheel' },
    content: () => prompts('truth-or-dare'),
    run: async (ctx) => {
      if (!(await ctx.sleep(250))) return;
      ctx.host.tryGame({ type: 'SPIN_WHEEL' });
      const id = ctx.view<TodView>().wheel?.id ?? 0;
      // The wheel turns for 3.8 s.
      await settleLater(ctx, 4300, () => ctx.view<TodView>().wheel?.settled ?? true, {
        type: 'SETTLED',
        wheelId: id,
      });
    },
  },
  {
    id: 'most-likely-to',
    action: 'secret votes, caps drop, tent flip',
    rules: { voting: 'secret' },
    content: () => prompts('most-likely-to'),
    run: (ctx) =>
      every(ctx, 250, 330, (n) => {
        const v = ctx.view<MltView>();
        if (v.phase === 'reveal') {
          // Let the caps land before the next card.
          if (n % 6 === 5) ctx.host.tryGame({ type: 'NEXT' });
          return;
        }
        const target = v.order[n % 2] ?? v.order[0];
        ctx.host.tryGame({ type: 'VOTE', for: target }, { type: 'NEXT' });
      }),
  },
  {
    id: 'never-have-i-ever',
    action: 'tent card flip',
    content: () => prompts('never-have-i-ever'),
    run: (ctx) => every(ctx, 250, 1000, () => ctx.host.tryGame({ type: 'NEXT', did: [] })),
  },
  {
    id: 'beer-pong',
    action: 'ball throw + cup pull',
    run: async (ctx) => {
      if (!(await ctx.sleep(250))) return;
      for (let n = 1; ctx.elapsed() <= ctx.lastAction; n++) {
        const view = ctx.view<BpView>();
        if (view.phase === 'over') return;
        const targets = defendingTargets(view);
        const front = frontTarget(targets);
        if (!front) return;
        const thrown = aimAssist(
          3,
          aimedThrow('ball', front.position, idealPower('ball', front.position) ?? 0.55),
          targets,
        );
        const sim = await runThrow({
          kind: 'ball',
          origin: thrown.origin,
          impulse: thrown.impulse,
          targets,
          seed: throwSeed(BENCH_STARTED_AT, n),
        });
        if (ctx.done()) return;
        const id = sim.result.kind === 'ball' ? sim.result.hit : null;
        ctx.host.tryGame({
          type: 'THROW_RESOLVED',
          impulse: thrown.impulse,
          origin: thrown.origin,
          hit: id ? parseTargetId(id) : null,
        });
        clearThrow();
        if (!(await ctx.sleep(450))) return;
      }
    },
  },
  {
    id: 'quarters',
    action: 'coin bounce throw',
    run: async (ctx) => {
      if (!(await ctx.sleep(250))) return;
      for (let n = 1; ctx.elapsed() <= ctx.lastAction; n++) {
        const pos = DEFAULT_GLASS_POSITION;
        const thrown = aimAssist(3, aimedThrow('coin', pos, idealPower('coin', pos) ?? 0.5), GLASS);
        const sim = await runThrow({
          kind: 'coin',
          origin: thrown.origin,
          impulse: thrown.impulse,
          targets: GLASS,
          seed: throwSeed(BENCH_STARTED_AT, n),
        });
        if (ctx.done()) return;
        const made = sim.result.kind === 'coin' && sim.result.made;
        const bounced = sim.result.kind === 'coin' && sim.result.bounced;
        ctx.host.tryGame({
          type: 'THROW_RESOLVED',
          impulse: thrown.impulse,
          origin: thrown.origin,
          made,
          bounced,
        });
        // A make leaves a pick (and maybe a house rule) to settle before the next shot.
        const v = ctx.view<QtView>();
        const other = v.order.find((id) => id !== v.current) ?? v.order[0];
        ctx.host.tryGame({ type: 'RESOLVE', target: other });
        ctx.host.tryGame({ type: 'RESOLVE', text: 'Bench rule' }, { type: 'SKIP' });
        clearThrow();
        if (!(await ctx.sleep(350))) return;
      }
    },
  },
  {
    id: 'flip-cup',
    action: 'cup flip',
    run: async (ctx) => {
      if (!(await ctx.sleep(250))) return;
      while (ctx.elapsed() <= ctx.lastAction) {
        ctx.host.tryGame({ type: 'DRANK' });
        ctx.host.tryGame({ type: 'FLIP_ATTEMPT', quality: 0.9 });
        const f = ctx.view<FcView>().flip;
        if (!f) return;
        // A flip plays for 1.05–1.55 s; the scene settles it.
        if (!(await ctx.sleep(1700))) return;
        if (!ctx.view<FcView>().flip?.settled) {
          ctx.host.tryGame({ type: 'SETTLED', flipId: f.id });
        }
        if (!(await ctx.sleep(250))) return;
      }
    },
  },
];

export const scenarioFor = (id: GameId): Scenario | undefined => SCENARIOS.find((s) => s.id === id);
