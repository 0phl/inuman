import {
  FORMATION_SLOTS,
  type Cup,
  type Formation,
  type Team,
  type View,
} from '@/core/games/beer-pong/logic';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import {
  CUP_SPACING,
  THROW_SETUPS,
  type ThrowKind,
  type ThrowTarget,
  type Vec3,
} from '@/physics/throwConfig';
import { idealVelocity, toImpulse, type RawThrow } from '@/physics/throwMath';

// Beer Pong table layout, shared by the Scene (three) and the Hud (DOM, no three): where each rack
// stands, the physics targets of the rack being shot at, and the accessible "Tumira" throw.
//
// A rack is laid out in its own frame: origin at the front (apex) cup, rows going to local −Z
// (away from its thrower), x as in FORMATION_SLOTS. The rack being shot at stands at the far end
// with its apex toward the camera (yaw 0). The throwing team's own rack is "behind the camera" at
// the thrower's end, out of the shot, so the table stays clear: when the turn passes, the far rack
// slides down the table toward the players and off, while the other team's rack slides in from
// the near edge, turning round, to the far end.

/** Apex (front cup) of the rack being shot at. The aim assist was tuned with the apex here. */
export const FAR_FRONT = -0.2;
/** Where a rack leaves (or joins) the table at the near edge, turned round toward the far end. */
const NEAR_FRONT = 1.3;
/** The defending team's name placard stands on the felt beside its rack, clear of the throws. */
export const PLACARD: Readonly<{ x: number; z: number; yaw: number }> = {
  x: -0.84,
  z: -0.32,
  yaw: 0.32,
};

/** Team colours: rims, plaques, glows, HUD pills. 0 = Team Pula, 1 = Team Asul. */
export const TEAM_COLORS = [
  { rim: '#ff2a12', emissive: '#b81400', glow: '#ff5a3a', hud: '#ef5b40' },
  { rim: '#1f5cff', emissive: '#0a36d0', glow: '#3d8cff', hud: '#4f93f5' },
] as const;

export type RackSide = 'far' | 'near';

/** A rack pose on the table: the apex position, the yaw of its frame, and its size (0 = gone). */
export interface RackPose {
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Local (rack frame) position of a slot: [x, 0, z]. */
export function slotLocal(formation: Formation, slot: number): Vec3 {
  const s = FORMATION_SLOTS[formation][slot] ?? { x: 0, y: 0 };
  return [s.x * CUP_SPACING, 0, -s.y * CUP_SPACING];
}

/** Front-to-back depth of a formation (apex to the back row's centres). */
export function rackDepth(formation: Formation): number {
  return Math.max(0, ...FORMATION_SLOTS[formation].map((s) => s.y)) * CUP_SPACING;
}

/** Centroid of the cups standing in a rack, in its own frame (for turning it about its middle). */
export function rackCentroid(formation: Formation, cups: readonly Cup[]): [number, number] {
  if (cups.length === 0) return [0, -rackDepth(formation) / 2];
  let x = 0;
  let z = 0;
  for (const c of cups) {
    const p = slotLocal(formation, c.slot);
    x += p[0];
    z += p[2];
  }
  return [x / cups.length, z / cups.length];
}

export function rackPose(side: RackSide): RackPose {
  return side === 'far'
    ? { x: 0, z: FAR_FRONT, yaw: 0, scale: 1 }
    : { x: 0, z: NEAR_FRONT, yaw: Math.PI, scale: 0 };
}

/** A point of the rack frame in the world, for a rack at `pose`. */
export function rackToWorld(pose: Omit<RackPose, 'scale'> & { scale?: number }, local: Vec3): Vec3 {
  const k = pose.scale ?? 1;
  const c = Math.cos(pose.yaw) * k;
  const s = Math.sin(pose.yaw) * k;
  return [pose.x + local[0] * c + local[2] * s, local[1] * k, pose.z - local[0] * s + local[2] * c];
}

/** Physics target ids: `bp:<team>:<cupId>`. */
export const targetId = (team: TeamIndex, cupId: number): string => `bp:${team}:${cupId}`;

/** The team and cup a hit target id names, or null for anything else. */
export function parseTargetId(id: string): { team: TeamIndex; cupId: number } | null {
  const m = /^bp:([01]):(\d+)$/.exec(id);
  if (!m) return null;
  return { team: Number(m[1]) as TeamIndex, cupId: Number(m[2]) };
}

/** The standing cups of the rack being shot at, as world-space physics targets. */
export function defendingTargets(view: Pick<View, 'teams' | 'defending'>): ThrowTarget[] {
  const d = view.defending;
  const team: Team = view.teams[d];
  const pose = rackPose('far');
  return team.cups.map((c) => ({
    id: targetId(d, c.id),
    position: rackToWorld(pose, slotLocal(team.formation, c.slot)),
  }));
}

/** The cup nearest the thrower (largest z), middle-most on a tie: what "Tumira" aims at. */
export function frontTarget(targets: readonly ThrowTarget[]): ThrowTarget | null {
  let best: ThrowTarget | null = null;
  for (const t of targets) {
    if (
      !best ||
      t.position[2] > best.position[2] + 1e-6 ||
      (Math.abs(t.position[2] - best.position[2]) <= 1e-6 &&
        Math.abs(t.position[0]) < Math.abs(best.position[0]))
    )
      best = t;
  }
  return best;
}

/** Where the ball (or coin) waits in the hand between throws. */
export const handPosition = (kind: ThrowKind): Vec3 => [
  0,
  THROW_SETUPS[kind].handY,
  THROW_SETUPS[kind].handZ,
];

const DEG = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The accessible throw ("Tumira"): from the middle of the hand line straight at `target`, at the
 * kind's launch angle, with `power` 0 … 1 picking the speed like a flick does. Aim assist is
 * applied afterwards by the caller, exactly as for a swipe.
 */
export function aimedThrow(kind: ThrowKind, target: Vec3, power: number): RawThrow {
  const setup = THROW_SETUPS[kind];
  const origin = handPosition(kind);
  const yaw = Math.atan2(target[0] - origin[0], -(target[2] - origin[2]));
  const speed = setup.minSpeed + (setup.maxSpeed - setup.minSpeed) * clamp(power, 0, 1);
  const el = setup.elevationDeg * DEG;
  const h = speed * Math.cos(el);
  return {
    kind,
    origin,
    impulse: toImpulse(kind, [Math.sin(yaw) * h, speed * Math.sin(el), -Math.cos(yaw) * h]),
  };
}

/** The power (0 … 1) whose aimed throw is ideal for `target`, or null if none reaches it. */
export function idealPower(kind: ThrowKind, target: Vec3): number | null {
  const setup = THROW_SETUPS[kind];
  const v = idealVelocity(kind, handPosition(kind), target, setup.elevationDeg * DEG);
  if (!v) return null;
  const speed = Math.hypot(v[0], v[1], v[2]);
  const p = (speed - setup.minSpeed) / (setup.maxSpeed - setup.minSpeed);
  return p >= 0 && p <= 1 ? p : null;
}

/** Seed for a throw's release spin: the game's start time mixed with the throw's number. */
export function throwSeed(startedAt: number, n: number): number {
  let h = Math.imul((startedAt % 2147483647) ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(n, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

/** Hold-to-throw meter: power rises 0 → 1 over RISE_MS, then falls back, and so on. */
export const RISE_MS = 1100;

export function holdPower(heldMs: number): number {
  const k = Math.max(0, heldMs) / RISE_MS;
  const m = k % 2;
  return m <= 1 ? m : 2 - m;
}
