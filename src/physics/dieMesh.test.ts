import { describe, expect, it } from 'vitest';
import { FACE_NORMALS, FACES } from '@/core/primitives/dice';
import { atlasRect, dieGeometry, PIP_LAYOUT } from '@/three/diceTextures';

// The rendered die must match FACE_NORMALS, or topFace/remap would show the wrong pips.
describe('die mesh face layout', () => {
  it('each face has its number of pips', () => {
    for (const f of FACES) expect(PIP_LAYOUT[f]).toHaveLength(f);
  });

  it.each(['low', 'mid'] as const)(
    '%s tier: every flat face samples its own atlas cell',
    (tier) => {
      const g = dieGeometry(tier);
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      expect(pos.count / 3).toBeLessThanOrEqual(600); // triangles
      const seen = new Set<number>();
      for (let i = 0; i < nrm.count; i++) {
        const n = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
        const face = FACES.find((f) =>
          FACE_NORMALS[f].every((c, k) => Math.abs(c - (n[k] ?? 0)) < 1e-6),
        );
        if (!face) continue; // rounded edge/corner vertex
        seen.add(face);
        const [u0, v0, u1, v1] = atlasRect(face);
        expect(uv.getX(i)).toBeGreaterThanOrEqual(u0);
        expect(uv.getX(i)).toBeLessThanOrEqual(u1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(v0);
        expect(uv.getY(i)).toBeLessThanOrEqual(v1);
      }
      expect(seen.size).toBe(6);
    },
  );
});
