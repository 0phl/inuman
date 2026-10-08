// Headless, deterministic projectile pre-simulation for the skill games (Rapier, no React/three).
// The player's flick (plus aim assist) becomes an origin + impulse; this simulates the throw once,
// records every step, and reports what physically happened. The replay (ThrowReplay.tsx) then
// plays the recording back at real time, and the game dispatches the result as an action.
//
// Beer Pong: a 40 mm ping-pong ball (light, lively, CCD) at plastic cups built from a ring of thin
//   wall boxes and a beer-level floor; a sensor sits just above the beer in every cup.
// Quarters: a coin (thin cylinder, CCD) slammed at the felt so it bounces into a heavy shot glass
//   with a sensor on its inside floor.
//
// Imports use relative `.ts` paths so `node scripts/throw-check.ts` runs this file unbundled.
import { initRapier, mixSeed, mulberry32, RAPIER } from './rapierRuntime.ts';
import { bounceVelocity, quatFromBasis } from './throwMath.ts';
import {
  BALL_MASS,
  BALL_RADIUS,
  COIN_BOUNCE,
  COIN_MASS,
  COIN_RADIUS,
  COIN_THICKNESS,
  CUP_BEER_LEVEL,
  CUP_BOTTOM_RADIUS,
  CUP_HEIGHT,
  CUP_TOP_RADIUS,
  CUP_WALL,
  cupRadiusAt,
  DEFAULT_THROW_TABLE,
  GLASS_BASE,
  GLASS_BOTTOM_RADIUS,
  GLASS_HEIGHT,
  GLASS_TOP_RADIUS,
  GLASS_WALL,
  glassRadiusAt,
  targetMouthRadius,
  targetMouthY,
  THROW_DT,
  THROW_FRAME_STRIDE,
  THROW_GRAVITY,
  THROW_MAX_SECONDS,
  type ThrowKind,
  type ThrowTable,
  type ThrowTarget,
  type Vec3,
} from './throwConfig.ts';

export { initRapier };

export interface PresimThrowInput {
  kind: ThrowKind;
  /** Release position of the ball/coin centre (world units). */
  origin: Vec3;
  /** Linear impulse at release (mass × velocity; BALL_MASS / COIN_MASS). */
  impulse: Vec3;
  /** Standing cups (kind 'ball') or the shot glass (kind 'coin'). Removed cups are left out. */
  targets: readonly ThrowTarget[];
  table?: ThrowTable;
  /** Any 32-bit integer: seeds the release spin/tilt. Same seed + inputs = same throw. */
  seed: number;
  /** Override the release angular velocity (rad/s); default: a small seeded spin. */
  spin?: Vec3;
  maxSteps?: number;
  /** Physics step (s); default THROW_DT[kind]. Frames are recorded every step. */
  dt?: number;
}

export interface BallThrowResult {
  kind: 'ball';
  /** Id of the cup the ball dropped into, or null for a miss. */
  hit: string | null;
  /** Times the ball bounced on the table before going in (or in total, for a miss). */
  bounces: number;
}

export interface CoinThrowResult {
  kind: 'coin';
  /** The coin ended up inside the glass. */
  made: boolean;
  /** The coin touched the table before entering the glass (for a miss: touched it at all). */
  bounced: boolean;
  /** Id of the glass it went into (null for a miss). */
  target: string | null;
  bounces: number;
}

export type ThrowResult = BallThrowResult | CoinThrowResult;

/** Why the simulation stopped. */
export type ThrowEnd = 'resolved' | 'off-table' | 'rest' | 'cap';

export interface PresimThrowOutput {
  /** `steps` frames × THROW_FRAME_STRIDE floats (px, py, pz, qx, qy, qz, qw); frame 0 = release. */
  frames: Float32Array;
  steps: number;
  /** Seconds between frames (play back at this rate). */
  dt: number;
  result: ThrowResult;
  /** Frame at which the outcome was decided (entered a target / could no longer reach one). */
  resolvedStep: number;
  end: ThrowEnd;
  /** Centre of the ball/coin in the last frame. */
  rest: Vec3;
  /** Wall-clock time of the simulation (ms). */
  ms: number;
}

// ---------------------------------------------------------------- tuning

const WALL_SEGMENTS = { cup: 14, glass: 12 } as const;
/** Seconds the sim keeps running after a make (the ball settles on the beer) or a sure miss. */
const TAIL_HIT = 0.5;
const TAIL_MISS = 0.4;
/** At rest = below this speed (units/s) for REST_SECONDS in a row. */
const REST_SPEED = 0.06;
const REST_SECONDS = 0.15;
/** Table contacts closer together than this (s) are one bounce (a skid can flicker). */
const BOUNCE_DEBOUNCE = 0.035;
/** Below the table top by this much = it went over an edge. */
const FALL_Y = -0.5;
/** Contact skin of the coin (world units). */
const COIN_SKIN = 0.004;

const MATERIAL = {
  table: { friction: 0.45, restitution: 0.5 },
  cup: { friction: 0.35, restitution: 0.45 },
  glass: { friction: 0.2, restitution: 0.4 },
  ball: { friction: 0.3, restitution: 0.88 },
  coin: { friction: 0.05, restitution: 0.72 },
} as const;

// ---------------------------------------------------------------- geometry helpers

type Quat = { x: number; y: number; z: number; w: number };

/** Standard normal from a uniform source (Box–Muller). */
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/**
 * A tapered open tube as a ring of thin boxes (outer radius rBottom → rTop over [0, height]).
 * Each box's outer face lies on the drawn outer surface; boxes overlap slightly at the seams.
 */
function wallRing(
  segments: number,
  rBottom: number,
  rTop: number,
  height: number,
  wall: number,
): InstanceType<typeof RAPIER.ColliderDesc>[] {
  const lean = Math.atan2(rTop - rBottom, height);
  const sinB = Math.sin(lean);
  const cosB = Math.cos(lean);
  const slant = Math.hypot(height, rTop - rBottom);
  const rMid = (rBottom + rTop) / 2;
  const halfWidth = (rMid - wall / 2) * Math.tan(Math.PI / segments) * 1.12;
  const out: InstanceType<typeof RAPIER.ColliderDesc>[] = [];
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * Math.PI * 2;
    const nx = Math.sin(phi);
    const nz = Math.cos(phi);
    // Local X = tangent, Y = up the slanted wall, Z = outward wall normal.
    const t: Vec3 = [nz, 0, -nx];
    const s: Vec3 = [nx * sinB, cosB, nz * sinB];
    const w: Vec3 = [nx * cosB, -sinB, nz * cosB];
    const q = quatFromBasis(t, s, w);
    // Centre of the box: on the wall's mid-line, half a wall inside the outer surface.
    const rc = rMid - (wall / 2) * cosB;
    out.push(
      RAPIER.ColliderDesc.cuboid(halfWidth, slant / 2, wall / 2)
        .setTranslation(nx * rc, height / 2 + (wall / 2) * sinB, nz * rc)
        .setRotation(q),
    );
  }
  return out;
}

// ---------------------------------------------------------------- the simulation

/**
 * Pre-simulates one throw and returns the recorded frames plus the outcome. Synchronous once Rapier
 * is initialised (call `initRapier()` first, or use the async `presimThrow`).
 */
export function presimThrowSync({
  kind,
  origin,
  impulse,
  targets,
  table = DEFAULT_THROW_TABLE,
  seed,
  spin,
  maxSteps,
  dt = THROW_DT[kind],
}: PresimThrowInput): PresimThrowOutput {
  const t0 = performance.now();
  maxSteps ??= Math.round(THROW_MAX_SECONDS / dt);
  const g = THROW_GRAVITY;
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  const events = new RAPIER.EventQueue(true);
  try {
    world.timestep = dt;
    // Tolerances scaled to ball/coin-sized objects.
    world.lengthUnit = kind === 'ball' ? BALL_RADIUS * 2 : COIN_RADIUS * 2;

    // Table top (y = 0); off its edges the projectile falls.
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const tableCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(table.width / 2, 0.25, table.depth / 2)
        .setTranslation(0, -0.25, 0)
        .setFriction(MATERIAL.table.friction)
        .setRestitution(MATERIAL.table.restitution),
      fixed,
    );

    // Targets: cups or the glass, each a fixed body with walls, a floor and a sensor.
    const sensors = new Map<number, string>();
    for (const tg of targets) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(tg.position[0], tg.position[1], tg.position[2]),
      );
      const mat = kind === 'ball' ? MATERIAL.cup : MATERIAL.glass;
      if (kind === 'ball') {
        for (const d of wallRing(
          WALL_SEGMENTS.cup,
          CUP_BOTTOM_RADIUS,
          CUP_TOP_RADIUS,
          CUP_HEIGHT,
          CUP_WALL,
        ))
          world.createCollider(d.setFriction(mat.friction).setRestitution(mat.restitution), body);
        // The beer: a soft, dead floor the ball floats on.
        const beerR = cupRadiusAt(CUP_BEER_LEVEL) - CUP_WALL;
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(CUP_BEER_LEVEL / 2, beerR)
            .setTranslation(0, CUP_BEER_LEVEL / 2, 0)
            .setFriction(0.9)
            .setRestitution(0.02)
            .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
          body,
        );
        const sensorH = BALL_RADIUS * 1.2;
        const sensor = world.createCollider(
          RAPIER.ColliderDesc.cylinder(sensorH / 2, beerR - BALL_RADIUS * 0.15)
            .setTranslation(0, CUP_BEER_LEVEL + sensorH / 2, 0)
            .setSensor(true),
          body,
        );
        sensors.set(sensor.handle, tg.id);
      } else {
        for (const d of wallRing(
          WALL_SEGMENTS.glass,
          GLASS_BOTTOM_RADIUS,
          GLASS_TOP_RADIUS,
          GLASS_HEIGHT,
          GLASS_WALL,
        ))
          world.createCollider(d.setFriction(mat.friction).setRestitution(mat.restitution), body);
        // The heavy base.
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(GLASS_BASE / 2, glassRadiusAt(GLASS_BASE) - GLASS_WALL * 0.5)
            .setTranslation(0, GLASS_BASE / 2, 0)
            .setFriction(0.4)
            .setRestitution(0.15),
          body,
        );
        const sensorH = COIN_RADIUS * 1.1;
        const sensor = world.createCollider(
          RAPIER.ColliderDesc.cylinder(sensorH / 2, glassRadiusAt(GLASS_BASE) - GLASS_WALL - 0.004)
            .setTranslation(0, GLASS_BASE + sensorH / 2, 0)
            .setSensor(true),
          body,
        );
        sensors.set(sensor.handle, tg.id);
      }
    }

    // The projectile.
    const rand = mulberry32(mixSeed(seed, kind === 'ball' ? 11 : 23));
    const mass = kind === 'ball' ? BALL_MASS : COIN_MASS;
    const v = { x: impulse[0] / mass, y: impulse[1] / mass, z: impulse[2] / mass };
    const hSpeed = Math.hypot(v.x, v.z) || 1;
    // Unit horizontal axis perpendicular to the throw (spin axis for back/top spin).
    const side = { x: -v.z / hSpeed, z: v.x / hSpeed };
    let rot: Quat;
    let w: { x: number; y: number; z: number };
    if (kind === 'ball') {
      // Random logo orientation and a little backspin off the fingers.
      const u1 = rand();
      const u2 = rand() * Math.PI * 2;
      const u3 = rand() * Math.PI * 2;
      const a = Math.sqrt(1 - u1);
      const b = Math.sqrt(u1);
      rot = { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
      const back = 6 + rand() * 14;
      w = { x: side.x * back, y: (rand() - 0.5) * 4, z: side.z * back };
    } else {
      // Released nearly flat, with a seeded tilt and a lazy spin about its axis plus some wobble.
      const tilt = (rand() - 0.5) * 0.36;
      const ax = rand() * Math.PI * 2;
      const s = Math.sin(tilt / 2);
      rot = { x: Math.cos(ax) * s, y: 0, z: Math.sin(ax) * s, w: Math.cos(tilt / 2) };
      const flip = (rand() - 0.5) * 8;
      w = { x: side.x * flip, y: (rand() - 0.5) * 24, z: side.z * flip };
    }
    if (spin) w = { x: spin[0], y: spin[1], z: spin[2] };
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin[0], origin[1], origin[2])
        .setRotation(rot)
        .setLinvel(v.x, v.y, v.z)
        .setAngvel(w)
        // No air drag in flight: the analytic aim assist solves the same drag-free arc.
        .setLinearDamping(0)
        .setAngularDamping(kind === 'ball' ? 0.25 : 0.1)
        // Rapier's CCD clamps motion but loses the bounce; the small step (THROW_DT) and a
        // contact skin on the coin do the work, CCD stays on only as a tunnelling backstop.
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const projDesc =
      kind === 'ball'
        ? RAPIER.ColliderDesc.ball(BALL_RADIUS)
            .setFriction(MATERIAL.ball.friction)
            .setRestitution(MATERIAL.ball.restitution)
        : RAPIER.ColliderDesc.cylinder(COIN_THICKNESS / 2, COIN_RADIUS)
            .setFriction(MATERIAL.coin.friction)
            // A slick coin keeps most of its forward speed through the bounce.
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
            .setRestitution(MATERIAL.coin.restitution);
    const proj = world.createCollider(
      projDesc
        // The coin starts touching a little early (≈1 mm), so a hard slam barely dips into the felt.
        .setContactSkin(kind === 'coin' ? COIN_SKIN : 0)
        .setMass(mass)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Average)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );

    // ------------------------------------------------------------ step & record
    const stride = THROW_FRAME_STRIDE;
    const buf = new Float32Array((maxSteps + 1) * stride);
    let frame = 0;
    const record = () => {
      const p = body.translation();
      const q = body.rotation();
      const o = frame * stride;
      buf[o] = p.x;
      buf[o + 1] = p.y;
      buf[o + 2] = p.z;
      buf[o + 3] = q.x;
      buf[o + 4] = q.y;
      buf[o + 5] = q.z;
      buf[o + 6] = q.w;
      frame++;
    };

    const mouthY = targetMouthY(kind);
    const mouthR = targetMouthRadius(kind);
    const radius = kind === 'ball' ? BALL_RADIUS : COIN_RADIUS;
    /** Over the opening of a target (it may still drop in even if it is low now). */
    const overTarget = (x: number, z: number) =>
      targets.some(
        (tg) => Math.hypot(x - tg.position[0], z - tg.position[2]) < mouthR + radius * 0.25,
      );

    let hit: string | null = null;
    let bounces = 0;
    let bouncesAtHit = 0;
    let touchingTable = false;
    const debounce = Math.ceil(BOUNCE_DEBOUNCE / dt);
    const restSteps = Math.ceil(REST_SECONDS / dt);
    let lastTableEnd = -debounce - 1;
    let resolvedStep = -1;
    let tail = 0;
    let restRun = 0;
    let end: ThrowEnd = 'cap';

    // The coin's first slam on the felt is resolved with the same restitution + friction model the
    // aim assist solves (plus seeded hand-to-hand variation). Rapier's own restitution for a thin
    // flat cylinder depends on how deep it sank in the contact step, which makes the outcome jump
    // around for tiny input changes; a skill game wants it smooth. Rim and glass hits stay physical.
    const bounceNoise = {
      restitution: COIN_BOUNCE.restitution * (1 + gauss(rand) * 0.04),
      friction: COIN_BOUNCE.friction,
      yaw: gauss(rand) * 0.022,
      flip: (8 + rand() * 10) * (rand() < 0.5 ? -1 : 1),
    };
    let preStep = { x: 0, y: 0, z: 0 };
    let slam = false;

    record();
    for (let s = 1; s <= maxSteps; s++) {
      if (kind === 'coin' && bounces === 0) preStep = body.linvel();
      world.step(events);
      events.drainCollisionEvents((h1, h2, started) => {
        const other = h1 === proj.handle ? h2 : h2 === proj.handle ? h1 : -1;
        if (other < 0) return;
        if (other === tableCollider.handle) {
          if (started) {
            if (!touchingTable && s - lastTableEnd > debounce) {
              bounces++;
              if (kind === 'coin' && bounces === 1 && hit === null) slam = true;
            }
            touchingTable = true;
          } else {
            touchingTable = false;
            lastTableEnd = s;
          }
          return;
        }
        const id = sensors.get(other);
        if (started && id !== undefined && hit === null && resolvedStep < 0) {
          hit = id;
          bouncesAtHit = bounces;
          resolvedStep = s;
          tail = Math.round(TAIL_HIT / dt);
          // The cup accepts it: the beer swallows its speed and it settles on the surface.
          body.setLinearDamping(kind === 'ball' ? 7 : 3);
          body.setAngularDamping(kind === 'ball' ? 6 : 3);
        }
      });
      if (slam) {
        slam = false;
        const out = bounceVelocity([preStep.x, preStep.y, preStep.z], bounceNoise);
        const c = Math.cos(bounceNoise.yaw);
        const sn = Math.sin(bounceNoise.yaw);
        body.setLinvel(
          { x: out[0] * c - out[2] * sn, y: out[1], z: out[0] * sn + out[2] * c },
          true,
        );
        // Friction at the rim of the coin flips it end over end on the way up.
        const spinY = body.angvel().y;
        body.setAngvel(
          { x: side.x * bounceNoise.flip, y: spinY, z: side.z * bounceNoise.flip },
          true,
        );
        const at = body.translation();
        const floor = COIN_THICKNESS / 2 + COIN_SKIN * 0.5;
        if (at.y < floor) body.setTranslation({ x: at.x, y: floor, z: at.z }, true);
      }
      record();

      const p = body.translation();
      const lv = body.linvel();
      if (
        p.y < FALL_Y ||
        Math.abs(p.x) > table.width / 2 + 1 ||
        Math.abs(p.z) > table.depth / 2 + 1
      ) {
        if (resolvedStep < 0) resolvedStep = s;
        end = hit ? 'resolved' : 'off-table';
        break;
      }
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      restRun = speed < REST_SPEED ? restRun + 1 : 0;
      if (restRun >= restSteps) {
        if (resolvedStep < 0) resolvedStep = s;
        end = hit ? 'resolved' : 'rest';
        break;
      }
      if (resolvedStep < 0) {
        // A sure miss: even bouncing, it can no longer rise above an opening, and isn't over one.
        // (Height + vertical kinetic energy only ever drops: every bounce loses some.)
        const reach = p.y + (lv.y * lv.y) / (2 * g);
        if (reach < mouthY + radius * 0.2 && !overTarget(p.x, p.z)) {
          resolvedStep = s;
          tail = Math.round(TAIL_MISS / dt);
        }
      } else if (--tail <= 0) {
        end = 'resolved';
        break;
      }
    }
    if (resolvedStep < 0) resolvedStep = frame - 1;

    const lastO = (frame - 1) * stride;
    const rest: Vec3 = [buf[lastO] ?? 0, buf[lastO + 1] ?? 0, buf[lastO + 2] ?? 0];
    const result: ThrowResult =
      kind === 'ball'
        ? { kind: 'ball', hit, bounces: hit ? bouncesAtHit : bounces }
        : {
            kind: 'coin',
            made: hit !== null,
            bounced: (hit ? bouncesAtHit : bounces) > 0,
            target: hit,
            bounces: hit ? bouncesAtHit : bounces,
          };
    return {
      frames: buf.slice(0, frame * stride),
      steps: frame,
      dt,
      result,
      resolvedStep,
      end,
      rest,
      ms: performance.now() - t0,
    };
  } finally {
    events.free();
    world.free();
  }
}

/** Initialises Rapier if needed, then pre-simulates the throw (see presimThrowSync). */
export async function presimThrow(input: PresimThrowInput): Promise<PresimThrowOutput> {
  await initRapier();
  return presimThrowSync(input);
}
