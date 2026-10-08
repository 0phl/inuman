import { describe, expect, it } from 'vitest';
import { FORMATION_SLOTS, FORMATIONS, type Formation } from '@/core/games/beer-pong/logic';
import { CUP_SPACING, slotsToTargets } from '@/physics/throwConfig';
import { aimAssist, predictArrival, toVelocity } from '@/physics/throwMath';
import {
  aimedThrow,
  defendingTargets,
  FAR_FRONT,
  frontTarget,
  holdPower,
  idealPower,
  parseTargetId,
  rackPose,
  rackToWorld,
  RISE_MS,
  slotLocal,
  targetId,
  throwSeed,
} from './layout';

const team = (formation: Formation, ids: number[]) => ({
  members: ['a'],
  cups: ids.map((id, slot) => ({ id, slot })),
  formation,
  reracksLeft: 1,
  thrower: 0,
  drinker: 0,
});

describe('beer pong layout', () => {
  it('puts the defending rack exactly where slotsToTargets would (the physics frame)', () => {
    for (const f of FORMATIONS) {
      const slots = FORMATION_SLOTS[f];
      const view = {
        defending: 1 as const,
        teams: [
          team('tri10', []),
          team(
            f,
            slots.map((_, i) => i),
          ),
        ] as [ReturnType<typeof team>, ReturnType<typeof team>],
      };
      const got = defendingTargets(view);
      const want = slotsToTargets(slots, { front: FAR_FRONT, prefix: 'bp:1:' });
      expect(got.map((t) => t.id)).toEqual(want.map((t) => t.id));
      got.forEach((t, i) => {
        const w = want[i]!.position;
        expect(t.position[0]).toBeCloseTo(w[0], 9);
        expect(t.position[2]).toBeCloseTo(w[2], 9);
      });
    }
  });

  it('maps hit target ids back to team and cup', () => {
    expect(parseTargetId(targetId(0, 7))).toEqual({ team: 0, cupId: 7 });
    expect(parseTargetId(targetId(1, 0))).toEqual({ team: 1, cupId: 0 });
    expect(parseTargetId('glass')).toBeNull();
    expect(parseTargetId('bp:2:1')).toBeNull();
  });

  it("keeps the throwing team's own rack off the table, turned round toward the far end", () => {
    const near = rackPose('near');
    expect(near.yaw).toBeCloseTo(Math.PI);
    expect(near.scale).toBe(0);
    expect(near.z).toBeGreaterThan(FAR_FRONT + CUP_SPACING);
    expect(rackPose('far')).toEqual({ x: 0, z: FAR_FRONT, yaw: 0, scale: 1 });
    // A turned rack's rows run toward the camera, mirrored left to right.
    const p = rackToWorld({ ...near, scale: 1 }, slotLocal('tri3', 1));
    expect(p[0]).toBeCloseTo(0.5 * CUP_SPACING);
    expect(p[2]).toBeGreaterThan(near.z);
  });

  it('aims "Tumira" at the front cup, and the ideal power lands it', () => {
    const targets = slotsToTargets(FORMATION_SLOTS.tri6, { front: FAR_FRONT });
    const front = frontTarget(targets);
    expect(front?.id).toBe('cup-0');
    const p = idealPower('ball', front!.position);
    expect(p).not.toBeNull();
    const raw = aimedThrow('ball', front!.position, p!);
    const at = predictArrival(raw);
    expect(at).not.toBeNull();
    expect(Math.hypot(at![0] - front!.position[0], at![2] - front!.position[2])).toBeLessThan(0.12);
    // Assist keeps it on that cup.
    expect(aimAssist(3, raw, targets).targetId).toBe('cup-0');
    // Faster power, faster ball.
    const v = (q: number) =>
      Math.hypot(...toVelocity('ball', aimedThrow('ball', front!.position, q).impulse));
    expect(v(0.8)).toBeGreaterThan(v(0.2));
  });

  it('holds power up and back down', () => {
    expect(holdPower(0)).toBe(0);
    expect(holdPower(RISE_MS / 2)).toBeCloseTo(0.5);
    expect(holdPower(RISE_MS)).toBeCloseTo(1);
    expect(holdPower(RISE_MS * 1.5)).toBeCloseTo(0.5);
    expect(holdPower(RISE_MS * 2)).toBeCloseTo(0);
  });

  it('gives each throw of a game its own repeatable seed', () => {
    const a = throwSeed(1_760_000_000_000, 1);
    expect(throwSeed(1_760_000_000_000, 1)).toBe(a);
    expect(throwSeed(1_760_000_000_000, 2)).not.toBe(a);
    expect(throwSeed(1_760_000_000_001, 1)).not.toBe(a);
    expect(Number.isInteger(a) && a >= 0 && a < 2 ** 32).toBe(true);
  });
});
