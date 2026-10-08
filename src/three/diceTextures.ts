import {
  BufferGeometry,
  CanvasTexture,
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FACE_NORMALS, FACES, type Face, type Vec3 } from '@/core/primitives/dice';
import { DIE_RADIUS, DIE_SIZE } from '@/physics/diceConfig';
import type { Tier } from '@/store/settings';

// One die = one rounded-box mesh, one material, one draw call. All six faces live in a 3×2
// canvas atlas; the geometry's per-face UVs are squeezed into the matching cell, so the layout
// follows FACE_NORMALS exactly (+Y=1, -Y=6, +X=2, -X=5, +Z=3, -Z=4). Drawn at runtime: offline-safe.

export const DIE_MATERIAL_IDS = ['ivory', 'red-casino', 'wood'] as const;
export type DieMaterialId = (typeof DIE_MATERIAL_IDS)[number];

export const resolveDieMaterial = (id: string | undefined): DieMaterialId =>
  (DIE_MATERIAL_IDS as readonly string[]).includes(id ?? '') ? (id as DieMaterialId) : 'ivory';

/** Pip centres per face in a [-1, 1] cell box (canvas axes: +x right, +y down). */
export const PIP_LAYOUT: Readonly<Record<Face, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

const ATLAS_COLS = 3;
const ATLAS_ROWS = 2;
/** Inset inside each cell so mipmaps never bleed the neighbouring face in. */
const CELL_PAD = 0.03;

/** Atlas cell (column, row from the top) holding each face. */
export const atlasCell = (face: Face): [number, number] => [
  (face - 1) % ATLAS_COLS,
  Math.floor((face - 1) / ATLAS_COLS),
];

/** UV rectangle [u0, v0, u1, v1] of a face's cell (CanvasTexture flips Y: canvas top = v 1). */
export function atlasRect(face: Face): [number, number, number, number] {
  const [col, row] = atlasCell(face);
  return [
    col / ATLAS_COLS,
    1 - (row + 1) / ATLAS_ROWS,
    (col + 1) / ATLAS_COLS,
    1 - row / ATLAS_ROWS,
  ];
}

/** BoxGeometry groups come in this normal order: +X, -X, +Y, -Y, +Z, -Z. */
const BOX_GROUP_NORMALS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const faceForNormal = (n: Vec3): Face => {
  const f = FACES.find((face) => FACE_NORMALS[face].every((c, i) => c === n[i]));
  if (!f) throw new Error('die: no face for normal');
  return f;
};

// ---------------------------------------------------------------- geometry

/** Rounded-corner segments per tier: 2 → 300 triangles, 3 → 588 triangles. */
const SEGMENTS: Record<Tier, number> = { low: 2, mid: 3, high: 3 };
const geometries = new Map<Tier, BufferGeometry>();

/** Shared die geometry (edge DIE_SIZE, centred), single material, UVs into the face atlas. */
export function dieGeometry(tier: Tier): BufferGeometry {
  const hit = geometries.get(tier);
  if (hit) return hit;
  const g = new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, SEGMENTS[tier], DIE_RADIUS);
  const uv = g.getAttribute('uv');
  for (const group of g.groups) {
    const normal = BOX_GROUP_NORMALS[group.materialIndex ?? 0] as Vec3;
    const [u0, v0, u1, v1] = atlasRect(faceForNormal(normal));
    const du = u1 - u0;
    const dv = v1 - v0;
    for (let i = group.start; i < group.start + group.count; i++) {
      const u = CELL_PAD + uv.getX(i) * (1 - 2 * CELL_PAD);
      const v = CELL_PAD + uv.getY(i) * (1 - 2 * CELL_PAD);
      uv.setXY(i, u0 + u * du, v0 + v * dv);
    }
  }
  uv.needsUpdate = true;
  g.clearGroups();
  g.computeBoundingSphere();
  geometries.set(tier, g);
  return g;
}

// ---------------------------------------------------------------- atlas painting

interface Style {
  body(ctx: CanvasRenderingContext2D, s: number, face: Face): void;
  pip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, face: Face): void;
  /** Pip radius as a fraction of the face; the ace can be bigger. */
  pipR(face: Face): number;
  /** Optional glow layer (emissive map): translucent body glows, painted pips don't. */
  glow?(ctx: CanvasRenderingContext2D, s: number): void;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function radial(ctx: CanvasRenderingContext2D, s: number, inner: string, outer: string) {
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.72);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
}

function speckle(ctx: CanvasRenderingContext2D, s: number, seed: number, color: string, n: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = hash(i, 1, seed) * s;
    const y = hash(i, 2, seed) * s;
    const r = 0.4 + hash(i, 3, seed) * 1.1;
    ctx.fillRect(x, y, r, r);
  }
}

/** A drilled, painted pip: dark rim, slightly lighter floor. */
function recessedPip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rim: string,
  floor: string,
) {
  const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
  g.addColorStop(0, floor);
  g.addColorStop(0.75, floor);
  g.addColorStop(1, rim);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

const STYLES: Record<DieMaterialId, Style> = {
  // Ivory with the Asian-style red ace and red four.
  ivory: {
    body(ctx, s, face) {
      radial(ctx, s, '#f8f1e2', '#e4d4b2');
      speckle(ctx, s, face * 31, 'rgba(120,90,50,0.10)', Math.round(s * 0.6));
    },
    pip(ctx, x, y, r, face) {
      if (face === 1 || face === 4) recessedPip(ctx, x, y, r, '#6e0a10', '#c8161f');
      else recessedPip(ctx, x, y, r, '#050302', '#2a211a');
    },
    pipR: (face) => (face === 1 ? 0.15 : 0.088),
  },
  // Translucent-looking casino red, flush white pips.
  'red-casino': {
    body(ctx, s) {
      radial(ctx, s, '#b8101f', '#6e030d');
    },
    pip(ctx, x, y, r) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.85, '#f4efe6');
      g.addColorStop(1, '#d9cfc2');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    },
    pipR: () => 0.09,
    glow(ctx, s) {
      // Thin edges and corners pass more light than the thick middle.
      const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.72);
      g.addColorStop(0, '#2a0105');
      g.addColorStop(1, '#8a0716');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    },
  },
  // Light hardwood with burned-in pips.
  wood: {
    body(ctx, s, face) {
      ctx.fillStyle = '#c08a52';
      ctx.fillRect(0, 0, s, s);
      const phase = face * 1.7;
      ctx.lineWidth = Math.max(1, s / 160);
      for (let i = 0; i < 46; i++) {
        const base = (i / 46) * s * 1.2 - s * 0.1;
        const tone = hash(i, face, 5);
        ctx.strokeStyle = tone > 0.5 ? 'rgba(110,62,28,0.35)' : 'rgba(230,180,120,0.25)';
        ctx.beginPath();
        for (let x = 0; x <= s; x += s / 24) {
          const y =
            base +
            Math.sin((x / s) * 3.1 + phase + i * 0.35) * s * 0.035 +
            Math.sin((x / s) * 11 + i) * s * 0.006;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      radial(ctx, s, 'rgba(255,220,170,0.0)', 'rgba(80,40,10,0.28)');
    },
    pip(ctx, x, y, r) {
      const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.35);
      halo.addColorStop(0, 'rgba(60,25,5,0.55)');
      halo.addColorStop(1, 'rgba(60,25,5,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
      recessedPip(ctx, x, y, r, '#120802', '#3b1e0b');
    },
    pipR: () => 0.09,
  },
};

/** Distance of the outer pips from the face centre, as a fraction of the face. */
const PIP_SPREAD = 0.255;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

type Layer = 'color' | 'glow' | 'bump';

function paintAtlas(id: DieMaterialId, cell: number, layer: Layer): HTMLCanvasElement {
  const style = STYLES[id];
  const [c, ctx] = canvas(cell * ATLAS_COLS, cell * ATLAS_ROWS);
  for (const face of FACES) {
    const [col, row] = atlasCell(face);
    ctx.save();
    ctx.translate(col * cell, row * cell);
    ctx.beginPath();
    ctx.rect(0, 0, cell, cell);
    ctx.clip();
    if (layer === 'color') style.body(ctx, cell, face);
    else if (layer === 'glow') style.glow?.(ctx, cell);
    else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cell, cell);
    }
    const r = style.pipR(face) * cell;
    for (const [px, py] of PIP_LAYOUT[face]) {
      const x = cell / 2 + px * PIP_SPREAD * cell;
      const y = cell / 2 + py * PIP_SPREAD * cell;
      if (layer === 'color') style.pip(ctx, x, y, r, face);
      else {
        // Pips are opaque paint (no glow) and drilled (lower in the bump map).
        const g = ctx.createRadialGradient(x, y, r * 0.55, x, y, r * 1.08);
        g.addColorStop(0, layer === 'bump' ? '#5a5a5a' : '#000000');
        g.addColorStop(1, layer === 'bump' ? '#ffffff' : 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.08, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  return c;
}

function texture(c: HTMLCanvasElement, srgb: boolean): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- materials

const materials = new Map<string, Material>();

/**
 * Shared material per (material id, tier). Low tier: 128 px cells, no bump map, no clearcoat.
 * Never disposed (a few hundred KB of canvas at most); see disposeDiceAssets().
 */
export function dieMaterial(id: string | undefined, tier: Tier): Material {
  const kind = resolveDieMaterial(id);
  const key = `${kind}:${tier}`;
  const hit = materials.get(key);
  if (hit) return hit;
  const cell = tier === 'low' ? 128 : 256;
  const map = texture(paintAtlas(kind, cell, 'color'), true);
  const bumpMap = tier === 'low' ? null : texture(paintAtlas(kind, cell, 'bump'), false);
  let m: Material;
  if (kind === 'red-casino') {
    const emissiveMap = texture(paintAtlas(kind, cell, 'glow'), true);
    const common = {
      map,
      emissiveMap,
      emissive: new Color('#ffffff'),
      emissiveIntensity: 0.35,
      roughness: 0.16,
      metalness: 0,
      envMapIntensity: 1.25,
    };
    m =
      tier === 'low'
        ? new MeshStandardMaterial(common)
        : new MeshPhysicalMaterial({ ...common, clearcoat: 1, clearcoatRoughness: 0.05, ior: 1.5 });
  } else if (kind === 'wood') {
    m = new MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: 1.4,
      roughness: 0.6,
      envMapIntensity: 0.6,
    });
  } else {
    m =
      tier === 'high'
        ? new MeshPhysicalMaterial({
            map,
            bumpMap,
            bumpScale: 1.6,
            roughness: 0.34,
            clearcoat: 0.5,
            clearcoatRoughness: 0.2,
            envMapIntensity: 0.9,
          })
        : new MeshStandardMaterial({
            map,
            bumpMap,
            bumpScale: 1.6,
            roughness: 0.32,
            envMapIntensity: 0.9,
          });
  }
  m.name = `die:${key}`;
  materials.set(key, m);
  return m;
}

export function disposeDiceAssets(): void {
  for (const m of materials.values()) {
    const s = m as MeshStandardMaterial;
    s.map?.dispose();
    s.bumpMap?.dispose();
    s.emissiveMap?.dispose();
    m.dispose();
  }
  materials.clear();
  for (const g of geometries.values()) g.dispose();
  geometries.clear();
}
