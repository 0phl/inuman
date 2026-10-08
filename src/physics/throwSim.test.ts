import { beforeAll, describe, expect, it } from 'vitest';
import { rigPose } from '@/stage/cameraRig';
import { quantile, runBench } from './throwBench';
import {
  BALL_RADIUS,
  CUP_BEER_LEVEL,
  CUP_HEIGHT,
  DEFAULT_GLASS_POSITION,
  GLASS_HEIGHT,
  rackLayout,
  THROW_FRAME_STRIDE,
  THROW_SETUPS,
  type Vec3,
} from './throwConfig';
import { aimVelocity, idealVelocity, lookAtCamera, solveLobSpeed, toImpulse } from './throwMath';
import { initRapier, presimThrowSync, type PresimThrowInput } from './throwSim';

const DEG = Math.PI / 180;
const ASPECT = 412 / 915;
const pose = rigPose(ASPECT);
const camera = lookAtCamera([...pose.position], [...pose.target], pose.fov);
const ballOrigin: Vec3 = [0, THROW_SETUPS.ball.handY, THROW_SETUPS.ball.handZ];

describe('presimThrow', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('records steps × 7 floats and reports a cup hit for an ideal throw at every cup', () => {
    const rack = rackLayout(10);
    for (const cup of rack) {
      const v = idealVelocity(
        'ball',
        ballOrigin,
        cup.position,
        THROW_SETUPS.ball.elevationDeg * DEG,
      ) as Vec3;
      const r = presimThrowSync({
        kind: 'ball',
        origin: ballOrigin,
        impulse: toImpulse('ball', v),
        targets: rack,
        seed: 3,
      });
      expect(r.frames.length).toBe(r.steps * THROW_FRAME_STRIDE);
      expect(r.resolvedStep).toBeLessThan(r.steps);
      expect(r.result).toEqual({ kind: 'ball', hit: cup.id, bounces: 0 });
      // Accepted: the ball ends floating on the beer inside that cup, below the rim.
      expect(Math.hypot(r.rest[0] - cup.position[0], r.rest[2] - cup.position[2])).toBeLessThan(
        0.12,
      );
      expect(r.rest[1]).toBeGreaterThan(CUP_BEER_LEVEL);
      expect(r.rest[1]).toBeLessThan(CUP_BEER_LEVEL + BALL_RADIUS * 1.3);
      expect(r.rest[1] + BALL_RADIUS).toBeLessThan(CUP_HEIGHT);
    }
  });

  it('is deterministic for the same seed and inputs', () => {
    const input: PresimThrowInput = {
      kind: 'ball',
      origin: [0.1, 0.9, 1.95],
      impulse: [-0.0011, 0.0175, -0.0172],
      targets: rackLayout(6),
      seed: 77,
    };
    const a = presimThrowSync(input);
    const b = presimThrowSync(input);
    expect(Array.from(b.frames)).toEqual(Array.from(a.frames));
    expect(b.result).toEqual(a.result);
    const coin: PresimThrowInput = {
      kind: 'coin',
      origin: [0, 0.62, 1],
      impulse: toImpulse('coin', [0, -5.2, -4.1]),
      targets: [{ id: 'glass', position: DEFAULT_GLASS_POSITION }],
      seed: 5,
    };
    const c1 = presimThrowSync(coin);
    const c2 = presimThrowSync(coin);
    const c3 = presimThrowSync({ ...coin, seed: 6 });
    expect(Array.from(c2.frames)).toEqual(Array.from(c1.frames));
    expect(Array.from(c3.frames)).not.toEqual(Array.from(c1.frames));
  });

  it('a throw over the rack goes off the table as a miss', () => {
    const r = presimThrowSync({
      kind: 'ball',
      origin: ballOrigin,
      impulse: toImpulse('ball', [0, 6, -14]),
      targets: rackLayout(10),
      seed: 1,
    });
    expect(r.result).toMatchObject({ kind: 'ball', hit: null });
    expect(r.end).toBe('off-table');
  });

  it('a short throw bounces on the table and is resolved as a miss early', () => {
    const r = presimThrowSync({
      kind: 'ball',
      origin: ballOrigin,
      impulse: toImpulse('ball', [0, 2.5, -3]),
      targets: rackLayout(3, { front: -0.9 }),
      seed: 1,
    });
    expect(r.result.kind === 'ball' && r.result.hit).toBe(null);
    expect(r.result.kind === 'ball' && r.result.bounces).toBeGreaterThan(0);
    expect(r.steps).toBeLessThan(Math.round(4 / r.dt));
  });

  it('flags whether a made coin bounced first', () => {
    const glass = [{ id: 'glass', position: DEFAULT_GLASS_POSITION }];
    const o: Vec3 = [0, THROW_SETUPS.coin.handY, THROW_SETUPS.coin.handZ];
    const v = idealVelocity(
      'coin',
      o,
      DEFAULT_GLASS_POSITION,
      THROW_SETUPS.coin.elevationDeg * DEG,
    ) as Vec3;
    let made = 0;
    for (let seed = 0; seed < 20; seed++) {
      const r = presimThrowSync({
        kind: 'coin',
        origin: o,
        impulse: toImpulse('coin', v),
        targets: glass,
        seed,
      });
      if (r.result.kind === 'coin' && r.result.made) {
        made++;
        expect(r.result.bounced).toBe(true);
        expect(r.result.target).toBe('glass');
      }
    }
    expect(made).toBeGreaterThan(5);
    // Lobbed straight in without touching the felt: made, but not bounced.
    const from: Vec3 = [0, 0.62, 1];
    const mouth: Vec3 = [DEFAULT_GLASS_POSITION[0], GLASS_HEIGHT - 0.01, DEFAULT_GLASS_POSITION[2]];
    const lobV = aimVelocity(from, mouth, solveLobSpeed(from, mouth, 60 * DEG) as number, 60 * DEG);
    const lob = presimThrowSync({
      kind: 'coin',
      origin: from,
      impulse: toImpulse('coin', lobV),
      targets: glass,
      seed: 1,
      spin: [0, 0, 0],
    });
    expect(lob.result).toMatchObject({ kind: 'coin', made: true, bounced: false });
  });
});

describe('throw bench (small samples; pnpm throw:check runs the big ones)', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('beer pong: assist 3 + reasonable flicks usually land; assist 0 + random flicks rarely', () => {
    const strong = runBench({
      kind: 'ball',
      level: 3,
      profile: 'reasonable',
      throws: 90,
      seed: 11,
      camera,
      aspect: ASPECT,
    });
    const none = runBench({
      kind: 'ball',
      level: 0,
      profile: 'random',
      throws: 90,
      seed: 12,
      camera,
      aspect: ASPECT,
    });
    expect(strong.rate).toBeGreaterThanOrEqual(0.55);
    expect(none.rate).toBeLessThan(0.3);
    expect(quantile(strong.ms, 0.95)).toBeLessThan(60); // generous: CI machines vary
  });

  it('quarters: assist 2 makes a fair share, not all', () => {
    const r = runBench({
      kind: 'coin',
      level: 2,
      profile: 'reasonable',
      throws: 120,
      seed: 13,
      camera,
      aspect: ASPECT,
    });
    expect(r.rate).toBeGreaterThanOrEqual(0.2);
    expect(r.rate).toBeLessThanOrEqual(0.75);
  });
});
