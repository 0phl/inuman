import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  LatheGeometry,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type BufferGeometry,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { brassMaterial, narraMaterial } from './dice3d';

// The leather dice cup's parts (Mexico, Liar's Dice), outside the component file so the Lobby's
// warm-up can build them ahead of time.

export const CUP_H = 0.4;
export const CUP_R_BOT = 0.15;
export const CUP_R_TOP = 0.172;
const INNER_FLOOR = 0.026;
const outerR = (y: number) => CUP_R_BOT + ((CUP_R_TOP - CUP_R_BOT) * y) / CUP_H;

interface CupParts {
  outer: BufferGeometry;
  inner: BufferGeometry;
  stitches: BufferGeometry;
  leather: MeshStandardMaterial;
  suede: MeshStandardMaterial;
  thread: MeshStandardMaterial;
}

let cupParts: CupParts | null = null;

/** The dice cup's geometry and materials, built once and shared by every cup on the table. */
export function diceCupParts(): CupParts {
  cupParts ??= makeCupParts();
  return cupParts;
}

/** Oxblood leather: mottled grain plus faint vertical creases, tiled around the cup. */
function leatherTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#8a3a1f';
    ctx.fillRect(0, 0, 256, 256);
    let s = 0x51ed27;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * 256;
      const y = rnd() * 256;
      const r = 0.6 + rnd() * 2.6;
      const dark = rnd() < 0.6;
      ctx.fillStyle = dark
        ? `rgba(40,10,4,${0.08 + rnd() * 0.14})`
        : `rgba(255,190,140,${0.03 + rnd() * 0.06})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256;
      ctx.strokeStyle = `rgba(30,8,2,${0.08 + rnd() * 0.1})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, 80, x - 6, 170, x + rnd() * 8, 256);
      ctx.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

function makeCupParts(): CupParts {
  const v = (r: number, y: number) => new Vector2(r, y);
  const outer = new LatheGeometry(
    [
      v(0.0001, 0),
      v(CUP_R_BOT - 0.012, 0),
      v(CUP_R_BOT + 0.006, 0.012),
      v(CUP_R_BOT + 0.008, 0.05),
      v(outerR(0.062), 0.062),
      v(outerR(CUP_H - 0.06), CUP_H - 0.06),
      v(outerR(CUP_H - 0.05) + 0.006, CUP_H - 0.048),
      v(CUP_R_TOP + 0.008, CUP_H - 0.008),
      v(CUP_R_TOP + 0.003, CUP_H + 0.003),
      v(CUP_R_TOP - 0.006, CUP_H + 0.003),
    ],
    40,
  );
  const inner = new LatheGeometry(
    [
      v(CUP_R_TOP - 0.006, CUP_H + 0.003),
      v(CUP_R_TOP - 0.011, CUP_H - 0.02),
      v(CUP_R_BOT - 0.012, INNER_FLOOR),
      v(0.0001, INNER_FLOOR),
    ],
    40,
  );
  // Saddle stitching: two rings of short tangential dashes, merged into one geometry.
  const dashes: BufferGeometry[] = [];
  const PER_RING = 44;
  for (const y of [0.079, CUP_H - 0.07]) {
    const r = outerR(y) + 0.0035;
    for (let i = 0; i < PER_RING; i++) {
      const a = (i / PER_RING) * Math.PI * 2;
      const d = new BoxGeometry(0.016, 0.005, 0.004);
      d.rotateY(-a + Math.PI / 2);
      d.translate(r * Math.cos(a), y, r * Math.sin(a));
      dashes.push(d);
    }
  }
  const stitches = mergeGeometries(dashes) ?? new BoxGeometry(0, 0, 0);
  dashes.forEach((d) => d.dispose());
  return {
    outer,
    inner,
    stitches,
    leather: (() => {
      const map = leatherTexture();
      return new MeshStandardMaterial({
        color: '#b8644a',
        map,
        roughness: 0.56,
        metalness: 0,
        envMapIntensity: 0.75,
        // A little of its own grain so the cup never reads as a black hole when it's lifted.
        emissive: '#ffffff',
        emissiveMap: map,
        emissiveIntensity: 0.16,
      });
    })(),
    suede: new MeshStandardMaterial({ color: '#160c08', roughness: 1, side: DoubleSide }),
    thread: new MeshStandardMaterial({ color: '#e9d7ad', roughness: 0.85 }),
  };
}

/**
 * Paints the dice games' canvas textures (leather cup, narra wood) ahead of time: ~30 ms of
 * main-thread work at 4× CPU that the Lobby's warm-up pays instead of the first frame of play.
 */
export function prepareDiceLooks(): void {
  diceCupParts();
  narraMaterial();
  brassMaterial();
}
