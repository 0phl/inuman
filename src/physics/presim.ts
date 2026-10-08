// Headless dice throw pre-simulation (Rapier, no React/three). The reducer has already picked the
// faces; this only produces a believable recording of a throw plus the faces that physically
// landed up, so the replay can remap each visual die onto its target face.
//
// Imports use relative `.ts` paths so `node scripts/dice-fairness.ts` runs this file unbundled.
import RAPIER from '@dimforge/rapier3d-compat';
import { COCKED_THRESHOLD, topFace, type Face, type Quat } from '../core/primitives/dice.ts';
import { DEFAULT_TRAY, DIE_RADIUS, DIE_SIZE, FRAME_STRIDE, type TraySpec } from './diceConfig.ts';

export { FRAME_STRIDE };
/** Throws allowed per call: re-thrown while a die ends cocked, stacked or moving, or bounced off
 * a wall above its visible rim. */
export const MAX_ATTEMPTS = 5;

/** A die that stays where it is during this throw (e.g. a held die); thrown dice bounce off it. */
export interface DiePose {
  p: readonly [number, number, number];
  q: Quat;
}

export interface PresimOptions {
  /** Number of dice thrown. */
  count: number;
  /** Any 32-bit integer; the same seed gives the same throw. */
  throwSeed: number;
  tray?: TraySpec;
  /** Static dice already on the tray (they don't move). */
  obstacles?: readonly DiePose[];
  maxSteps?: number;
  dt?: number;
}

/** Dice per problem in one simulated throw. */
export interface ThrowIssues {
  /** Leaning: top-face alignment below COCKED_THRESHOLD. */
  cocked: number;
  /** Resting on another die instead of the felt. */
  stacked: number;
  /** Still moving when maxSteps ran out. */
  moving: number;
  /** Touched a wall clearly above its visible rim (looks like bouncing off thin air). */
  escaped: number;
}

export interface PresimResult {
  /** `steps` frames × `count` dice × FRAME_STRIDE floats (frame 0 is the release pose). */
  frames: Float32Array;
  steps: number;
  /** Face physically up on each die in the final frame. */
  landed: Face[];
  /** True where a die still leans (alignment < COCKED_THRESHOLD) after every retry. */
  cocked: boolean[];
  /** Throws simulated (1 = the first one was clean). */
  attempts: number;
  /** Per rejected (re-thrown) attempt, which problems it had; an attempt can have several. */
  rejected: ThrowIssues[];
  /** Wall-clock time for the whole call, retries included. */
  ms: number;
}

// ---------------------------------------------------------------- tuning

/** Gravity in world units/s² (1 unit ≈ 28 cm at table scale; snappier than real for big dice). */
const GRAVITY = 22;
const WALL_THICKNESS = 0.25;
/** Invisible wall height; the visible rims are only tray.wallHeight / tray.backHeight. */
const WALL_COLLIDER_HEIGHT = 2;
/** A die touching a wall this far above its visible rim "bounced off thin air": re-throw. */
const ESCAPE_MARGIN = 0.1;
/** At rest = below these speeds (units/s, rad/s) for REST_STEPS consecutive steps (or asleep). */
const LIN_REST = 0.03;
const ANG_REST = 0.12;
const REST_STEPS = 10;

// ---------------------------------------------------------------- Rapier bootstrap

let ready: Promise<void> | null = null;

/** Loads and instantiates the Rapier WASM once; later calls reuse the same promise. */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

// ---------------------------------------------------------------- local PRNG (outside core, fine)

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

/** Mixes an attempt number into the seed so each retry is a genuinely different throw. */
function perturb(seed: number, attempt: number): number {
  let h = (seed ^ Math.imul(attempt + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniformly random rotation (Shoemake). */
function randomQuat(r: () => number): Quat {
  const u1 = r();
  const u2 = r() * Math.PI * 2;
  const u3 = r() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

// ---------------------------------------------------------------- throw setup

interface Launch {
  p: [number, number, number];
  q: Quat;
  v: [number, number, number];
  w: [number, number, number];
}

/**
 * A flick from the player's side of the tray (+Z) toward its centre: the dice leave a loose
 * "hand" cluster above the near half with forward/down velocity and a hard random spin.
 */
function launches(count: number, seed: number, tray: TraySpec): Launch[] {
  const r = mulberry32(seed);
  const h = DIE_SIZE / 2;
  const reach = h * Math.SQRT2 * 1.25; // bounding radius of a spinning die plus a margin
  const spacing = reach * 2.05;
  const perRow = Math.max(
    1,
    Math.min(count, Math.floor((tray.width - 2 * reach) / spacing) + 1, 3),
  );
  const maxX = tray.width / 2 - reach;
  const nearZ = tray.depth / 2 - reach;
  const handX = (r() - 0.5) * tray.width * 0.35;
  const out: Launch[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    const col = i % perRow;
    const x = Math.max(-maxX, Math.min(maxX, handX + (col - (inRow - 1) / 2) * spacing));
    const z = Math.max(-tray.depth / 2 + reach, nearZ - row * spacing);
    const y = 0.45 + row * 0.18 + (col % 2) * 0.12 + r() * 0.15;
    // Aim at a point around the middle/far half of the tray.
    const tx = (r() - 0.5) * tray.width * 0.45;
    const tz = -(0.05 + r() * 0.25) * tray.depth;
    const dx = tx - x;
    const dz = tz - z;
    const len = Math.hypot(dx, dz) || 1;
    const speed = 2.0 + r() * 1.3;
    const spinAxis = randomQuat(r); // reuse a random unit quaternion's vector part as a direction
    const sl = Math.hypot(spinAxis[0], spinAxis[1], spinAxis[2]) || 1;
    const spin = 16 + r() * 18;
    out.push({
      p: [x, y, z],
      q: randomQuat(r),
      // A short upward lob: more airtime and tumbling than a straight push.
      v: [(dx / len) * speed, 0.2 + r() * 0.9, (dz / len) * speed],
      w: [(spinAxis[0] / sl) * spin, (spinAxis[1] / sl) * spin, (spinAxis[2] / sl) * spin],
    });
  }
  return out;
}

// ---------------------------------------------------------------- one attempt

interface Attempt {
  frames: Float32Array;
  steps: number;
  landed: Face[];
  cocked: boolean[];
  issues: ThrowIssues;
  /** Lower is better; 0 = every die flat on the felt, at rest, and never above a rim. */
  badness: number;
}

function simulate(
  count: number,
  seed: number,
  tray: TraySpec,
  obstacles: readonly DiePose[],
  maxSteps: number,
  dt: number,
): Attempt {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  try {
    world.timestep = dt;
    // Scales Rapier's internal tolerances (sleep thresholds, contact slop) to die-sized objects.
    world.lengthUnit = DIE_SIZE;

    const halfW = tray.width / 2;
    const halfD = tray.depth / 2;
    const t = WALL_THICKNESS;
    const hy = WALL_COLLIDER_HEIGHT / 2;
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const box = (hx: number, hyy: number, hz: number, x: number, y: number, z: number) =>
      RAPIER.ColliderDesc.cuboid(hx, hyy, hz).setTranslation(x, y, z);
    // Felt floor.
    world.createCollider(
      box(halfW + 2 * t, t, halfD + 2 * t, 0, -t, 0)
        .setFriction(0.32)
        .setRestitution(0.4),
      fixed,
    );
    // Lacquered wooden walls (+X, -X, +Z near, -Z back) and a lid far above: lively, slippery.
    const wallDescs = [
      box(t, hy, halfD + 2 * t, halfW + t, hy, 0),
      box(t, hy, halfD + 2 * t, -halfW - t, hy, 0),
      box(halfW + 2 * t, hy, t, 0, hy, halfD + t),
      box(halfW + 2 * t, hy, t, 0, hy, -halfD - t),
    ];
    const rims = [tray.wallHeight, tray.wallHeight, tray.wallHeight, tray.backHeight];
    const walls = wallDescs.map((d) =>
      world.createCollider(d.setFriction(0.2).setRestitution(0.65), fixed),
    );
    world.createCollider(
      box(halfW + 2 * t, t, halfD + 2 * t, 0, WALL_COLLIDER_HEIGHT + t, 0)
        .setFriction(0.2)
        .setRestitution(0.65),
      fixed,
    );

    const h = DIE_SIZE / 2;
    const core = h - DIE_RADIUS;
    const dieCollider = () =>
      RAPIER.ColliderDesc.roundCuboid(core, core, core, DIE_RADIUS)
        .setFriction(0.45)
        .setRestitution(0.5)
        .setDensity(1);

    for (const o of obstacles) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(o.p[0], o.p[1], o.p[2])
          .setRotation({ x: o.q[0], y: o.q[1], z: o.q[2], w: o.q[3] }),
      );
      world.createCollider(dieCollider(), body);
    }

    const dice = launches(count, seed, tray).map((l) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(l.p[0], l.p[1], l.p[2])
          .setRotation({ x: l.q[0], y: l.q[1], z: l.q[2], w: l.q[3] })
          .setLinvel(l.v[0], l.v[1], l.v[2])
          .setAngvel({ x: l.w[0], y: l.w[1], z: l.w[2] })
          .setLinearDamping(0.02)
          .setAngularDamping(0.1)
          .setCcdEnabled(true),
      );
      return { body, collider: world.createCollider(dieCollider(), body) };
    });
    const bodies = dice.map((d) => d.body);

    const stride = count * FRAME_STRIDE;
    const buf = new Float32Array((maxSteps + 1) * stride);
    let frame = 0;
    const record = () => {
      let o = frame * stride;
      for (const b of bodies) {
        const p = b.translation();
        const q = b.rotation();
        buf[o++] = p.x;
        buf[o++] = p.y;
        buf[o++] = p.z;
        buf[o++] = q.x;
        buf[o++] = q.y;
        buf[o++] = q.z;
        buf[o++] = q.w;
      }
      frame++;
    };

    const atRest = (b: (typeof bodies)[number]) => {
      if (b.isSleeping()) return true;
      const v = b.linvel();
      const w = b.angvel();
      return (
        v.x * v.x + v.y * v.y + v.z * v.z < LIN_REST * LIN_REST &&
        w.x * w.x + w.y * w.y + w.z * w.z < ANG_REST * ANG_REST
      );
    };

    // Contacts with a wall entirely above its visible rim (only queried near a wall: cheap).
    const escaped: boolean[] = Array<boolean>(count).fill(false);
    const nearX = halfW - h * Math.SQRT2 * 1.3;
    const nearZ = halfD - h * Math.SQRT2 * 1.3;
    const checkEscapes = () => {
      dice.forEach((d, i) => {
        if (escaped[i]) return;
        const p = d.body.translation();
        const candidates = [p.x > nearX, p.x < -nearX, p.z > nearZ, p.z < -nearZ];
        candidates.forEach((near, w) => {
          if (!near) return;
          world.contactPair(d.collider, walls[w] as (typeof walls)[number], (m) => {
            const n = m.numSolverContacts();
            let lo = Infinity;
            for (let j = 0; j < n; j++) lo = Math.min(lo, m.solverContactPoint(j).y);
            if (n > 0 && lo > (rims[w] ?? 0) + ESCAPE_MARGIN) escaped[i] = true;
          });
        });
      });
    };

    record();
    let restRun = 0;
    for (let s = 0; s < maxSteps && restRun < REST_STEPS; s++) {
      world.step();
      record();
      checkEscapes();
      restRun = bodies.every(atRest) ? restRun + 1 : 0;
    }
    const settled = restRun >= REST_STEPS;

    // Read the result from the recorded (float32) last frame: exactly what the replay will show.
    const last = (frame - 1) * stride;
    const landed: Face[] = [];
    const cocked: boolean[] = [];
    const issues: ThrowIssues = { cocked: 0, stacked: 0, moving: 0, escaped: 0 };
    for (let i = 0; i < count; i++) {
      const o = last + i * FRAME_STRIDE;
      const q: Quat = [buf[o + 3] ?? 0, buf[o + 4] ?? 0, buf[o + 5] ?? 0, buf[o + 6] ?? 1];
      const top = topFace(q);
      const isCocked = top.alignment < COCKED_THRESHOLD;
      // Resting on another die instead of the felt: readable, but looks wrong, so re-throw.
      const stacked = (buf[o + 1] ?? 0) > h + DIE_SIZE * 0.25;
      const moving = !settled && !atRest(bodies[i] as (typeof bodies)[number]);
      landed.push(top.face);
      cocked.push(isCocked);
      issues.cocked += Number(isCocked);
      issues.stacked += Number(stacked);
      issues.moving += Number(moving);
      issues.escaped += Number(escaped[i]);
    }
    const badness = issues.cocked * 8 + issues.moving * 4 + issues.stacked * 2 + issues.escaped;
    return { frames: buf.slice(0, frame * stride), steps: frame, landed, cocked, issues, badness };
  } finally {
    world.free();
  }
}

// ---------------------------------------------------------------- public API

/**
 * Pre-simulates a throw of `count` dice and returns the recorded transforms plus the face each die
 * physically landed on. Re-throws (perturbed seed) up to MAX_ATTEMPTS times while any die is
 * cocked, stacked, still moving, or bounced off a wall above its visible rim, then returns the
 * best attempt (cocked counts worst).
 */
export async function presimulateThrow({
  count,
  throwSeed,
  tray = DEFAULT_TRAY,
  obstacles = [],
  maxSteps = 360,
  dt = 1 / 60,
}: PresimOptions): Promise<PresimResult> {
  await initRapier();
  const t0 = performance.now();
  let best: Attempt | null = null;
  let attempts = 0;
  const rejected: ThrowIssues[] = [];
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    attempts++;
    const run = simulate(count, perturb(throwSeed, a), tray, obstacles, maxSteps, dt);
    if (!best || run.badness < best.badness) best = run;
    if (run.badness === 0) break;
    rejected.push(run.issues);
  }
  const b = best as Attempt;
  return {
    frames: b.frames,
    steps: b.steps,
    landed: b.landed,
    cocked: b.cocked,
    attempts,
    rejected,
    ms: performance.now() - t0,
  };
}
