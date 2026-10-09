import { describe, expect, it } from 'vitest';
import { extractDiceImpacts, extractThrowImpacts, impactGain } from './impacts';

const DT = 1 / 60;
const G = 22;
const SIZE = 0.26;
const HALF = SIZE / 2;
const TRAY = { width: 2, depth: 1.5 };

type P = [number, number, number];

/** Integrates simple ballistic paths with instant bounces into presim-style frames. */
function record(
  paths: ((step: number) => P)[],
  steps: number,
): Float32Array {
  const f = new Float32Array(steps * paths.length * 7);
  for (let s = 0; s < steps; s++) {
    paths.forEach((path, k) => {
      const [x, y, z] = path(s);
      f.set([x, y, z, 0, 0, 0, 1], (s * paths.length + k) * 7);
    });
  }
  return f;
}

/** A die dropped from `h`, bouncing on the felt with restitution `e`, drifting at `vx`. */
function dropPath(h: number, e: number, vx = 0, x0 = 0, z0 = 0): (s: number) => P {
  const pos: P[] = [];
  let y = h;
  let vy = 0;
  let x = x0;
  for (let s = 0; s < 400; s++) {
    pos.push([x, y, z0]);
    vy -= G * DT;
    y += vy * DT;
    x += vx * DT;
    if (y < HALF) {
      y = HALF + (HALF - y) * e;
      vy = -vy * e;
      if (Math.abs(vy) < 0.4) vy = 0;
    }
  }
  return (s) => pos[Math.min(s, pos.length - 1)] as P;
}

describe('extractDiceImpacts', () => {
  it('finds each floor bounce of a dropped die, hardest first in time', () => {
    const frames = record([dropPath(0.8, 0.45)], 200);
    const ev = extractDiceImpacts({ frames, steps: 200, count: 1, dt: DT, dieSize: SIZE, tray: TRAY });
    expect(ev.length).toBeGreaterThanOrEqual(2);
    expect(ev.every((e) => e.surface === 'table')).toBe(true);
    // Time ordered, and each bounce softer than the one before.
    for (let i = 1; i < ev.length; i++) {
      expect(ev[i]!.step).toBeGreaterThan(ev[i - 1]!.step);
      expect(ev[i]!.speed).toBeLessThan(ev[i - 1]!.speed);
    }
    // First landing: dropped from 0.8 − half a die → about √(2·22·0.67) ≈ 5.4 u/s, ×(1 + e).
    expect(ev[0]!.speed).toBeGreaterThan(5);
    expect(ev[0]!.step).toBeGreaterThan(10);
    expect(ev[0]!.step).toBeLessThan(20);
  });

  it('reports nothing for a die in free flight or at rest', () => {
    const flying = record([(s) => [0.5 * s * DT, 2 - 0.5 * G * (s * DT) ** 2, 0]], 30);
    expect(
      extractDiceImpacts({ frames: flying, steps: 30, count: 1, dt: DT, dieSize: SIZE, tray: TRAY }),
    ).toEqual([]);
    const resting = record([() => [0.2, HALF, 0.1]], 60);
    expect(
      extractDiceImpacts({ frames: resting, steps: 60, count: 1, dt: DT, dieSize: SIZE, tray: TRAY }),
    ).toEqual([]);
  });

  it('classifies a bounce off the side wall', () => {
    // Slides along the felt toward +X at 3 u/s and bounces back off the wall at x = 1.
    const wallX = TRAY.width / 2 - HALF;
    const path = (s: number): P => {
      const x = -0.2 + 3 * s * DT;
      return [x <= wallX ? x : wallX - (x - wallX) * 0.6, HALF, 0];
    };
    const ev = extractDiceImpacts({
      frames: record([path], 40),
      steps: 40,
      count: 1,
      dt: DT,
      dieSize: SIZE,
      tray: TRAY,
    });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.surface).toBe('wall');
    expect(ev[0]!.speed).toBeGreaterThan(4);
  });

  it('reports one die-on-die knock when two dice collide', () => {
    // Two dice slide toward each other along the felt and swap velocities on contact.
    const meet = 15;
    const a = (s: number): P => [s < meet ? -0.6 + 2 * s * DT : -0.6 + 2 * meet * DT - 1 * (s - meet) * DT, HALF, 0];
    const b = (s: number): P => {
      const xm = -0.6 + 2 * meet * DT + SIZE;
      return [s < meet ? xm : xm + 2 * (s - meet) * DT, HALF, 0];
    };
    const ev = extractDiceImpacts({
      frames: record([a, b], 40),
      steps: 40,
      count: 2,
      dt: DT,
      dieSize: SIZE,
      tray: { width: 4, depth: 3 },
    });
    expect(ev.filter((e) => e.surface === 'die')).toHaveLength(1);
    expect(ev[0]!.step).toBe(meet);
  });

  it('counts a resting die (obstacle) as another die', () => {
    const wall = 0.3;
    const path = (s: number): P => {
      const x = -0.4 + 2 * s * DT;
      return [x <= wall - SIZE ? x : wall - SIZE - (x - (wall - SIZE)) * 0.5, HALF, 0];
    };
    const ev = extractDiceImpacts({
      frames: record([path], 40),
      steps: 40,
      count: 1,
      dt: DT,
      dieSize: SIZE,
      tray: { width: 4, depth: 3 },
      obstacles: [{ p: [wall, HALF, 0] }],
    });
    expect(ev.map((e) => e.surface)).toEqual(['die']);
  });

  it('caps the number of events, keeping the strongest', () => {
    const frames = record([dropPath(1.5, 0.7)], 400);
    const all = extractDiceImpacts({ frames, steps: 400, count: 1, dt: DT, dieSize: SIZE, tray: TRAY });
    const few = extractDiceImpacts({
      frames,
      steps: 400,
      count: 1,
      dt: DT,
      dieSize: SIZE,
      tray: TRAY,
      maxTotal: 2,
    });
    expect(all.length).toBeGreaterThan(2);
    expect(few.map((e) => e.step)).toEqual(all.slice(0, 2).map((e) => e.step));
  });
});

describe('extractThrowImpacts', () => {
  const R = 0.08;
  const cupR = () => 0.2;

  it('finds table bounces and a rim knock, and stops at `until`', () => {
    const dt = 1 / 120;
    const g = 27;
    const pos: P[] = [];
    let x = -1;
    let y = 0.6;
    let vx = 3;
    let vy = 0;
    for (let s = 0; s < 240; s++) {
      pos.push([x, y, 0]);
      vy -= g * dt;
      x += vx * dt;
      y += vy * dt;
      if (y < R) {
        y = R + (R - y) * 0.8;
        vy = -vy * 0.8;
      }
      // The cup at x = 0.6: its wall (radius 0.2) knocks the ball back.
      if (vx > 0 && x > 0.6 - 0.2 - R && y < 0.45) {
        vx = -vx * 0.5;
      }
    }
    const frames = new Float32Array(pos.length * 7);
    pos.forEach((p, i) => frames.set([...p, 0, 0, 0, 1], i * 7));
    const ev = extractThrowImpacts({
      frames,
      steps: pos.length,
      dt,
      gravity: g,
      radius: R,
      targets: [{ position: [0.6, 0, 0] }],
      radiusAt: cupR,
      mouthY: 0.45,
    });
    expect(ev.some((e) => e.surface === 'table')).toBe(true);
    expect(ev.some((e) => e.surface === 'rim')).toBe(true);
    const first = ev[0]!;
    const cut = extractThrowImpacts({
      frames,
      steps: pos.length,
      dt,
      gravity: g,
      radius: R,
      targets: [{ position: [0.6, 0, 0] }],
      radiusAt: cupR,
      mouthY: 0.45,
      until: first.step + 1,
    });
    expect(cut).toHaveLength(1);
  });
});

describe('impactGain', () => {
  it('maps speed to 0.1…1', () => {
    expect(impactGain(0, 1, 5)).toBeCloseTo(0.1);
    expect(impactGain(5, 1, 5)).toBeCloseTo(1);
    expect(impactGain(50, 1, 5)).toBeCloseTo(1);
    expect(impactGain(3, 1, 5)).toBeGreaterThan(0.5);
  });
});
