import { describe, expect, it } from 'vitest';
import type { Leg } from '@/core/games/flip-cup/logic';
import { CUP_HEIGHT } from '@/physics/throwConfig';
import {
  directionScore,
  flickQuality,
  flipDuration,
  flipEnd,
  flipKind,
  flipPose,
  FLIP_SPOT,
  needleAt,
  NEEDLE_PERIOD_MS,
  poseToInstance,
  powerScore,
  rowSlots,
  SWEET,
  upright,
  upsideDown,
} from './flip';

const legs = (teams: (0 | 1)[]): Leg[] =>
  teams.map((team, i) => ({ team, player: `p${i}`, round: 0, attempts: 0, result: null }));

describe('flip cup gesture quality', () => {
  it('rewards a firm, straight-up flick', () => {
    expect(flickQuality({ power: 0.48, direction: [0, -1] })).toBe(1);
    expect(powerScore(SWEET.lo)).toBe(1);
    expect(powerScore(SWEET.hi)).toBe(1);
    // Limp or wild flicks score less, down to nothing.
    expect(powerScore(0.2)).toBeLessThan(1);
    expect(powerScore(0.05)).toBe(0);
    expect(powerScore(0.75)).toBeLessThan(1);
    expect(powerScore(1)).toBe(0);
    // Sideways costs too.
    const tilted = flickQuality({ power: 0.48, direction: [Math.sin(0.5), -Math.cos(0.5)] });
    expect(tilted).toBeLessThan(1);
    expect(tilted).toBeGreaterThan(0);
    expect(directionScore(45)).toBe(0);
  });

  it('sweeps the tap needle back and forth', () => {
    expect(needleAt(0)).toBe(0);
    expect(needleAt(NEEDLE_PERIOD_MS / 2)).toBeCloseTo(1);
    expect(needleAt(NEEDLE_PERIOD_MS / 4)).toBeCloseTo(0.5);
    expect(needleAt(NEEDLE_PERIOD_MS)).toBeCloseTo(0);
  });
});

describe('flip cup table', () => {
  it('rows each team down its own side, first leg in front', () => {
    const l = legs([0, 1, 0, 1, 0, 1]);
    const slots = rowSlots(l);
    expect(slots[0]!.x).toBeLessThan(0);
    expect(slots[1]!.x).toBeGreaterThan(0);
    expect(slots[0]!.z).toBeGreaterThan(slots[2]!.z);
    expect(slots[2]!.z).toBeGreaterThan(slots[4]!.z);
    // A long team packs tighter and shrinks its cups, never off the felt.
    const many = rowSlots(legs(Array.from({ length: 24 }, (_, i) => (i % 2) as 0 | 1)));
    expect(Math.min(...many.map((s) => s.z))).toBeGreaterThan(-1.2);
    expect(many[0]!.scale).toBeLessThan(1);
  });
});

describe('scripted flip', () => {
  it('picks how a flip plays', () => {
    expect(flipKind(true, 0.1)).toBe('flip');
    expect(flipKind(false, 0.9)).toBe('over');
    expect(flipKind(false, 0.2)).toBe('under');
  });

  for (const reduced of [false, true]) {
    it(`starts upright and ends where it says (${reduced ? 'reduced motion' : 'full'})`, () => {
      for (const kind of ['flip', 'under', 'over'] as const) {
        const start = flipPose(kind, 0, FLIP_SPOT, reduced);
        expect(start.rx).toBeCloseTo(0, 5);
        expect(start.y).toBeCloseTo(CUP_HEIGHT / 2, 5);
        const end = flipPose(kind, flipDuration(kind, reduced) + 1, FLIP_SPOT, reduced);
        const want = flipEnd(kind, FLIP_SPOT);
        // −2π (stood back up after an over-flip) is the same as upright.
        const turn = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        expect(Math.abs(Math.sin((turn(end.rx) - turn(want.rx)) / 2))).toBeLessThan(0.02);
        expect(end.y).toBeCloseTo(want.y, 2);
        expect(end.z).toBeCloseTo(want.z, 2);
        // Never sinks through the table on the way.
        for (let t = 0; t <= flipDuration(kind, reduced); t += 0.01) {
          const p = poseToInstance(flipPose(kind, t, FLIP_SPOT, reduced));
          expect(p.position[1]).toBeGreaterThan(-0.05);
        }
      }
    });
  }

  it('stands cups on their base or their rim', () => {
    expect(poseToInstance(upright(0, 0)).position[1]).toBeCloseTo(0);
    // Upside down, the base is up at the cup's height.
    expect(poseToInstance(upsideDown(0, 0)).position[1]).toBeCloseTo(CUP_HEIGHT);
    expect(poseToInstance(upsideDown(0, 0, 0.5), 0.5).position[1]).toBeCloseTo(CUP_HEIGHT / 2);
  });
});
