import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { rigPose } from '@/stage/cameraRig';
import {
  CUP_HEIGHT,
  CUP_SPACING,
  DEFAULT_GLASS_POSITION,
  GLASS_HEIGHT,
  rackLayout,
  RACK_FORMATIONS,
  slotsToTargets,
  THROW_SETUPS,
  type Vec3,
} from './throwConfig';
import {
  aimAssist,
  coinFlight,
  crossDown,
  flickToThrow,
  idealVelocity,
  lookAtCamera,
  predictArrival,
  projectToScreen,
  screenToPlane,
  solveCoinSpeed,
  solveLobSpeed,
  toImpulse,
  toVelocity,
  aimVelocity,
  type Flick,
} from './throwMath';

const ASPECT = 412 / 915;
const pose = rigPose(ASPECT);
const camera = lookAtCamera([...pose.position], [...pose.target], pose.fov);
const DEG = Math.PI / 180;

const flick = (over: Partial<Flick> = {}): Flick => ({
  direction: [0, -1],
  power: 0.55,
  speed: 2.5,
  start: [0.5, 0.86],
  end: [0.5, 0.7],
  aspect: ASPECT,
  ...over,
});

describe('ballistics', () => {
  it('solveLobSpeed + crossDown pass through the target', () => {
    const o: Vec3 = [0.1, 0.9, 1.95];
    const t: Vec3 = [-0.4, CUP_HEIGHT, -0.9];
    const el = 47 * DEG;
    const s = solveLobSpeed(o, t, el);
    expect(s).not.toBeNull();
    const hit = crossDown(o, aimVelocity(o, t, s as number, el), CUP_HEIGHT);
    expect(hit?.point[0]).toBeCloseTo(t[0], 6);
    expect(hit?.point[2]).toBeCloseTo(t[2], 6);
  });

  it('returns null when the elevation cannot reach', () => {
    expect(solveLobSpeed([0, 0.2, 0], [0, 2, -1], 10 * DEG)).toBeNull();
  });

  it('solveCoinSpeed bounces the coin once and drops it through the middle of the glass', () => {
    const o: Vec3 = [0, THROW_SETUPS.coin.handY, THROW_SETUPS.coin.handZ];
    const el = THROW_SETUPS.coin.elevationDeg * DEG;
    const s = solveCoinSpeed(o, DEFAULT_GLASS_POSITION, el);
    expect(s).not.toBeNull();
    const f = coinFlight(o, aimVelocity(o, DEFAULT_GLASS_POSITION, s as number, el));
    expect(f?.bounce.point[2]).toBeGreaterThan(DEFAULT_GLASS_POSITION[2]);
    expect(f?.arrive?.point[1]).toBeCloseTo(GLASS_HEIGHT, 6);
    expect(f?.arrive?.point[2]).toBeCloseTo(DEFAULT_GLASS_POSITION[2], 3);
  });

  it('impulse ↔ velocity round-trips through the projectile mass', () => {
    const v: Vec3 = [1, 2, -3];
    expect(toVelocity('ball', toImpulse('ball', v))).toEqual(v.map((x) => expect.closeTo(x, 9)));
  });
});

describe('camera mapping', () => {
  it('lookAtCamera matches three.js lookAt', () => {
    const cam = new PerspectiveCamera(pose.fov, ASPECT);
    cam.position.set(...pose.position);
    cam.lookAt(...pose.target);
    const q = camera.quaternion;
    const d = Math.abs(
      q.x * cam.quaternion.x +
        q.y * cam.quaternion.y +
        q.z * cam.quaternion.z +
        q.w * cam.quaternion.w,
    );
    expect(d).toBeCloseTo(1, 6);
  });

  it('projectToScreen and screenToPlane are inverses on the table', () => {
    const p: Vec3 = [0.4, 0, -0.9];
    const s = projectToScreen(camera, ASPECT, p);
    expect(s).not.toBeNull();
    const back = screenToPlane(camera, ASPECT, s as [number, number], 0);
    expect(back?.[0]).toBeCloseTo(p[0], 6);
    expect(back?.[2]).toBeCloseTo(p[2], 6);
  });

  it('a straight-up flick from the middle throws straight down the table', () => {
    const t = flickToThrow(flick(), camera, 'ball');
    const v = toVelocity('ball', t.impulse);
    expect(Math.abs(t.origin[0])).toBeLessThan(0.05);
    expect(Math.abs(v[0])).toBeLessThan(0.15);
    expect(v[2]).toBeLessThan(0);
    expect(Math.atan2(v[1], Math.hypot(v[0], v[2])) / DEG).toBeCloseTo(
      THROW_SETUPS.ball.elevationDeg,
      6,
    );
  });

  it('follows the swipe sideways and the power into speed', () => {
    const right = toVelocity(
      'ball',
      flickToThrow(flick({ direction: [0.26, -0.97] }), camera, 'ball').impulse,
    );
    const left = toVelocity(
      'ball',
      flickToThrow(flick({ direction: [-0.26, -0.97] }), camera, 'ball').impulse,
    );
    expect(right[0]).toBeGreaterThan(0.3);
    expect(left[0]).toBeLessThan(-0.3);
    const soft = Math.hypot(
      ...toVelocity('ball', flickToThrow(flick({ power: 0.2 }), camera, 'ball').impulse),
    );
    const hard = Math.hypot(
      ...toVelocity('ball', flickToThrow(flick({ power: 0.9 }), camera, 'ball').impulse),
    );
    expect(hard).toBeGreaterThan(soft);
  });

  it('a swipe toward a cup on screen heads for that cup', () => {
    const cup = rackLayout(10)[6] as { position: Vec3 };
    const start: [number, number] = [0.5, 0.86];
    const sc = projectToScreen(camera, ASPECT, [cup.position[0], CUP_HEIGHT, cup.position[2]]) as [
      number,
      number,
    ];
    const dx = (sc[0] - start[0]) * ASPECT;
    const dy = sc[1] - start[1];
    const n = Math.hypot(dx, dy);
    const t = flickToThrow(flick({ start, direction: [dx / n, dy / n] }), camera, 'ball', {
      targets: rackLayout(10),
    });
    const v = toVelocity('ball', t.impulse);
    const want = Math.atan2(cup.position[0] - t.origin[0], -(cup.position[2] - t.origin[2]));
    expect(Math.abs(Math.atan2(v[0], -v[2]) - want)).toBeLessThan(4 * DEG);
  });
});

describe('aimAssist', () => {
  const rack = rackLayout(6);
  const origin: Vec3 = [0, THROW_SETUPS.ball.handY, THROW_SETUPS.ball.handZ];
  const el = THROW_SETUPS.ball.elevationDeg * DEG;
  // A throw a bit long and right of cup-0.
  const off = aimVelocity(
    origin,
    [0.12, 0, -0.45],
    solveLobSpeed(origin, [0.12, CUP_HEIGHT, -0.45], el) as number,
    el,
  );
  const raw = { kind: 'ball' as const, origin, impulse: toImpulse('ball', off) };

  it('level 0 changes nothing', () => {
    const a = aimAssist(0, raw, rack);
    expect(a.impulse).toEqual(raw.impulse);
    expect(a.targetId).toBeNull();
  });

  it('pulls toward the nearest standing cup, harder at higher levels', () => {
    const near = rack
      .map((c) => ({ c, d: Math.hypot(c.position[0] - 0.12, c.position[2] + 0.45) }))
      .sort((a, b) => a.d - b.d)[0]?.c;
    const miss = (lvl: 1 | 2 | 3) => {
      const a = aimAssist(lvl, raw, rack);
      expect(a.targetId).toBe(near?.id);
      const at = predictArrival(a) as Vec3;
      return Math.hypot(at[0] - (near?.position[0] ?? 0), at[2] - (near?.position[2] ?? 0));
    };
    const m1 = miss(1);
    const m2 = miss(2);
    const m3 = miss(3);
    expect(m2).toBeLessThan(m1);
    expect(m3).toBeLessThan(m2);
    expect(m3).toBeLessThan(0.06);
  });

  it('ignores removed cups (only standing targets are passed)', () => {
    const standing = rack.filter((c) => c.id !== 'cup-0' && c.id !== 'cup-1' && c.id !== 'cup-2');
    expect(aimAssist(3, raw, standing).targetId).not.toMatch(/^cup-[012]$/);
  });

  it('solves an ideal coin throw through one bounce', () => {
    const o: Vec3 = [0, THROW_SETUPS.coin.handY, THROW_SETUPS.coin.handZ];
    const v = idealVelocity(
      'coin',
      o,
      DEFAULT_GLASS_POSITION,
      THROW_SETUPS.coin.elevationDeg * DEG,
    );
    expect(v).not.toBeNull();
    const at = predictArrival({
      kind: 'coin',
      origin: o,
      impulse: toImpulse('coin', v as Vec3),
    }) as Vec3;
    expect(at[2]).toBeCloseTo(DEFAULT_GLASS_POSITION[2], 3);
  });
});

describe('racks', () => {
  it('lays out every formation with touching cups', () => {
    for (const [n, rows] of Object.entries(RACK_FORMATIONS)) {
      const r = rackLayout(Number(n) as keyof typeof RACK_FORMATIONS);
      expect(r).toHaveLength(rows.reduce((a: number, b: number) => a + b, 0));
      for (const a of r)
        for (const b of r)
          if (a !== b)
            expect(
              Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]),
            ).toBeGreaterThan(CUP_SPACING - 1e-9);
    }
  });

  it('slotsToTargets matches rackLayout for the 10-cup triangle', () => {
    const row = Math.sqrt(3) / 2;
    const slots = [
      { x: 0, y: 0 },
      { x: -0.5, y: row },
      { x: 0.5, y: row },
      { x: -1, y: 2 * row },
      { x: 0, y: 2 * row },
      { x: 1, y: 2 * row },
      { x: -1.5, y: 3 * row },
      { x: -0.5, y: 3 * row },
      { x: 0.5, y: 3 * row },
      { x: 1.5, y: 3 * row },
    ];
    const a = slotsToTargets(slots);
    const b = rackLayout(10);
    a.forEach((t, i) => {
      expect(t.position[0]).toBeCloseTo(b[i]?.position[0] ?? NaN, 9);
      expect(t.position[2]).toBeCloseTo(b[i]?.position[2] ?? NaN, 9);
    });
  });
});
