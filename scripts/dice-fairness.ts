// Dice pre-sim health check (pnpm dice:check). Runs N headless throws of 5 dice in Node with the
// app's own presim and reports:
//  - how often a throw is re-done because a die landed cocked, and how often one stays cocked
//    after every retry (target < 0.5%, fails at >= 1%);
//  - that remapping shows the target face: topFace(q_final · remap(landed, target)) === target for
//    every non-cocked die (fails on any mismatch);
//  - presim time (mean / p95) and animation length;
//  - the physical landed-face distribution (informational: the visible face comes from the RNG).
//
// Env: DICE_THROWS (default 2000), DICE_COUNT (default 5), DICE_SEED (default 1).
import {
  FACES,
  multiply,
  remap,
  topFace,
  type Face,
  type Quat,
} from '../src/core/primitives/dice.ts';
import { FRAME_STRIDE, presimulateThrow } from '../src/physics/presim.ts';

const THROWS = Number(process.env.DICE_THROWS ?? 2000);
const COUNT = Number(process.env.DICE_COUNT ?? 5);
const SEED = Number(process.env.DICE_SEED ?? 1);
const DT = 1 / 60;

/** Stand-in for the reducer's RNG (any uniform source works: the remap must hold for all). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(d, 1)).toFixed(2)}%`;
const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);

async function main() {
  const rng = mulberry32(SEED);
  await presimulateThrow({ count: COUNT, throwSeed: 0 }); // WASM init + JIT warm-up, not timed

  const ms: number[] = [];
  const seconds: number[] = [];
  const attemptsHist = [0, 0, 0, 0, 0, 0];
  const landedHist: Record<Face, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const rejectedFor = { cocked: 0, stacked: 0, moving: 0, escaped: 0 };
  let retried = 0;
  let cockedRetry = 0;
  let stuckDice = 0;
  let stuckThrows = 0;
  let checked = 0;
  let mismatches = 0;
  let mismatchesAll = 0;

  for (let i = 0; i < THROWS; i++) {
    const r = await presimulateThrow({
      count: COUNT,
      throwSeed: (Math.imul(i + 1, 2654435761) ^ SEED) >>> 0,
    });
    ms.push(r.ms);
    seconds.push((r.steps - 1) * DT);
    attemptsHist[r.attempts] = (attemptsHist[r.attempts] ?? 0) + 1;
    if (r.attempts > 1) retried++;
    if (r.rejected.some((j) => j.cocked > 0)) cockedRetry++;
    for (const j of r.rejected)
      for (const k of Object.keys(rejectedFor) as (keyof typeof rejectedFor)[])
        if (j[k] > 0) rejectedFor[k]++;
    const stuck = r.cocked.filter(Boolean).length;
    stuckDice += stuck;
    if (stuck) stuckThrows++;

    const last = (r.steps - 1) * COUNT * FRAME_STRIDE;
    for (let d = 0; d < COUNT; d++) {
      const o = last + d * FRAME_STRIDE;
      const q: Quat = [
        r.frames[o + 3] ?? 0,
        r.frames[o + 4] ?? 0,
        r.frames[o + 5] ?? 0,
        r.frames[o + 6] ?? 1,
      ];
      const landed = r.landed[d] as Face;
      landedHist[landed]++;
      const target = (1 + Math.floor(rng() * 6)) as Face;
      const shown = topFace(multiply(q, remap(landed, target))).face;
      if (shown !== target) {
        mismatchesAll++;
        if (!r.cocked[d]) mismatches++;
      }
      if (!r.cocked[d]) checked++;
    }
  }

  const dice = THROWS * COUNT;
  const sortedMs = [...ms].sort((a, b) => a - b);
  const sortedSec = [...seconds].sort((a, b) => a - b);
  const expected = dice / 6;
  const chi2 = FACES.reduce((s, f) => s + (landedHist[f] - expected) ** 2 / expected, 0);
  const stuckRate = stuckDice / dice;

  console.log(`dice:check: ${THROWS} throws × ${COUNT} dice (seed ${SEED})`);
  console.log(
    `  presim time      mean ${mean(ms).toFixed(2)} ms, p50 ${quantile(sortedMs, 0.5).toFixed(2)} ms, p95 ${quantile(sortedMs, 0.95).toFixed(2)} ms, max ${(sortedMs.at(-1) ?? 0).toFixed(2)} ms`,
  );
  console.log(
    `  animation        mean ${mean(seconds).toFixed(2)} s, p95 ${quantile(sortedSec, 0.95).toFixed(2)} s`,
  );
  console.log(
    `  attempts         ${attemptsHist
      .slice(1)
      .map((n, i) => `${i + 1}:${n}`)
      .join('  ')}`,
  );
  console.log(`  retried throws   ${retried} (${pct(retried, THROWS)})`);
  console.log(
    `  cocked retries   ${cockedRetry} throws (${pct(cockedRetry, THROWS)}) had an attempt re-done for a cocked die`,
  );
  console.log(
    `  rejected for     cocked ${rejectedFor.cocked}, stacked ${rejectedFor.stacked}, moving ${rejectedFor.moving}, above-rim bounce ${rejectedFor.escaped} (attempts)`,
  );
  console.log(
    `  stuck cocked     ${stuckDice} dice (${pct(stuckDice, dice)}) in ${stuckThrows} throws after ${attemptsHist.length - 1} tries [target < 0.5%, fail >= 1%]`,
  );
  console.log(
    `  remap check      ${checked} non-cocked dice, ${mismatches} mismatches (all dice incl. cocked: ${mismatchesAll})`,
  );
  console.log(
    `  landed faces     ${FACES.map((f) => `${f}:${landedHist[f]}`).join('  ')}  chi² ${chi2.toFixed(2)} (df 5; > 20.5 means p < 0.001, informational)`,
  );

  const failures: string[] = [];
  if (mismatches > 0) failures.push(`${mismatches} remap mismatches`);
  if (stuckRate >= 0.01) failures.push(`stuck-cocked rate ${pct(stuckDice, dice)} >= 1%`);
  if (failures.length) {
    console.error(`dice:check FAILED: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(
    `dice:check OK${stuckRate >= 0.005 ? ' (warning: stuck-cocked rate above the 0.5% target)' : ''}`,
  );
}

await main();
