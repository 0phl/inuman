import type { Leg } from '@/core/games/flip-cup/logic';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import { CUP_HEIGHT, type Vec3 } from '@/physics/throwConfig';

// Flip Cup, the parts with no React or three: where the cups stand, how a gesture becomes the
// FLIP_ATTEMPT quality, and the scripted flip animation (the reducer has already decided the
// outcome; this only shows it).

// ---------------------------------------------------------------- layout

/** Where the leg being played is flipped: the middle of the table's near edge. */
export const FLIP_SPOT: Vec3 = [0, 0, 1.02];
/** The two team rows run along the table's sides, first leg at the front. */
export const ROW_X = 0.74;
const ROW_FRONT = 0.42;
const ROW_BACK = -1.05;
const ROW_STEP = 0.46;
/** Team name plaques stand behind the rows. */
export const PLAQUE_Z = ROW_BACK - 0.42;

/** Each team's legs in play order, as indices into `legs`. */
export function teamLegs(legs: readonly Leg[]): [number[], number[]] {
  const out: [number[], number[]] = [[], []];
  legs.forEach((l, i) => out[l.team].push(i));
  return out;
}

export interface Slot {
  x: number;
  z: number;
  /** Cups shrink a little when a long team needs the row packed tighter. */
  scale: number;
}

/** The row spot of every leg (by index into `legs`). Team 0 (Pula) on the left, 1 (Asul) right. */
export function rowSlots(legs: readonly Leg[]): Slot[] {
  const slots: Slot[] = [];
  const byTeam = teamLegs(legs);
  ([0, 1] as const).forEach((team: TeamIndex) => {
    const list = byTeam[team];
    const n = list.length;
    const step = n > 1 ? Math.min(ROW_STEP, (ROW_FRONT - ROW_BACK) / (n - 1)) : 0;
    const scale = n > 1 ? Math.max(0.5, Math.min(1, step / 0.44)) : 1;
    list.forEach((legIndex, i) => {
      slots[legIndex] = { x: team === 0 ? -ROW_X : ROW_X, z: ROW_FRONT - i * step, scale };
    });
  });
  return slots;
}

// ---------------------------------------------------------------- gesture quality

/** The sweet spot of a flip: a firm but not wild flick (Flick.power, 0 … 1). */
export const SWEET: Readonly<{ lo: number; hi: number }> = { lo: 0.35, hi: 0.6 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 1 inside the sweet spot, falling off to 0 for a limp (≤ 0.1) or wild (≥ 0.9) flick. */
export function powerScore(power: number): number {
  if (power < SWEET.lo) return clamp01(1 - (SWEET.lo - power) / 0.25);
  if (power > SWEET.hi) return clamp01(1 - (power - SWEET.hi) / 0.3);
  return 1;
}

/** Degrees off straight up of a screen direction (x right, y down). */
export const angleOffVertical = (direction: readonly [number, number]): number =>
  (Math.atan2(Math.abs(direction[0]), -direction[1]) * 180) / Math.PI;

/** 1 within 10° of straight up, 0 at 40° and beyond. */
export const directionScore = (deg: number): number => clamp01(1 - Math.max(0, deg - 10) / 30);

/** FLIP_ATTEMPT quality for a flick: the power score times the direction score. */
export function flickQuality(flick: {
  power: number;
  direction: readonly [number, number];
}): number {
  return powerScore(flick.power) * directionScore(angleOffVertical(flick.direction));
}

/** The tap meter's needle sweeps 0 → 1 → 0 over this long. */
export const NEEDLE_PERIOD_MS = 1500;

/** Needle position (0 … 1) this long after the meter started. */
export function needleAt(ms: number): number {
  const k = ((Math.max(0, ms) % NEEDLE_PERIOD_MS) / NEEDLE_PERIOD_MS) * 2;
  return k <= 1 ? k : 2 - k;
}

// ---------------------------------------------------------------- scripted flip

export type FlipKind = 'flip' | 'under' | 'over';

/**
 * How the outcome plays: a success flips and lands mouth down; a miss either doesn't turn far
 * enough and rocks back (a weak flick) or over-rotates onto its side (a good one that went long).
 */
export const flipKind = (success: boolean, quality: number): FlipKind =>
  success ? 'flip' : quality >= 0.55 ? 'over' : 'under';

/**
 * A cup pose about its middle: `y` is the height of the cup's centre (half its height above the
 * table when upright), `rx` the turn about the table edge (−π = upside down), `dx`/`dz` an offset.
 */
export interface CupPose {
  x: number;
  z: number;
  y: number;
  rx: number;
  rz: number;
}

const HALF = CUP_HEIGHT / 2;
/** Centre height of a party cup lying on its side. */
export const SIDE_Y = 0.165;

export const upright = (x: number, z: number, scale = 1): CupPose => ({
  x,
  z,
  y: HALF * scale,
  rx: 0,
  rz: 0,
});
export const upsideDown = (x: number, z: number, scale = 1): CupPose => ({
  ...upright(x, z, scale),
  rx: -Math.PI,
});
export const onSide = (x: number, z: number, scale = 1): CupPose => ({
  x,
  z,
  y: SIDE_Y * scale,
  rx: -Math.PI / 2,
  rz: 0.12,
});

/** Seconds each scripted flip takes (reduced motion: a short version). */
export function flipDuration(kind: FlipKind, reduced: boolean): number {
  if (reduced) return kind === 'flip' ? 0.4 : 0.32;
  return kind === 'flip' ? 1.05 : kind === 'under' ? 1.05 : 1.55;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Where the flip leaves the cup (upright again after a miss; mouth down after a success). */
export function flipEnd(kind: FlipKind, spot: Vec3): CupPose {
  return kind === 'flip' ? upsideDown(spot[0], spot[2] - 0.1) : upright(spot[0], spot[2]);
}

/** The flipping cup's pose `t` seconds into its animation (clamped to the end pose). */
export function flipPose(kind: FlipKind, t: number, spot: Vec3, reduced: boolean): CupPose {
  const D = flipDuration(kind, reduced);
  const k = clamp01(t / D);
  const [x, , z] = spot;
  if (reduced) {
    if (kind === 'flip') {
      const e = easeInOut(k);
      return { x, z: z - 0.1 * e, y: HALF + 0.18 * Math.sin(Math.PI * k), rx: -Math.PI * e, rz: 0 };
    }
    return {
      x,
      z,
      y: HALF + 0.05 * Math.sin(Math.PI * k),
      rx: -0.45 * Math.sin(Math.PI * k),
      rz: 0,
    };
  }

  // A beat of anticipation: the lip dips as the finger hits it.
  const pre = seg(t, 0, 0.1);
  const dip = 0.14 * Math.sin(Math.PI * pre);

  if (kind === 'flip') {
    const f = seg(t, 0.1, 0.74);
    const e = easeInOut(f);
    const land = seg(t, 0.74, D);
    // Lands mouth down with a small bounce and a rock that dies out.
    const bounce = 0.035 * Math.abs(Math.sin(Math.PI * 2 * land)) * (1 - land);
    const rock = 0.1 * Math.sin(land * Math.PI * 3) * (1 - land);
    return {
      x,
      z: z - 0.1 * e,
      y: HALF + 0.46 * Math.sin(Math.PI * f) + bounce,
      rx: dip - Math.PI * e + (f >= 1 ? rock : 0),
      rz: 0.05 * Math.sin(Math.PI * f),
    };
  }

  if (kind === 'under') {
    const up = seg(t, 0.1, 0.42);
    const back = seg(t, 0.42, D);
    const turn = -1.2 * easeOut(up) * (1 - easeInOut(back));
    // Rocks back onto its base: a wobble that settles.
    const wobble = back > 0 ? 0.2 * Math.sin(back * Math.PI * 4) * (1 - back) : 0;
    return {
      x,
      z,
      y: HALF + 0.17 * Math.sin(Math.PI * Math.min(1, up * 0.5 + back * 0.5)) * (1 - back),
      rx: dip + turn + wobble,
      rz: 0.08 * wobble,
    };
  }

  // over: flies too far, lands on its side, rolls a little, then is stood back up.
  const fly = seg(t, 0.1, 0.72);
  const e = easeInOut(fly);
  const roll = seg(t, 0.72, 0.92);
  const reset = seg(t, 1.12, D);
  const side = onSide(x, z - 0.14);
  const flying: CupPose = {
    x: x + 0.06 * easeOut(roll),
    z: z - 0.14 * e,
    y: HALF + (SIDE_Y - HALF) * e + 0.5 * Math.sin(Math.PI * fly),
    rx: dip - Math.PI * 1.5 * e,
    rz: side.rz * easeOut(roll),
  };
  if (reset <= 0) return flying;
  // Set back up at the spot (−2π reads as upright).
  const r = easeInOut(reset);
  return {
    x: flying.x + (x - flying.x) * r,
    z: flying.z + (z - flying.z) * r,
    y: flying.y + (HALF - flying.y) * r + 0.12 * Math.sin(Math.PI * r),
    rx: flying.rx + (-2 * Math.PI - flying.rx) * r,
    rz: flying.rz * (1 - r),
  };
}

/** A pose between two others (for cups moving between their row and the flip spot). */
export function lerpPose(a: CupPose, b: CupPose, k: number, hop = 0.1): CupPose {
  const l = (p: number, q: number) => p + (q - p) * k;
  return {
    x: l(a.x, b.x),
    z: l(a.z, b.z),
    y: l(a.y, b.y) + hop * Math.sin(Math.PI * k),
    rx: l(a.rx, b.rx),
    rz: l(a.rz, b.rz),
  };
}

/** The base-centre position and tilt of a cup in `pose` (for CupInstances). */
export function poseToInstance(
  pose: CupPose,
  scale = 1,
): { position: Vec3; tilt: [number, number]; scale: number } {
  const h = HALF * scale;
  // Rotating about the cup's middle: the base sits h below it along the cup's own axis.
  const c = Math.cos(pose.rx);
  const s = Math.sin(pose.rx);
  return {
    position: [pose.x, pose.y - h * c, pose.z - h * s],
    tilt: [pose.rx, pose.rz],
    scale,
  };
}
