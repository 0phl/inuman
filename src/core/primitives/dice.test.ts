import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FACE_NORMALS,
  FACES,
  fromAxisAngle,
  multiply,
  remap,
  rotate,
  topFace,
  type Quat,
} from './dice';

const close = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i] ?? NaN, 9));

/** All 24 rotations of a cube: each face up × 4 quarter-turns about world Y. */
const cubeOrientations: Quat[] = (() => {
  const ups: Quat[] = [
    [0, 0, 0, 1],
    fromAxisAngle([1, 0, 0], Math.PI / 2),
    fromAxisAngle([1, 0, 0], -Math.PI / 2),
    fromAxisAngle([1, 0, 0], Math.PI),
    fromAxisAngle([0, 0, 1], Math.PI / 2),
    fromAxisAngle([0, 0, 1], -Math.PI / 2),
  ];
  return ups.flatMap((u) =>
    [0, 1, 2, 3].map((k) => multiply(fromAxisAngle([0, 1, 0], (k * Math.PI) / 2), u)),
  );
})();

describe('dice math', () => {
  it('opposite faces sum to 7', () => {
    for (const f of FACES) {
      const n = FACE_NORMALS[f];
      close(FACE_NORMALS[(7 - f) as typeof f], [-n[0], -n[1], -n[2]]);
    }
  });

  it('reads the up face of an unrotated die as 1', () => {
    expect(topFace([0, 0, 0, 1])).toEqual({ face: 1, alignment: 1 });
  });

  it('every cube orientation reads a clean face', () => {
    expect(new Set(cubeOrientations.map((q) => topFace(q).face)).size).toBe(6);
    for (const q of cubeOrientations) expect(topFace(q).alignment).toBeCloseTo(1, 9);
  });

  it('remap(landed, target) maps the target normal onto the landed normal', () => {
    for (const landed of FACES)
      for (const target of FACES)
        close(rotate(remap(landed, target), FACE_NORMALS[target]), FACE_NORMALS[landed]);
  });

  it('for any landed orientation, the remapped visual shows the target face', () => {
    for (const q of cubeOrientations) {
      const landed = topFace(q).face;
      for (const target of FACES)
        expect(topFace(multiply(q, remap(landed, target))).face).toBe(target);
    }
  });

  it('works for arbitrary (non-axis-aligned) settled orientations too', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...cubeOrientations),
        fc.double({ min: -0.3, max: 0.3, noNaN: true }),
        fc.constantFrom(...FACES),
        (q, wobble, target) => {
          // A slight lean about Y keeps the same face up.
          const settled = multiply(fromAxisAngle([0, 1, 0], wobble * 10), q);
          const landed = topFace(settled).face;
          expect(topFace(multiply(settled, remap(landed, target))).face).toBe(target);
        },
      ),
    );
  });
});
