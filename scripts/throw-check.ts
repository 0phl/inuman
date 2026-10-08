// Skill-throw health check (pnpm throw:check). Runs synthetic phone flicks through the whole
// pipeline in Node — screen flick → flickToThrow (the real camera rig at Pixel 7 size) → aimAssist
// → presimThrow (Rapier) — and reports:
//  - Beer Pong hit rate per assist level and flick profile (assist 3 + reasonable flicks must be
//    ≥ 55%; assist 0 + random flicks must be < 30%);
//  - Quarters make rate (assist 2 + reasonable flicks must be 30–70%);
//  - determinism (same seed + inputs → identical frames and result);
//  - presim time p50 / p95 (target p95 < 15 ms on desktop);
//  - an end-to-end sanity pass: ideal throws at every cup of a 10-rack land in that cup, and a
//    throw at the far wall goes off the table as a miss.
//
// Env: THROWS (default 600 per cell), THROW_SEED (default 1).
import { registerHooks } from 'node:module';

// The app's sources use extensionless relative imports (Vite resolves them); teach Node the same
// trick so this script can use the real camera rig instead of a copy.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !specifier.endsWith('.ts'))
        return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { rigPose } = await import('../src/stage/cameraRig.ts');
const { initRapier, presimThrowSync } = await import('../src/physics/throwSim.ts');
const { quantile, runBench } = await import('../src/physics/throwBench.ts');
const { idealVelocity, lookAtCamera, toImpulse } = await import('../src/physics/throwMath.ts');
const { DEFAULT_GLASS_POSITION, rackLayout, THROW_SETUPS } =
  await import('../src/physics/throwConfig.ts');

type Level = 0 | 1 | 2 | 3;

const THROWS = Number(process.env.THROWS ?? 600);
const SEED = Number(process.env.THROW_SEED ?? 1);
// Pixel 7 CSS viewport.
const ASPECT = 412 / 915;
const pose = rigPose(ASPECT);
const camera = lookAtCamera([...pose.position], [...pose.target], pose.fov);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

await initRapier();
// Warm up the WASM JIT (not timed).
runBench({
  kind: 'ball',
  level: 0,
  profile: 'random',
  throws: 20,
  seed: 999,
  camera,
  aspect: ASPECT,
});

const failures: string[] = [];
const allMs: number[] = [];

console.log(`throw:check — ${THROWS} throws per cell, seed ${SEED}, Pixel 7 camera`);

// ---------------------------------------------------------------- beer pong
const pong: Record<string, Record<Level, number>> = {
  reasonable: {} as Record<Level, number>,
  random: {} as Record<Level, number>,
};
for (const profile of ['reasonable', 'random'] as const) {
  const cells: string[] = [];
  for (const level of [0, 1, 2, 3] as const) {
    const r = runBench({
      kind: 'ball',
      level,
      profile,
      throws: THROWS,
      seed: SEED + level * 101,
      camera,
      aspect: ASPECT,
    });
    pong[profile]![level] = r.rate;
    allMs.push(...r.ms);
    const racks = Object.entries(r.byRack)
      .map(([k, v]) => `${k}:${pct(v.made / v.throws)}`)
      .join(' ');
    cells.push(
      `    assist ${level}: ${pct(r.rate).padStart(6)}  (racks ${racks}; bounce shots ${r.bounced})`,
    );
  }
  console.log(`  beer pong, ${profile} flicks`);
  for (const c of cells) console.log(c);
}
const hit3 = pong.reasonable![3];
const miss0 = pong.random![0];
if (!(hit3 >= 0.55)) failures.push(`beer pong assist 3 + reasonable = ${pct(hit3)} (< 55%)`);
if (!(miss0 < 0.3)) failures.push(`beer pong assist 0 + random = ${pct(miss0)} (>= 30%)`);

// ---------------------------------------------------------------- quarters
const quarters: string[] = [];
let q2 = 0;
for (const level of [0, 1, 2, 3] as const) {
  const r = runBench({
    kind: 'coin',
    level,
    profile: 'reasonable',
    throws: THROWS,
    seed: SEED + 7 + level * 13,
    camera,
    aspect: ASPECT,
  });
  allMs.push(...r.ms);
  if (level === 2) q2 = r.rate;
  quarters.push(
    `    assist ${level}: ${pct(r.rate).padStart(6)}  (bounced in ${r.bounced} of ${r.made})`,
  );
}
const qRandom = runBench({
  kind: 'coin',
  level: 0,
  profile: 'random',
  throws: THROWS,
  seed: SEED + 77,
  camera,
  aspect: ASPECT,
});
console.log('  quarters, reasonable flicks');
for (const c of quarters) console.log(c);
console.log(`  quarters, random flicks, assist 0: ${pct(qRandom.rate)}`);
if (!(q2 >= 0.3 && q2 <= 0.7)) failures.push(`quarters assist 2 = ${pct(q2)} (outside 30–70%)`);

// ---------------------------------------------------------------- determinism
{
  const targets = rackLayout(10);
  const input = {
    kind: 'ball' as const,
    origin: [0.1, 0.9, 1.95] as [number, number, number],
    impulse: [-0.0011, 0.0175, -0.0172] as [number, number, number],
    targets,
    seed: 4242,
  };
  const a = presimThrowSync(input);
  const b = presimThrowSync(input);
  const same =
    a.steps === b.steps &&
    a.frames.every((v, i) => v === b.frames[i]) &&
    JSON.stringify(a.result) === JSON.stringify(b.result);
  const c = presimThrowSync({ ...input, seed: 4243 });
  const coinIn = {
    kind: 'coin' as const,
    origin: [0, 0.62, 1] as [number, number, number],
    impulse: toImpulse('coin', [0, -5.2, -4.1]),
    targets: [{ id: 'glass', position: [...DEFAULT_GLASS_POSITION] as [number, number, number] }],
    seed: 99,
  };
  const ca = presimThrowSync(coinIn);
  const cb = presimThrowSync(coinIn);
  const coinSame = ca.steps === cb.steps && ca.frames.every((v, i) => v === cb.frames[i]);
  console.log(
    `  determinism      ball ${same ? 'identical' : 'DIFFERENT'} (${a.steps} frames, ${JSON.stringify(a.result)}), coin ${coinSame ? 'identical' : 'DIFFERENT'}; other seed ${c.frames.length === a.frames.length && c.frames.every((v, i) => v === a.frames[i]) ? 'same (spin had no effect)' : 'differs'}`,
  );
  if (!same || !coinSame) failures.push('presimThrow is not deterministic');
}

// ---------------------------------------------------------------- end-to-end sanity
{
  const rack = rackLayout(10);
  const s = THROW_SETUPS.ball;
  const origin: [number, number, number] = [0, s.handY, s.handZ];
  let ok = 0;
  for (const cup of rack) {
    const v = idealVelocity('ball', origin, cup.position, (s.elevationDeg * Math.PI) / 180);
    if (!v) continue;
    const r = presimThrowSync({
      kind: 'ball',
      origin,
      impulse: toImpulse('ball', v),
      targets: rack,
      seed: 1,
    });
    if (r.result.kind === 'ball' && r.result.hit === cup.id) ok++;
  }
  const wild = presimThrowSync({
    kind: 'ball',
    origin,
    impulse: toImpulse('ball', [0, 6, -14]),
    targets: rack,
    seed: 1,
  });
  const wildOk =
    wild.result.kind === 'ball' && wild.result.hit === null && wild.end === 'off-table';
  console.log(
    `  e2e sanity       ideal throws into their cup: ${ok}/10; over-the-rack throw: ${wildOk ? 'off-table miss' : JSON.stringify(wild.result) + ' ' + wild.end}`,
  );
  if (ok < 10) failures.push(`only ${ok}/10 ideal throws landed in their cup`);
  if (!wildOk) failures.push('a throw over the rack did not end as an off-table miss');
}

// ---------------------------------------------------------------- timing
console.log(
  `  presim time      p50 ${quantile(allMs, 0.5).toFixed(2)} ms, p95 ${quantile(allMs, 0.95).toFixed(2)} ms, max ${quantile(allMs, 1).toFixed(2)} ms over ${allMs.length} throws [target p95 < 15 ms]`,
);
if (quantile(allMs, 0.95) >= 15)
  failures.push(`presim p95 ${quantile(allMs, 0.95).toFixed(2)} ms >= 15 ms`);

if (failures.length) {
  console.error(`throw:check FAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('throw:check OK');
