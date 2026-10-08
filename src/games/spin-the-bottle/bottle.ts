import {
  CanvasTexture,
  CylinderGeometry,
  LatheGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector2,
  type BufferGeometry,
} from 'three';

// A plain long-neck beer bottle in amber glass: no brand, just a cream paper label with a crown
// cork motif and a foil collar. Lying on its side along +X (neck forward), origin = the spin
// pivot, a little toward the heavy end.

export const BOTTLE_R = 0.112;
export const BOTTLE_L = 0.94;
/** Distance from the base to the pivot along the axis. */
const PIVOT = 0.4;
const LABEL_Y0 = 0.13;
const LABEL_Y1 = 0.37;

export interface BottleParts {
  glass: BufferGeometry;
  label: BufferGeometry;
  foil: BufferGeometry;
  glassMat: MeshPhysicalMaterial;
  labelMat: MeshStandardMaterial;
  foilMat: MeshStandardMaterial;
}

let parts: BottleParts | null = null;

/** Turns a geometry built along +Y (base at y = 0) into one lying along +X around the pivot. */
const layDown = <G extends BufferGeometry>(g: G): G => {
  g.rotateZ(-Math.PI / 2);
  g.translate(-PIVOT, 0, 0);
  return g;
};

function labelTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const w = c.width;
    const h = c.height;
    const paper = ctx.createLinearGradient(0, 0, 0, h);
    paper.addColorStop(0, '#f3e6c8');
    paper.addColorStop(1, '#e2cfa6');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b8341f';
    ctx.fillRect(0, 8, w, 10);
    ctx.fillRect(0, h - 18, w, 10);
    ctx.fillStyle = '#c9913a';
    ctx.fillRect(0, 22, w, 3);
    ctx.fillRect(0, h - 25, w, 3);
    // Two crown-cork medallions around the wrap so one always faces up.
    for (const cx of [w * 0.25, w * 0.75]) {
      ctx.save();
      ctx.translate(cx, h / 2);
      ctx.fillStyle = '#c9913a';
      ctx.beginPath();
      for (let i = 0; i <= 42; i++) {
        const a = (i / 42) * Math.PI * 2;
        const r = i % 2 ? 26 : 30;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.fill();
      ctx.fillStyle = '#b8341f';
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f3e6c8';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 5 : 12;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.fill();
      ctx.restore();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function bottleParts(): BottleParts {
  if (parts) return parts;
  const R = BOTTLE_R;
  const v = (r: number, y: number) => new Vector2(r, y);
  const profile = [
    v(0.0001, 0.006),
    v(R * 0.55, 0.01),
    v(R - 0.016, 0),
    v(R - 0.002, 0.014),
    v(R, 0.04),
    v(R, 0.5),
    v(R * 0.98, 0.535),
    v(R * 0.9, 0.575),
    v(R * 0.74, 0.62),
    v(R * 0.55, 0.665),
    v(0.05, 0.71),
    v(0.044, 0.75),
    v(0.042, 0.86),
    v(0.047, 0.866),
    v(0.05, 0.885),
    v(0.049, 0.925),
    v(0.044, BOTTLE_L),
    v(0.031, BOTTLE_L),
    v(0.029, 0.9),
    v(0.0001, 0.9),
  ];
  const glass = layDown(new LatheGeometry(profile, 36));
  const label = layDown(
    new CylinderGeometry(R + 0.0025, R + 0.0025, LABEL_Y1 - LABEL_Y0, 36, 1, true).translate(
      0,
      (LABEL_Y0 + LABEL_Y1) / 2,
      0,
    ),
  );
  const foil = layDown(
    new CylinderGeometry(0.0465, 0.0485, 0.07, 24, 1, true).translate(0, 0.83, 0),
  );
  const map = labelTexture();
  parts = {
    glass,
    label,
    foil,
    // Dark amber glass: a sharp env reflection carries the shape; a little emissive keeps the
    // body from going black on the low tier (no image-based light there).
    glassMat: new MeshPhysicalMaterial({
      color: '#5a2406',
      roughness: 0.08,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      specularIntensity: 1,
      envMapIntensity: 2.6,
      emissive: '#2a0c02',
      emissiveIntensity: 0.6,
    }),
    labelMat: new MeshStandardMaterial({
      map,
      roughness: 0.75,
      envMapIntensity: 0.6,
      emissive: '#ffffff',
      emissiveMap: map,
      emissiveIntensity: 0.12,
    }),
    foilMat: new MeshStandardMaterial({ color: '#d8a640', metalness: 0.85, roughness: 0.3 }),
  };
  return parts;
}
