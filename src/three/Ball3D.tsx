import type { Ref } from 'react';
import {
  CanvasTexture,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Mesh,
  type Texture,
} from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { BALL_RADIUS } from '@/physics/throwConfig';
import { useTier } from '@/stage/stageStore';
import type { Tier } from '@/store/settings';

// A 40 mm ping-pong ball (BALL_RADIUS, the same radius as its collider), matte celluloid with a
// small printed three-star mark so its spin reads in flight. Geometry per tier and material per
// colour are shared by every ball.

const BALL_COLORS = { orange: '#ff7b1c', white: '#f6f3ea' } as const;
export type BallColor = keyof typeof BALL_COLORS;

const geoCache = new Map<Tier, SphereGeometry>();
const matCache = new Map<BallColor, MeshStandardMaterial>();

function ballGeometry(tier: Tier): SphereGeometry {
  let g = geoCache.get(tier);
  if (!g) {
    g =
      tier === 'low'
        ? new SphereGeometry(BALL_RADIUS, 18, 12)
        : new SphereGeometry(BALL_RADIUS, 28, 20);
    geoCache.set(tier, g);
  }
  return g;
}

/** Equirectangular print: the ball colour with a small three-star mark and a thin seam. */
function printTexture(color: string): Texture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  // The seam around the equator, barely there.
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, h / 2 - 1, w, 2);
  // Three little stars (stretched horizontally to stay round near the equator).
  const ink = color === BALL_COLORS.white ? '#1d3f8a' : '#3b1606';
  ctx.fillStyle = ink;
  const star = (cx: number, cy: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(cx + Math.cos(a) * rr * 1.05, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  };
  for (let i = -1; i <= 1; i++) star(w * 0.25 + i * 9, h * 0.42, 4.2);
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('40+', w * 0.25, h * 0.6);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

function ballMaterial(color: BallColor): MeshStandardMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new MeshStandardMaterial({
      map: printTexture(BALL_COLORS[color]),
      roughness: 0.48,
      envMapIntensity: 0.9,
      // A whisper of self-light so it never goes muddy in the bar's dark corners.
      emissive: BALL_COLORS[color],
      emissiveIntensity: 0.08,
    });
    matCache.set(color, m);
  }
  return m;
}

export type Ball3DProps = Omit<ThreeElements['mesh'], 'geometry' | 'material' | 'ref'> & {
  color?: BallColor;
  ref?: Ref<Mesh>;
};

/** One ping-pong ball centred on its origin. */
export function Ball3D({ color = 'orange', ref, ...mesh }: Ball3DProps) {
  const tier = useTier() ?? 'mid';
  return <mesh ref={ref} geometry={ballGeometry(tier)} material={ballMaterial(color)} {...mesh} />;
}
