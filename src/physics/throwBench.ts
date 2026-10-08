// Headless throw benchmark shared by `pnpm throw:check` (scripts/throw-check.ts) and the Vitest
// suite: synthetic flicks for a phone-sized camera → flickToThrow → aimAssist → presimThrow.
// Never imported by the app.
//
// Imports use relative `.ts` paths so the Node script runs this file unbundled.
import { mixSeed, mulberry32 } from './rapierRuntime.ts';
import {
  DEFAULT_GLASS_POSITION,
  rackLayout,
  THROW_SETUPS,
  type RackSize,
  type ThrowKind,
  type ThrowTarget,
  type Vec3,
} from './throwConfig.ts';
import {
  aimAssist,
  flickToThrow,
  idealVelocity,
  projectToScreen,
  screenToPlane,
  type AssistLevel,
  type CameraLike,
  type Flick,
} from './throwMath.ts';
import { presimThrowSync, type ThrowResult } from './throwSim.ts';

/**
 * - `reasonable`: a player trying for a cup (or the glass): swipes toward it on screen with a
 *   human wobble (σ 6°) and roughly the right strength (σ 0.1 power).
 * - `random`: any upward-ish swipe (±25° from straight up) at any strength (power 0.1 … 0.95).
 */
export type FlickProfile = 'reasonable' | 'random';

const DEG = Math.PI / 180;

/** Standard normal from a uniform source (Box–Muller). */
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** A synthetic flick (screen space) for the given camera and targets. */
export function syntheticFlick(
  r: () => number,
  profile: FlickProfile,
  kind: ThrowKind,
  camera: CameraLike,
  aspect: number,
  targets: readonly ThrowTarget[],
): Flick {
  const start: [number, number] = [0.32 + r() * 0.36, 0.8 + r() * 0.12];
  const setup = THROW_SETUPS[kind];
  if (profile === 'random' || targets.length === 0) {
    const ang = (r() * 2 - 1) * 25 * DEG;
    const direction: [number, number] = [Math.sin(ang), -Math.cos(ang)];
    const power = 0.1 + r() * 0.85;
    return {
      direction,
      power,
      speed: power,
      start,
      end: [start[0] + direction[0] * 0.2, start[1] - 0.2],
      aspect,
    };
  }
  const goal = targets[Math.floor(r() * targets.length)] as ThrowTarget;
  // Angle on screen from the finger to the target, plus a wobble.
  const aimY = kind === 'ball' ? 0.48 : 0;
  const onScreen = projectToScreen(camera, aspect, [goal.position[0], aimY, goal.position[2]]);
  const sx = onScreen ? (onScreen[0] - start[0]) * aspect : 0;
  const sy = onScreen ? onScreen[1] - start[1] : -1;
  const ang = Math.atan2(sx, -sy) + gauss(r) * 6 * DEG;
  const direction: [number, number] = [Math.sin(ang), -Math.cos(ang)];
  // Roughly the right strength: the ideal speed for that target from where the hand will be.
  const hand = screenToPlane(camera, aspect, start, setup.handY);
  const hx = Math.min(setup.handMaxX, Math.max(-setup.handMaxX, hand ? hand[0] : 0));
  const origin: Vec3 = [hx, setup.handY, setup.handZ];
  const ideal = idealVelocity(kind, origin, goal.position, setup.elevationDeg * DEG);
  const idealSpeed = ideal
    ? Math.hypot(ideal[0], ideal[1], ideal[2])
    : (setup.minSpeed + setup.maxSpeed) / 2;
  const idealPower = (idealSpeed - setup.minSpeed) / (setup.maxSpeed - setup.minSpeed);
  const power = Math.min(1, Math.max(0, idealPower + gauss(r) * 0.1));
  return {
    direction,
    power,
    speed: power,
    start,
    end: [start[0] + direction[0] * 0.2, start[1] - 0.2],
    aspect,
  };
}

export interface BenchOptions {
  kind: ThrowKind;
  level: AssistLevel;
  profile: FlickProfile;
  throws: number;
  seed: number;
  camera: CameraLike;
  aspect: number;
  /** Beer pong racks to cycle through (default 10, 6, 3). */
  racks?: readonly RackSize[];
}

export interface BenchReport {
  throws: number;
  /** Cups hit / coins made. */
  made: number;
  rate: number;
  /** Throws that bounced on the table first (of those made, for coins). */
  bounced: number;
  /** Presim wall-clock per throw (ms), in order. */
  ms: number[];
  /** Simulated flight length per throw (s). */
  seconds: number[];
  /** Per-rack make rate (beer pong). */
  byRack: Record<string, { throws: number; made: number }>;
  results: ThrowResult[];
}

/** Runs `throws` synthetic flicks through the full pipeline. Rapier must be initialised. */
export function runBench(o: BenchOptions): BenchReport {
  const r = mulberry32(mixSeed(o.seed, 7));
  const racks = o.racks ?? [10, 6, 3];
  const report: BenchReport = {
    throws: 0,
    made: 0,
    rate: 0,
    bounced: 0,
    ms: [],
    seconds: [],
    byRack: {},
    results: [],
  };
  for (let i = 0; i < o.throws; i++) {
    const rack = racks[i % racks.length] as RackSize;
    const targets: ThrowTarget[] =
      o.kind === 'ball'
        ? rackLayout(rack)
        : [{ id: 'glass', position: [...DEFAULT_GLASS_POSITION] }];
    const flick = syntheticFlick(r, o.profile, o.kind, o.camera, o.aspect, targets);
    const raw = flickToThrow(flick, o.camera, o.kind, { targets });
    const thrown = aimAssist(o.level, raw, targets);
    const out = presimThrowSync({
      kind: o.kind,
      origin: thrown.origin,
      impulse: thrown.impulse,
      targets,
      seed: mixSeed(o.seed, i),
    });
    const made = out.result.kind === 'ball' ? out.result.hit !== null : out.result.made;
    const key = o.kind === 'ball' ? String(rack) : 'glass';
    const slot = (report.byRack[key] ??= { throws: 0, made: 0 });
    slot.throws++;
    report.throws++;
    if (made) {
      slot.made++;
      report.made++;
    }
    if (out.result.kind === 'coin' ? made && out.result.bounced : out.result.bounces > 0)
      report.bounced++;
    report.ms.push(out.ms);
    report.seconds.push((out.steps - 1) * out.dt);
    report.results.push(out.result);
  }
  report.rate = report.made / Math.max(1, report.throws);
  return report;
}

export const quantile = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};
