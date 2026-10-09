// Impact events read back from recorded physics frames, so the replay can schedule a knock at the
// exact moment a die or ball hits something. Pure maths over the Float32Array recordings
// (px, py, pz, qx, qy, qz, qw per body per step); no Rapier, three or Web Audio.
//
// A contact shows up as a jump in a body's velocity between consecutive steps that gravity doesn't
// explain: J = |v(s→s+1) − v(s−1→s) + g·dt·ŷ|. Free flight gives J ≈ 0 and resting contact
// J ≈ g·dt, so anything clearly above that is an impact; where the body is (near the floor, a wall,
// another body, a cup rim) and the direction of the jump say what it hit.

export type DiceSurface = 'table' | 'wall' | 'die';

export interface DiceImpact {
  /** Recorded step at which the impact happens (play at step × dt into the replay). */
  step: number;
  /** Index of the thrown die (into the recording, not the game's die index). */
  die: number;
  surface: DiceSurface;
  /** Velocity change (world units/s): how hard it hit. */
  speed: number;
  x: number;
  y: number;
  z: number;
}

export interface DiceImpactInput {
  frames: ArrayLike<number>;
  steps: number;
  /** Dice in the recording. */
  count: number;
  /** Seconds per recorded step. */
  dt: number;
  dieSize: number;
  /** Inner tray size (centred on the origin). */
  tray: { width: number; depth: number };
  /** Gravity (units/s²) the recording was simulated with. */
  gravity?: number;
  /** Dice that stayed put during this throw (their centres). */
  obstacles?: readonly { p: readonly [number, number, number] }[];
  stride?: number;
  /** Velocity change below which nothing is reported (units/s). */
  minSpeed?: number;
  /** Most events reported per die / in total (the strongest are kept). */
  maxPerDie?: number;
  maxTotal?: number;
}

const DEBOUNCE_STEPS = 3;

/** Detects floor, wall and die-on-die impacts in a dice presim recording, in time order. */
export function extractDiceImpacts({
  frames,
  steps,
  count,
  dt,
  dieSize,
  tray,
  gravity = 22,
  obstacles = [],
  stride = 7,
  minSpeed = 0.9,
  maxPerDie = 14,
  maxTotal = 48,
}: DiceImpactInput): DiceImpact[] {
  if (steps < 3 || count <= 0 || dt <= 0) return [];
  const half = dieSize / 2;
  // A die's centre is at most half·√3 above the felt (balanced on a corner).
  const floorBand = half * 1.85;
  const wallBand = half * 1.85;
  const contact = dieSize * 1.85;
  const frameStride = count * stride;
  const at = (s: number, k: number, j: number) => frames[s * frameStride + k * stride + j] ?? 0;
  const out: DiceImpact[] = [];

  for (let k = 0; k < count; k++) {
    const mine: DiceImpact[] = [];
    const lastAt: Record<DiceSurface, number> = { table: -99, wall: -99, die: -99 };
    for (let s = 1; s < steps - 1; s++) {
      const x = at(s, k, 0);
      const y = at(s, k, 1);
      const z = at(s, k, 2);
      const dvx = (at(s + 1, k, 0) - 2 * x + at(s - 1, k, 0)) / dt;
      const dvy = (at(s + 1, k, 1) - 2 * y + at(s - 1, k, 1)) / dt + gravity * dt;
      const dvz = (at(s + 1, k, 2) - 2 * z + at(s - 1, k, 2)) / dt;
      const j = Math.hypot(dvx, dvy, dvz);
      if (j < minSpeed) continue;

      let surface: DiceSurface | null = null;
      // Another die close by (thrown or resting).
      let near = false;
      for (let o = 0; o < count && !near; o++) {
        if (o === k) continue;
        near = Math.hypot(at(s, o, 0) - x, at(s, o, 1) - y, at(s, o, 2) - z) < contact;
      }
      for (const ob of obstacles) {
        if (near) break;
        near = Math.hypot(ob.p[0] - x, ob.p[1] - y, ob.p[2] - z) < contact;
      }
      // Direction decides first: an upward kick low down is the felt (even with a die beside it),
      // an inward kick at the rim is the wall; what's left near another die is a die knock.
      const onFloor = y < floorBand && dvy > 0.6 * j;
      const wallX = Math.abs(x) > tray.width / 2 - wallBand && dvx * Math.sign(x) < -0.45 * j;
      const wallZ = Math.abs(z) > tray.depth / 2 - wallBand && dvz * Math.sign(z) < -0.45 * j;
      if (onFloor) surface = 'table';
      else if (wallX || wallZ) surface = 'wall';
      else if (near) surface = 'die';
      else if (y < floorBand) surface = 'table';
      if (!surface) continue;

      // One knock per contact: a hit spread over a couple of steps adds up to one impulse.
      if (s - lastAt[surface] <= DEBOUNCE_STEPS) {
        const prev = mine.findLast((e) => e.surface === surface);
        if (prev) prev.speed += j;
        lastAt[surface] = s;
        continue;
      }
      lastAt[surface] = s;
      mine.push({ step: s, die: k, surface, speed: j, x, y, z });
    }
    out.push(...strongest(mine, maxPerDie));
  }

  // A die-on-die knock registers on both dice: keep one (the harder) per pair moment.
  const deduped = out.filter((e) => {
    if (e.surface !== 'die') return true;
    return !out.some(
      (o) =>
        o !== e &&
        o.surface === 'die' &&
        Math.abs(o.step - e.step) <= 1 &&
        Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z) < contact &&
        (o.speed > e.speed || (o.speed === e.speed && o.die < e.die)),
    );
  });
  return strongest(deduped, maxTotal).sort((a, b) => a.step - b.step || a.die - b.die);
}

export type ThrowSurface = 'table' | 'rim';

export interface ThrowImpact {
  step: number;
  surface: ThrowSurface;
  speed: number;
  x: number;
  y: number;
  z: number;
}

export interface ThrowImpactInput {
  frames: ArrayLike<number>;
  steps: number;
  dt: number;
  gravity: number;
  /** Ball radius / coin radius. */
  radius: number;
  /** Standing cups / the glass: base centre on the table. */
  targets: readonly { position: readonly [number, number, number] }[];
  /** Outer radius of a target wall at height y above its base. */
  radiusAt: (y: number) => number;
  /** Height of the targets' mouth. */
  mouthY: number;
  /** Ignore everything from this step on (e.g. once the ball is in the beer). */
  until?: number;
  stride?: number;
  minSpeed?: number;
  maxTotal?: number;
}

/** Table bounces and rim/wall knocks of a single thrown ball or coin, in time order. */
export function extractThrowImpacts({
  frames,
  steps,
  dt,
  gravity,
  radius,
  targets,
  radiusAt,
  mouthY,
  until = Infinity,
  stride = 7,
  minSpeed = 0.6,
  maxTotal = 24,
}: ThrowImpactInput): ThrowImpact[] {
  if (steps < 3 || dt <= 0) return [];
  const at = (s: number, j: number) => frames[s * stride + j] ?? 0;
  const out: ThrowImpact[] = [];
  const lastAt: Record<ThrowSurface, number> = { table: -99, rim: -99 };
  // A few physics steps per contact at 120–240 Hz: merge them into one knock.
  const debounce = Math.max(DEBOUNCE_STEPS, Math.round(0.03 / dt));
  const end = Math.min(steps - 1, until);
  for (let s = 1; s < end; s++) {
    const x = at(s, 0);
    const y = at(s, 1);
    const z = at(s, 2);
    const dvx = (at(s + 1, 0) - 2 * x + at(s - 1, 0)) / dt;
    const dvy = (at(s + 1, 1) - 2 * y + at(s - 1, 1)) / dt + gravity * dt;
    const dvz = (at(s + 1, 2) - 2 * z + at(s - 1, 2)) / dt;
    const j = Math.hypot(dvx, dvy, dvz);
    if (j < minSpeed) continue;

    let surface: ThrowSurface | null = null;
    for (const t of targets) {
      const ly = y - t.position[1];
      if (ly < -radius || ly > mouthY + radius * 2) continue;
      const d = Math.hypot(x - t.position[0], z - t.position[2]);
      if (Math.abs(d - radiusAt(Math.min(Math.max(ly, 0), mouthY))) < radius * 2.2) {
        surface = 'rim';
        break;
      }
    }
    if (!surface && y < radius * 1.8 && dvy > 0.4 * j) surface = 'table';
    if (!surface) continue;

    if (s - lastAt[surface] <= debounce) {
      const prev = out.findLast((e) => e.surface === surface);
      if (prev) prev.speed += j;
      lastAt[surface] = s;
      continue;
    }
    lastAt[surface] = s;
    out.push({ step: s, surface, speed: j, x, y, z });
  }
  return strongest(out, maxTotal).sort((a, b) => a.step - b.step);
}

/** The `max` events with the highest speed (input order kept). */
function strongest<T extends { speed: number }>(events: T[], max: number): T[] {
  if (events.length <= max) return events;
  const cut = [...events].sort((a, b) => b.speed - a.speed)[max - 1]?.speed ?? 0;
  let room = max;
  return events.filter((e) => {
    if (e.speed < cut || room <= 0) return false;
    room--;
    return true;
  });
}

/** Impact speed → gain 0.1…1 on a soft curve (a graze is quiet, a slam is full). */
export function impactGain(speed: number, soft: number, hard: number): number {
  const k = (speed - soft) / Math.max(hard - soft, 1e-6);
  const c = k <= 0 ? 0 : k >= 1 ? 1 : k;
  return 0.1 + 0.9 * Math.sqrt(c);
}
