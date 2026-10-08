// Pure throw math (no Rapier, React or three at runtime): turning a screen flick into a world-space
// throw for a camera, aim assist (ballistic solve + lerp), and analytic arcs for the aim preview
// and the no-physics fallback. Safe to import from Hud code and from Node scripts.
//
// Imports use relative `.ts` paths so `node scripts/throw-check.ts` runs this file unbundled.
import {
  BALL_MASS,
  BALL_RADIUS,
  COIN_BOUNCE,
  COIN_MASS,
  COIN_THICKNESS,
  DEFAULT_GLASS_POSITION,
  targetMouthRadius,
  targetMouthY,
  THROW_DT,
  THROW_FRAME_STRIDE,
  THROW_GRAVITY,
  THROW_SETUPS,
  type BounceModel,
  type ThrowKind,
  type ThrowSetup,
  type ThrowTarget,
  type Vec3,
} from './throwConfig.ts';
// Types only: the Rapier chunk is never pulled in from here.
import type { PresimThrowInput, PresimThrowOutput, ThrowResult } from './throwSim.ts';

// ---------------------------------------------------------------- basics

/** A throw before physics: where it leaves the hand and the impulse it gets. */
export interface RawThrow {
  kind: ThrowKind;
  origin: Vec3;
  impulse: Vec3;
}

export type AssistLevel = 0 | 1 | 2 | 3;

/**
 * How far aim assist pulls the impulse toward the ideal one (0 = raw, 1 = perfect), by kind and
 * level. Tuned with `pnpm throw:check` so that, for reasonable flicks, beer pong lands roughly
 * 20 / 40 / 60 / 85% and quarters 5 / 20 / 45 / 60% at levels 0–3 (a perfect coin throw still
 * misses now and then: the bounce varies from throw to throw).
 */
export const ASSIST_PULL: Readonly<Record<ThrowKind, Readonly<Record<AssistLevel, number>>>> = {
  ball: { 0: 0, 1: 0.25, 2: 0.47, 3: 0.75 },
  coin: { 0: 0, 1: 0.4, 2: 0.72, 3: 0.92 },
};

export const massOf = (kind: ThrowKind): number => (kind === 'ball' ? BALL_MASS : COIN_MASS);

export const toVelocity = (kind: ThrowKind, impulse: Vec3): Vec3 => {
  const m = massOf(kind);
  return [impulse[0] / m, impulse[1] / m, impulse[2] / m];
};

export const toImpulse = (kind: ThrowKind, velocity: Vec3): Vec3 => {
  const m = massOf(kind);
  return [velocity[0] * m, velocity[1] * m, velocity[2] * m];
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEG = Math.PI / 180;

/** Quaternion {x, y, z, w} of the rotation whose matrix columns are the unit axes X, Y, Z. */
export function quatFromBasis(
  X: Vec3,
  Y: Vec3,
  Z: Vec3,
): { x: number; y: number; z: number; w: number } {
  const [xx, xy, xz] = X;
  const [yx, yy, yz] = Y;
  const [zx, zy, zz] = Z;
  const tr = xx + yy + zz;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return { w: 0.25 * s, x: (yz - zy) / s, y: (zx - xz) / s, z: (xy - yx) / s };
  }
  if (xx > yy && xx > zz) {
    const s = Math.sqrt(1 + xx - yy - zz) * 2;
    return { w: (yz - zy) / s, x: 0.25 * s, y: (yx + xy) / s, z: (zx + xz) / s };
  }
  if (yy > zz) {
    const s = Math.sqrt(1 + yy - xx - zz) * 2;
    return { w: (zx - xz) / s, x: (yx + xy) / s, y: 0.25 * s, z: (zy + yz) / s };
  }
  const s = Math.sqrt(1 + zz - xx - yy) * 2;
  return { w: (xy - yx) / s, x: (zx + xz) / s, y: (zy + yz) / s, z: 0.25 * s };
}

/** Radius of the projectile's centre above the table when it lies flat on it. */
const restHeight = (kind: ThrowKind) => (kind === 'ball' ? BALL_RADIUS : COIN_THICKNESS / 2);

// ---------------------------------------------------------------- ballistics

export interface Crossing {
  point: Vec3;
  /** Seconds after the start. */
  t: number;
  /** Velocity at the crossing. */
  velocity: Vec3;
}

/** Where a ballistic flight from `p` with velocity `v` crosses the plane y = h going down. */
export function crossDown(p: Vec3, v: Vec3, h: number, g = THROW_GRAVITY): Crossing | null {
  // p.y + v.y t - g t² / 2 = h  →  the larger root is the descending crossing.
  const disc = v[1] * v[1] + 2 * g * (p[1] - h);
  if (disc < 0) return null;
  const t = (v[1] + Math.sqrt(disc)) / g;
  if (t < 0) return null;
  return {
    point: [p[0] + v[0] * t, h, p[2] + v[2] * t],
    t,
    velocity: [v[0], v[1] - g * t, v[2]],
  };
}

/**
 * Launch speed that carries a projectile from `origin` through `target` at a fixed elevation
 * (radians, + up), ignoring drag and bounces. Null when the elevation can't get there.
 */
export function solveLobSpeed(
  origin: Vec3,
  target: Vec3,
  elevation: number,
  g = THROW_GRAVITY,
): number | null {
  const d = Math.hypot(target[0] - origin[0], target[2] - origin[2]);
  const dy = target[1] - origin[1];
  const c = Math.cos(elevation);
  const denom = 2 * c * c * (d * Math.tan(elevation) - dy);
  if (d < 1e-6 || denom <= 0) return null;
  return Math.sqrt((g * d * d) / denom);
}

/** Velocity of the given speed/elevation heading horizontally from `from` toward `to`. */
export function aimVelocity(from: Vec3, to: Vec3, speed: number, elevation: number): Vec3 {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz) || 1;
  const h = speed * Math.cos(elevation);
  return [(dx / len) * h, speed * Math.sin(elevation), (dz / len) * h];
}

export interface CoinFlight {
  /** First impact with the felt. */
  bounce: Crossing;
  /** After the bounce: where it comes back down through the glass's rim height (null if too low). */
  arrive: Crossing | null;
}

/** Velocity just after a flat bounce on the felt (restitution + Coulomb friction). */
export function bounceVelocity(v: Vec3, model: BounceModel = COIN_BOUNCE): Vec3 {
  const vn = Math.max(0, -v[1]);
  const vt = Math.hypot(v[0], v[2]);
  const k = vt > 1e-9 ? Math.max(0, vt - model.friction * (1 + model.restitution) * vn) / vt : 0;
  return [v[0] * k, vn * model.restitution, v[2] * k];
}

/**
 * The coin's path in the simple bounce model: ballistic to the felt, one flat bounce
 * (bounceVelocity), ballistic again down through height `h`.
 */
export function coinFlight(
  origin: Vec3,
  v: Vec3,
  h = targetMouthY('coin'),
  g = THROW_GRAVITY,
  model: BounceModel = COIN_BOUNCE,
): CoinFlight | null {
  const bounce = crossDown(origin, v, restHeight('coin'), g);
  if (!bounce) return null;
  const after = bounceVelocity(bounce.velocity, model);
  const second = crossDown(bounce.point, after, h, g);
  return {
    bounce,
    arrive: second
      ? { point: second.point, t: bounce.t + second.t, velocity: second.velocity }
      : null,
  };
}

/**
 * Launch speed at a fixed (downward) elevation that bounces the coin once on the felt and drops it
 * through the middle of the glass at `glass` (bisection; distance grows with speed).
 */
export function solveCoinSpeed(
  origin: Vec3,
  glass: Vec3,
  elevation: number,
  g = THROW_GRAVITY,
  model: BounceModel = COIN_BOUNCE,
): number | null {
  const h = glass[1] + targetMouthY('coin');
  const goal = Math.hypot(glass[0] - origin[0], glass[2] - origin[2]);
  const reach = (speed: number) => {
    const f = coinFlight(origin, aimVelocity(origin, glass, speed, elevation), h, g, model);
    if (!f?.arrive) return -Infinity;
    return Math.hypot(f.arrive.point[0] - origin[0], f.arrive.point[2] - origin[2]);
  };
  let lo = 0.5;
  let hi = 30;
  if (reach(hi) < goal) return null;
  if (reach(lo) === -Infinity) {
    // The slowest speed whose bounce clears the rim at all.
    let a = lo;
    let b = hi;
    for (let i = 0; i < 40; i++) {
      const mid = (a + b) / 2;
      if (reach(mid) === -Infinity) a = mid;
      else b = mid;
    }
    lo = b;
  }
  if (reach(lo) > goal) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid) < goal) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Where a throw would arrive at its targets' opening height (ignoring obstacles): the descending
 * crossing for a ball, the post-bounce crossing for a coin. Null if it never gets there.
 */
export function predictArrival(raw: RawThrow, mouthBase = 0): Vec3 | null {
  const v = toVelocity(raw.kind, raw.impulse);
  const h = mouthBase + targetMouthY(raw.kind);
  if (raw.kind === 'ball') return crossDown(raw.origin, v, h)?.point ?? null;
  const f = coinFlight(raw.origin, v, h);
  return f?.arrive?.point ?? f?.bounce.point ?? null;
}

// ---------------------------------------------------------------- aim assist

export interface AssistedThrow extends RawThrow {
  level: AssistLevel;
  /** The target the assist pulled toward (null at level 0 or with no standing targets). */
  targetId: string | null;
  /** The ideal impulse for that target (what level "∞" would throw). */
  ideal: Vec3 | null;
}

/**
 * Nudges a raw throw toward the nearest standing target's ideal arc. The nearest target is the
 * one closest to where the raw throw would arrive; its ideal impulse is solved ballistically
 * (ignoring bounces; for the coin, through the single bounce it needs) at the raw throw's own
 * elevation and aimed straight at it, then the raw impulse is lerped toward it by ASSIST_PULL.
 * Level 0 returns the raw throw unchanged.
 */
export function aimAssist(
  level: AssistLevel,
  raw: RawThrow,
  targets: readonly ThrowTarget[],
): AssistedThrow {
  const plain: AssistedThrow = { ...raw, level, targetId: null, ideal: null };
  if (level === 0 || targets.length === 0) return plain;
  const v = toVelocity(raw.kind, raw.impulse);
  const speed = Math.hypot(v[0], v[1], v[2]);
  if (speed < 1e-6) return plain;
  const elevation = Math.atan2(v[1], Math.hypot(v[0], v[2]));

  // Nearest target to where it would arrive (or, if it never gets there, to its heading).
  const arrival = predictArrival(raw, targets[0]?.position[1] ?? 0);
  let best: ThrowTarget | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    let score: number;
    if (arrival) {
      score = Math.hypot(arrival[0] - t.position[0], arrival[2] - t.position[2]);
    } else {
      const dx = t.position[0] - raw.origin[0];
      const dz = t.position[2] - raw.origin[2];
      const heading = Math.atan2(v[0], -v[2]) - Math.atan2(dx, -dz);
      score =
        Math.abs(Math.atan2(Math.sin(heading), Math.cos(heading))) * 10 + Math.hypot(dx, dz) * 0.01;
    }
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (!best) return plain;

  const ideal = idealVelocity(raw.kind, raw.origin, best.position, elevation);
  if (!ideal) return { ...plain, targetId: best.id };
  const k = ASSIST_PULL[raw.kind][level];
  const out: Vec3 = [lerp(v[0], ideal[0], k), lerp(v[1], ideal[1], k), lerp(v[2], ideal[2], k)];
  return {
    ...raw,
    impulse: toImpulse(raw.kind, out),
    level,
    targetId: best.id,
    ideal: toImpulse(raw.kind, ideal),
  };
}

/**
 * The ideal release velocity from `origin` for a target standing at `base`: aimed straight at it,
 * at `elevation` if that can reach (else the kind's default launch angle), dropping the projectile
 * through the middle of the opening.
 */
export function idealVelocity(
  kind: ThrowKind,
  origin: Vec3,
  base: Vec3,
  elevation: number,
): Vec3 | null {
  const setupEl = THROW_SETUPS[kind].elevationDeg * DEG;
  if (kind === 'ball') {
    // Aim the centre a little below the rim plane so the ball is already dropping inside.
    const aim: Vec3 = [base[0], base[1] + targetMouthY('ball') - BALL_RADIUS * 0.25, base[2]];
    for (const el of [elevation, setupEl, 55 * DEG, 62 * DEG]) {
      const s = solveLobSpeed(origin, aim, el);
      if (s) return aimVelocity(origin, aim, s, el);
    }
    return null;
  }
  for (const el of [elevation, setupEl]) {
    const s = solveCoinSpeed(origin, base, el);
    if (s) return aimVelocity(origin, base, s, el);
  }
  return null;
}

// ---------------------------------------------------------------- flick → world

/** A finished (or in-progress) swipe, measured in screen space. */
export interface Flick {
  /** Unit direction of the release velocity on screen (x right, y down). */
  direction: [number, number];
  /** 0 … 1: release speed between the minimum flick and a very hard one. */
  power: number;
  /** Release speed in viewport heights per second. */
  speed: number;
  /** Where the swipe started and where it was released, normalised 0 … 1 (x right, y down). */
  start: [number, number];
  end: [number, number];
  /** Viewport width / height when it was measured. */
  aspect: number;
}

/** Anything shaped like a three.js PerspectiveCamera (position, quaternion, vertical fov in °). */
export interface CameraLike {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  fov: number;
}

type Q = CameraLike['quaternion'];

function rotate(q: Q, v: Vec3): Vec3 {
  // v' = q v q*  (expanded)
  const { x, y, z, w } = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

const conj = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** A camera at `position` looking at `target` (Y up), like three's Object3D.lookAt. */
export function lookAtCamera(position: Vec3, target: Vec3, fov: number): CameraLike {
  const zl =
    Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) || 1;
  const Z: Vec3 = [
    (position[0] - target[0]) / zl,
    (position[1] - target[1]) / zl,
    (position[2] - target[2]) / zl,
  ];
  // X = up × Z, Y = Z × X
  let X: Vec3 = [Z[2], 0, -Z[0]];
  const xl = Math.hypot(X[0], X[2]) || 1;
  X = [X[0] / xl, 0, X[2] / xl];
  const Y: Vec3 = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return {
    position: { x: position[0], y: position[1], z: position[2] },
    quaternion: quatFromBasis(X, Y, Z),
    fov,
  };
}

/** World ray through a normalised screen point. */
export function screenRay(
  camera: CameraLike,
  aspect: number,
  s: readonly [number, number],
): { o: Vec3; d: Vec3 } {
  const tanH = Math.tan((camera.fov * DEG) / 2);
  const local: Vec3 = [(2 * s[0] - 1) * tanH * aspect, (1 - 2 * s[1]) * tanH, -1];
  const d = rotate(camera.quaternion, local);
  const len = Math.hypot(d[0], d[1], d[2]);
  return {
    o: [camera.position.x, camera.position.y, camera.position.z],
    d: [d[0] / len, d[1] / len, d[2] / len],
  };
}

/** Normalised screen point (x right, y down) of a world point; null if behind the camera. */
export function projectToScreen(
  camera: CameraLike,
  aspect: number,
  p: Vec3,
): [number, number] | null {
  const rel: Vec3 = [p[0] - camera.position.x, p[1] - camera.position.y, p[2] - camera.position.z];
  const c = rotate(conj(camera.quaternion), rel);
  if (c[2] >= -1e-6) return null;
  const tanH = Math.tan((camera.fov * DEG) / 2);
  const nx = c[0] / -c[2] / (tanH * aspect);
  const ny = c[1] / -c[2] / tanH;
  return [(nx + 1) / 2, (1 - ny) / 2];
}

/** Where the ray through a screen point meets the plane y = h (null if it never does). */
export function screenToPlane(
  camera: CameraLike,
  aspect: number,
  s: readonly [number, number],
  h: number,
): Vec3 | null {
  const { o, d } = screenRay(camera, aspect, s);
  if (Math.abs(d[1]) < 1e-6) return null;
  const t = (h - o[1]) / d[1];
  if (t <= 0) return null;
  return [o[0] + d[0] * t, h, o[2] + d[2] * t];
}

export interface FlickMapOptions {
  setup?: ThrowSetup;
  /**
   * Depth (world Z) of what the player is aiming at: the swipe's screen direction is followed to
   * this row, so swiping toward a cup on screen throws toward that cup. Default: the middle of the
   * standing targets if given, else a rack / glass at the usual spot.
   */
  aimZ?: number;
  targets?: readonly ThrowTarget[];
  /** Max sideways angle of the throw (degrees). */
  maxYawDeg?: number;
}

/**
 * Maps a flick to a world-space throw for the given camera: the hand position follows where the
 * swipe started (clamped), the heading follows the swipe's direction on screen, and `power` picks
 * the launch speed at the kind's fixed launch angle.
 */
export function flickToThrow(
  flick: Flick,
  camera: CameraLike,
  kind: ThrowKind,
  opts: FlickMapOptions = {},
): RawThrow {
  const setup = opts.setup ?? THROW_SETUPS[kind];
  const aspect = flick.aspect;
  const handHit = screenToPlane(camera, aspect, flick.start, setup.handY);
  const hx = clamp(handHit ? handHit[0] : 0, -setup.handMaxX, setup.handMaxX);
  const origin: Vec3 = [hx, setup.handY, setup.handZ];

  const ts = opts.targets ?? [];
  const aimZ =
    opts.aimZ ??
    (ts.length
      ? ts.reduce((s, t) => s + t.position[2], 0) / ts.length
      : kind === 'ball'
        ? -0.65
        : DEFAULT_GLASS_POSITION[2]);
  const aimY = kind === 'ball' ? targetMouthY('ball') : 0;

  // Follow the swipe (from where it started, in aspect-correct screen units) up to the aim row.
  const ref = projectToScreen(camera, aspect, [hx, aimY, aimZ]);
  let dx = flick.direction[0];
  let dy = flick.direction[1];
  const maxScreenAngle = 70 * DEG;
  const ang = clamp(Math.atan2(dx, -dy), -maxScreenAngle, maxScreenAngle);
  dx = Math.sin(ang);
  dy = -Math.cos(ang);
  let heading: Vec3 = [0, 0, -1];
  if (ref && ref[1] < flick.start[1]) {
    const lambda = (ref[1] - flick.start[1]) / dy; // in screen-height units
    const sx = flick.start[0] + (dx * lambda) / aspect;
    const aimPt = screenToPlane(camera, aspect, [sx, ref[1]], aimY);
    if (aimPt) heading = [aimPt[0] - origin[0], 0, aimPt[2] - origin[2]];
  } else {
    heading = [dx, 0, dy];
  }
  const maxYaw = (opts.maxYawDeg ?? 32) * DEG;
  const yaw = clamp(Math.atan2(heading[0], -heading[2]), -maxYaw, maxYaw);
  const speed = lerp(setup.minSpeed, setup.maxSpeed, clamp(flick.power, 0, 1));
  const el = setup.elevationDeg * DEG;
  const h = speed * Math.cos(el);
  const v: Vec3 = [Math.sin(yaw) * h, speed * Math.sin(el), -Math.cos(yaw) * h];
  return { kind, origin, impulse: toImpulse(kind, v) };
}

// ---------------------------------------------------------------- analytic paths

/**
 * Points along the throw's arc for an aim preview (the coin's path includes its one modelled
 * bounce). Ends where it reaches the felt, or — given targets — where it drops into an opening.
 */
export function ballisticPath(
  raw: RawThrow,
  count = 22,
  maxT = 1.6,
  targets: readonly ThrowTarget[] = [],
): Vec3[] {
  const v = toVelocity(raw.kind, raw.impulse);
  const g = THROW_GRAVITY;
  const pts: Vec3[] = [];
  let floorY = restHeight(raw.kind);
  if (raw.kind === 'ball' && targets.length) {
    const at = crossDown(raw.origin, v, targetMouthY('ball'), g)?.point;
    const r = targetMouthRadius('ball');
    if (at && targets.some((t) => Math.hypot(at[0] - t.position[0], at[2] - t.position[2]) < r)) {
      floorY = targetMouthY('ball');
    }
  }
  const firstEnd = crossDown(raw.origin, v, floorY, g);
  let segments: { p: Vec3; v: Vec3; t: number }[] = [{ p: raw.origin, v, t: firstEnd?.t ?? maxT }];
  if (raw.kind === 'coin' && firstEnd) {
    const f = coinFlight(raw.origin, v);
    if (f) {
      const after = bounceVelocity(f.bounce.velocity);
      const t2 = f.arrive
        ? f.arrive.t - f.bounce.t
        : (crossDown(f.bounce.point, after, restHeight('coin'), g)?.t ?? 0.3);
      segments = [
        { p: raw.origin, v, t: f.bounce.t },
        { p: f.bounce.point, v: after, t: t2 },
      ];
    }
  }
  const total = segments.reduce((s, x) => s + x.t, 0) || 1;
  for (let i = 0; i <= count; i++) {
    let t = (i / count) * Math.min(total, maxT);
    for (const s of segments) {
      if (t <= s.t || s === segments[segments.length - 1]) {
        pts.push([s.p[0] + s.v[0] * t, s.p[1] + s.v[1] * t - (g * t * t) / 2, s.p[2] + s.v[2] * t]);
        break;
      }
      t -= s.t;
    }
  }
  return pts;
}

/**
 * Stand-in for the physics when Rapier can't load: an analytic flight with no collisions. A ball
 * whose arc comes down through a cup's opening, or a coin whose modelled bounce does, counts as in.
 */
export function fallbackThrow(input: PresimThrowInput): PresimThrowOutput {
  const raw: RawThrow = { kind: input.kind, origin: input.origin, impulse: input.impulse };
  const v = toVelocity(raw.kind, raw.impulse);
  const mouthR = targetMouthRadius(raw.kind);
  const arrival = predictArrival(raw, input.targets[0]?.position[1] ?? 0);
  const inTarget = arrival
    ? (input.targets.find(
        (t) => Math.hypot(arrival[0] - t.position[0], arrival[2] - t.position[2]) < mouthR * 0.8,
      ) ?? null)
    : null;
  const path = ballisticPath(raw, 60);
  const steps = path.length;
  const frames = new Float32Array(steps * THROW_FRAME_STRIDE);
  path.forEach((p, i) => frames.set([p[0], p[1], p[2], 0, 0, 0, 1], i * THROW_FRAME_STRIDE));
  const bounced = raw.kind === 'coin';
  const result: ThrowResult =
    raw.kind === 'ball'
      ? { kind: 'ball', hit: inTarget?.id ?? null, bounces: 0 }
      : {
          kind: 'coin',
          made: inTarget !== null,
          bounced,
          target: inTarget?.id ?? null,
          bounces: bounced ? 1 : 0,
        };
  const flight = crossDown(raw.origin, v, 0)?.t ?? 1;
  return {
    frames,
    steps,
    dt: Math.max(THROW_DT[raw.kind], Math.min(flight, 1.6) / Math.max(steps - 1, 1)),
    result,
    resolvedStep: steps - 1,
    end: 'resolved',
    rest: path[steps - 1] ?? raw.origin,
    ms: 0,
  };
}
