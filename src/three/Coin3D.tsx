import type { Ref } from 'react';
import {
  CanvasTexture,
  CylinderGeometry,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Mesh,
  type Texture,
} from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { COIN_RADIUS, COIN_THICKNESS } from '@/physics/throwConfig';
import { useTier } from '@/stage/stageStore';
import type { Tier } from '@/store/settings';

// A generic brass bar token (no real currency): both faces carry an embossed bottle cap — a
// crimped 21-flute crown with a star — inside a beaded border, and the edge is reeded. Same radius
// and thickness as its Rapier cylinder (axis = local Y). One geometry per tier, three shared
// materials (edge, obverse, reverse) for every coin.

const geoCache = new Map<Tier, CylinderGeometry>();
let materials: Material[] | null = null;
let lowMaterials: Material[] | null = null;

function coinGeometry(tier: Tier): CylinderGeometry {
  let g = geoCache.get(tier);
  if (!g) {
    // Groups: 0 = edge, 1 = top cap (+Y), 2 = bottom cap.
    g = new CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, tier === 'low' ? 28 : 48, 1);
    geoCache.set(tier, g);
  }
  return g;
}

/** Face artwork drawn twice: a colour map (patina in the recesses) and a bump map (white = raised). */
function faceCanvas(kind: 'color' | 'bump'): HTMLCanvasElement {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const cx = s / 2;
  const bump = kind === 'bump';
  const field = bump ? '#5a5a5a' : '#d8ad55';
  const relief = bump ? '#ffffff' : '#f0cd78';
  const recess = bump ? '#3a3a3a' : '#9c7428';
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, s, s);
  // Raised rim.
  ctx.strokeStyle = relief;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cx, s / 2 - 7, 0, Math.PI * 2);
  ctx.stroke();
  // Beaded border.
  ctx.fillStyle = relief;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (s / 2 - 22), cx + Math.sin(a) * (s / 2 - 22), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // The bottle cap: a crimped crown (21 flutes)…
  const flutes = 21;
  const rOut = s * 0.31;
  const rIn = s * 0.275;
  ctx.beginPath();
  for (let i = 0; i <= flutes * 8; i++) {
    const a = (i / (flutes * 8)) * Math.PI * 2;
    const r = rIn + (rOut - rIn) * (0.5 + 0.5 * Math.cos(a * flutes));
    ctx.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = relief;
  ctx.fill();
  // …with a recessed disc and a raised star in the middle.
  ctx.fillStyle = recess;
  ctx.beginPath();
  ctx.arc(cx, cx, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = relief;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? s * 0.15 : s * 0.065;
    ctx.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  return c;
}

function edgeBump(): Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  for (let x = 0; x < 64; x++) {
    const v = x % 4 < 2 ? 230 : 70;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, 8);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

function coinMaterials(tier: Tier): Material[] {
  const low = tier === 'low';
  if (low && lowMaterials) return lowMaterials;
  if (!low && materials) return materials;
  const map = new CanvasTexture(faceCanvas('color'));
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const base = { metalness: 0.85, roughness: 0.34, envMapIntensity: 1.3, color: '#ffffff' };
  const face = low
    ? new MeshStandardMaterial({ ...base, map })
    : new MeshStandardMaterial({
        ...base,
        map,
        bumpMap: (() => {
          const b = new CanvasTexture(faceCanvas('bump'));
          b.colorSpace = NoColorSpace;
          return b;
        })(),
        bumpScale: 1.6,
      });
  const edge = new MeshStandardMaterial({
    metalness: 0.85,
    roughness: 0.4,
    envMapIntensity: 1.3,
    color: '#c99a45',
    ...(low ? {} : { bumpMap: edgeBump(), bumpScale: 1.2 }),
  });
  const set = [edge, face, face];
  if (low) lowMaterials = set;
  else materials = set;
  return set;
}

export type Coin3DProps = Omit<ThreeElements['mesh'], 'geometry' | 'material' | 'ref'> & {
  ref?: Ref<Mesh>;
};

/** One brass token centred on its origin, lying flat (faces ±Y). */
export function Coin3D({ ref, ...mesh }: Coin3DProps) {
  const tier = useTier() ?? 'mid';
  return <mesh ref={ref} geometry={coinGeometry(tier)} material={coinMaterials(tier)} {...mesh} />;
}
