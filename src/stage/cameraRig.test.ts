import { describe, expect, it } from 'vitest';
import { CAMERA_CONTRACT, rigPose } from './cameraRig';
import { ENV_SCALE, PLAY_W } from './tableSpace';

const visibleWidthAtTarget = (aspect: number) => {
  const p = rigPose(aspect);
  return 2 * p.distance * Math.tan((p.fov * Math.PI) / 360) * aspect;
};

describe('rigPose', () => {
  it('uses the portrait contract camera (scaled to world units) on a 9:20 phone', () => {
    const p = rigPose(CAMERA_CONTRACT.portrait.aspect);
    expect(p.fov).toBe(50);
    expect(p.target[2]).toBeCloseTo(-0.05 * ENV_SCALE);
    // The contract camera, or pulled straight back along its own view direction.
    const [, y, z] = p.position;
    expect(y / (z - p.target[2])).toBeCloseTo(0.95 / 0.9, 5);
    expect(y).toBeGreaterThanOrEqual(0.95 * ENV_SCALE - 1e-9);
  });

  it('matches the portrait contract exactly on a Pixel 7', () => {
    const p = rigPose(412 / 839);
    expect(p.position[1]).toBeCloseTo(0.95 * ENV_SCALE, 1);
    expect(p.position[2]).toBeCloseTo(0.85 * ENV_SCALE, 1);
  });

  it('uses the landscape contract camera on a 16:10 screen', () => {
    const p = rigPose(1280 / 800);
    expect(p.position[0]).toBeCloseTo(0);
    expect(p.position[1]).toBeCloseTo(1.0 * ENV_SCALE);
    expect(p.position[2]).toBeCloseTo(1.1 * ENV_SCALE);
  });

  it('never crops the play area horizontally, however tall the phone', () => {
    for (const aspect of [0.38, 0.42, 0.46, 0.5, 0.6, 0.75, 1, 1.33, 1.6, 2.2]) {
      expect(visibleWidthAtTarget(aspect)).toBeGreaterThanOrEqual(PLAY_W - 1e-9);
    }
  });

  it('moves smoothly between portrait and landscape', () => {
    let prev = rigPose(0.38).position;
    for (let a = 0.385; a < 2.5; a += 0.005) {
      const next = rigPose(a).position;
      expect(Math.abs(next[1] - prev[1])).toBeLessThan(0.08);
      expect(Math.abs(next[2] - prev[2])).toBeLessThan(0.08);
      prev = next;
    }
  });

  it('survives a zero-size viewport', () => {
    const p = rigPose(0);
    expect(p.position.every(Number.isFinite)).toBe(true);
  });
});
