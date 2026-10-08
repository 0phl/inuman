// Shared dimensions and tuning for the skill-game throws (Beer Pong, Quarters). No Rapier, React or
// three here: the visual props (src/three/Cup3D, ShotGlass3D, Ball3D, Coin3D), the pure aim math
// (throwMath.ts) and the Rapier pre-sim (throwSim.ts) all read the same numbers, so the colliders
// always match what is drawn.
//
// World units: 1 unit ≈ 25 cm (ENV_SCALE = 4 units per metre), table top at y = 0, +Z toward the
// player/camera. Real objects are scaled by the same factor as the baked bar.

export type Vec3 = [number, number, number];
export type ThrowKind = 'ball' | 'coin';

/** Units per metre (mirrors ENV_SCALE in src/stage/tableSpace.ts; kept here so Node can run it). */
export const UNITS_PER_METRE = 4;
const m = (metres: number) => metres * UNITS_PER_METRE;

/** Gravity for throws (units/s²). Real gravity at this scale is 39; a bit floatier reads better. */
export const THROW_GRAVITY = 27;
/**
 * Physics step (s) by kind; frames are recorded every step. The ball and the thin cup walls are
 * fine at 120 Hz; the 2.4 mm coin slammed at the felt needs 240 Hz to bounce cleanly.
 */
export const THROW_DT: Readonly<Record<ThrowKind, number>> = { ball: 1 / 120, coin: 1 / 240 };
/** Hard cap on simulated time (s). */
export const THROW_MAX_SECONDS = 4;
/** Floats per recorded frame: px, py, pz, qx, qy, qz, qw (same layout as the dice frames). */
export const THROW_FRAME_STRIDE = 7;

// ---------------------------------------------------------------- table

/** The playing surface the projectile bounces on, centred on the origin, top at y = 0. */
export interface ThrowTable {
  /** Width along X (world units). */
  width: number;
  /** Depth along Z (world units). */
  depth: number;
}

/** The baked bar's table top (1.3 × 0.9 m): the ball or coin falls off past these edges. */
export const DEFAULT_THROW_TABLE: Readonly<ThrowTable> = { width: 5.2, depth: 3.6 };

// ---------------------------------------------------------------- ping-pong ball (40 mm)

export const BALL_RADIUS = m(0.02);
/** 2.7 g. Impulses are mass × velocity in these units. */
export const BALL_MASS = 0.0027;

// ---------------------------------------------------------------- 16 oz party cup

/** Height of the cup (12 cm). Origin of a cup = centre of its base, on the table. */
export const CUP_HEIGHT = m(0.12);
/** Outer radius at the base (6 cm across) and just under the rolled rim (9.4 cm across). */
export const CUP_BOTTOM_RADIUS = m(0.03);
export const CUP_TOP_RADIUS = m(0.047);
/**
 * Wall thickness, for colliders and the drawn wall alike. A real cup is ~0.5 mm; this is thicker
 * so a fast ball never tunnels, and still reads as a thin plastic lip from the camera.
 */
export const CUP_WALL = m(0.004);
/** Tube radius of the rolled white rim; its outer edge sits at CUP_TOP_RADIUS + CUP_RIM_TUBE. */
export const CUP_RIM_TUBE = m(0.0028);
/**
 * Beer level: the surface the ball floats on once it is in. Physically it is the cup's floor
 * collider (a ball that drops in stops here), visually an amber disc.
 */
export const CUP_BEER_LEVEL = m(0.065);
/** Centre-to-centre distance of touching cups in a rack (rim to rim). */
export const CUP_SPACING = 2 * (CUP_TOP_RADIUS + CUP_RIM_TUBE) + m(0.001);

/** Outer radius of the cup wall at height y (0 … CUP_HEIGHT). */
export const cupRadiusAt = (y: number): number =>
  CUP_BOTTOM_RADIUS +
  ((CUP_TOP_RADIUS - CUP_BOTTOM_RADIUS) * Math.min(Math.max(y, 0), CUP_HEIGHT)) / CUP_HEIGHT;

// ---------------------------------------------------------------- coin (generic 27 mm token)

export const COIN_RADIUS = m(0.0135);
export const COIN_THICKNESS = m(0.0024);
/** 6 g. */
export const COIN_MASS = 0.006;

// ---------------------------------------------------------------- shot glass

/** A heavy-based 2 oz shot glass. Origin = centre of its base, on the table. */
export const GLASS_HEIGHT = m(0.062);
export const GLASS_BOTTOM_RADIUS = m(0.0235);
export const GLASS_TOP_RADIUS = m(0.0285);
export const GLASS_WALL = m(0.0028);
/** The thick glass base; the inside floor is at this height. */
export const GLASS_BASE = m(0.014);

/** Outer radius of the glass wall at height y. */
export const glassRadiusAt = (y: number): number =>
  GLASS_BOTTOM_RADIUS +
  ((GLASS_TOP_RADIUS - GLASS_BOTTOM_RADIUS) * Math.min(Math.max(y, 0), GLASS_HEIGHT)) /
    GLASS_HEIGHT;

// ---------------------------------------------------------------- targets

/** A cup (kind 'ball') or the shot glass (kind 'coin') standing on the table. */
export interface ThrowTarget {
  id: string;
  /** Centre of its base, on the table (y is normally 0). */
  position: Vec3;
}

/** Height of the opening a projectile has to drop through, by kind. */
export const targetMouthY = (kind: ThrowKind): number =>
  kind === 'ball' ? CUP_HEIGHT : GLASS_HEIGHT;
/** Inner radius of the opening, by kind. */
export const targetMouthRadius = (kind: ThrowKind): number =>
  kind === 'ball' ? CUP_TOP_RADIUS - CUP_WALL : GLASS_TOP_RADIUS - GLASS_WALL;

// ---------------------------------------------------------------- beer-pong racks

/** Standard formations (cups per row, front → back). */
export const RACK_FORMATIONS = {
  /** 4-3-2-1 triangle. */
  10: [1, 2, 3, 4],
  /** 3-2-1 triangle (the usual re-rack at 6). */
  6: [1, 2, 3],
  /** 1-2-1 diamond. */
  4: [1, 2, 1],
  /** 2-1 triangle. */
  3: [1, 2],
  /** "Zipper": two cups in a line, front to back. */
  2: [1, 1],
  1: [1],
} as const satisfies Record<number, readonly number[]>;

export type RackSize = keyof typeof RACK_FORMATIONS;

/**
 * Cup base positions for a formation, apex toward the thrower (+Z). `front` is the Z of the front
 * (apex) cup; rows go back (-Z), cups touching. Ids are `${prefix}${index}` front-to-back,
 * left-to-right.
 */
export function rackLayout(
  size: RackSize,
  { x = 0, front = -0.2, prefix = 'cup-' }: { x?: number; front?: number; prefix?: string } = {},
): ThrowTarget[] {
  const rows = RACK_FORMATIONS[size];
  const rowStep = (CUP_SPACING * Math.sqrt(3)) / 2;
  const out: ThrowTarget[] = [];
  rows.forEach((n, r) => {
    // The diamond and the zipper keep cups touching their neighbours in the row before.
    const step = size === 2 ? CUP_SPACING : rowStep;
    for (let i = 0; i < n; i++) {
      out.push({
        id: `${prefix}${out.length}`,
        position: [x + (i - (n - 1) / 2) * CUP_SPACING, 0, front - r * step],
      });
    }
  });
  return out;
}

/**
 * World targets from rack slots given in cup diameters (origin at the front cup, +x to the
 * thrower's right, +y away from the thrower), e.g. FORMATION_SLOTS from the beer-pong rules.
 * `ids[i]` names slot i (default `${prefix}${i}`).
 */
export function slotsToTargets(
  slots: readonly { x: number; y: number }[],
  {
    x = 0,
    front = -0.2,
    prefix = 'cup-',
    ids,
  }: { x?: number; front?: number; prefix?: string; ids?: readonly string[] } = {},
): ThrowTarget[] {
  return slots.map((s, i) => ({
    id: ids?.[i] ?? `${prefix}${i}`,
    position: [x + s.x * CUP_SPACING, 0, front - s.y * CUP_SPACING],
  }));
}

/** The re-rack formation for `remaining` cups, or null when the standard rules keep them as is. */
export function reRackSize(remaining: number): RackSize | null {
  if (remaining === 6 || remaining === 4 || remaining === 3 || remaining === 2 || remaining === 1)
    return remaining;
  return null;
}

// ---------------------------------------------------------------- launch setups

/**
 * How a flick becomes a throw for each kind: where the hand releases it, the fixed launch angle,
 * and the speed range that `power` 0 … 1 spans.
 */
export interface ThrowSetup {
  /** Release height and depth of the hand (world units). */
  handY: number;
  handZ: number;
  /** How far left/right the hand follows where the swipe started (world units, ±). */
  handMaxX: number;
  /** Launch elevation in degrees (+ up: a lob; − down: thrown at the table). */
  elevationDeg: number;
  /** Launch speed for power 0 and power 1 (units/s). */
  minSpeed: number;
  maxSpeed: number;
}

export const THROW_SETUPS: Readonly<Record<ThrowKind, ThrowSetup>> = {
  // A lob from just above the near edge to a rack ~2.1–3.3 units away.
  ball: { handY: 0.9, handZ: 1.95, handMaxX: 0.5, elevationDeg: 47, minSpeed: 4.8, maxSpeed: 10.2 },
  // Slammed down at the felt so it bounces up into the glass.
  coin: {
    handY: 0.62,
    handZ: 1.0,
    handMaxX: 0.35,
    elevationDeg: -52,
    minSpeed: 3.5,
    maxSpeed: 9.5,
  },
};

/** Default quarters glass position for the dev bench and the game scene. */
export const DEFAULT_GLASS_POSITION: Vec3 = [0, 0, -0.35];

/**
 * Coin-on-felt bounce, as the pure aim math models it (fitted to throwSim; see throw-check):
 * vertical speed × −restitution, and Coulomb friction takes up to friction × (1 + e) × |vn| off
 * the horizontal speed.
 */
export const COIN_BOUNCE = { restitution: 0.55, friction: 0.05 } as const;
export type BounceModel = { restitution: number; friction: number };
