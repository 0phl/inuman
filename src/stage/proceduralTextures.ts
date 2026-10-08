import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

// Everything here is drawn at runtime: no downloads, works offline.

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i * 17);
    amp *= 0.5;
    f *= 2;
  }
  return sum / (1 - Math.pow(0.5, octaves));
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Narra planks: colour map + roughness map (planks run along X). */
export function woodTextures(size: number): { map: Texture; roughnessMap: Texture } {
  const [c, ctx] = makeCanvas(size, size);
  const [rc, rctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const rough = rctx.createImageData(size, size);
  const planks = 9;
  const plankH = size / planks;
  const dark = [46, 24, 12];
  const light = [118, 70, 38];
  for (let y = 0; y < size; y++) {
    const plank = Math.floor(y / plankH);
    const local = (y % plankH) / plankH;
    const tint = 0.85 + hash(plank, 3, 9) * 0.3;
    const offset = hash(plank, 7, 1) * 1000;
    for (let x = 0; x < size; x++) {
      const nx = (x + offset) / size;
      // Long, tight grain along the plank with a gentle warp.
      const warp = fbm(nx * 2.5, local * 1.5 + plank, 11) * 2.2;
      const rings = 0.5 + 0.5 * Math.sin((local * 16 + warp) * Math.PI * 2);
      const streak = fbm(nx * 60, local * 6 + plank * 3, 23, 2);
      let t = Math.pow(rings, 3) * 0.45 + streak * 0.55;
      const edge = Math.min(local, 1 - local) * plankH;
      const seam = edge < 1.5 ? 0.35 : edge < 3 ? 0.75 : 1;
      t *= seam;
      const i = (y * size + x) * 4;
      img.data[i] = mix(dark[0] as number, light[0] as number, t) * tint;
      img.data[i + 1] = mix(dark[1] as number, light[1] as number, t) * tint;
      img.data[i + 2] = mix(dark[2] as number, light[2] as number, t) * tint;
      img.data[i + 3] = 255;
      const r = Math.min(255, (0.48 + (1 - rings) * 0.22 + (1 - seam) * 0.3) * 255);
      rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = r;
      rough.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rough, 0, 0);
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const roughnessMap = new CanvasTexture(rc);
  roughnessMap.colorSpace = NoColorSpace;
  return { map, roughnessMap };
}

/** Grey felt fibres, multiplied by the theme's felt colour; tiles. */
export function feltTexture(size: number): Texture {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 6, y / 6, 5, 2) * 0.55 + hash(x, y, 77) * 0.45;
      const v = 200 + n * 55;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

/** Soft radial falloff used for blob shadows and bokeh. */
export function softDiscTexture(size = 64, hardness = 0.15): Texture {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hardness, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = NoColorSpace;
  return tex;
}

/** A rounded-rectangle shadow with a soft edge, for cards and decks. */
export function blobShadowTexture(): Texture {
  const w = 96;
  const h = 128;
  const [c, ctx] = makeCanvas(w, h);
  // shadowBlur (not ctx.filter) so older iOS Safari blurs too: draw off-canvas, keep only the shadow.
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = w * 2;
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath();
  ctx.roundRect(18 - w * 2, 18, w - 36, h - 36, 8);
  ctx.fill();
  const tex = new CanvasTexture(c);
  tex.colorSpace = NoColorSpace;
  return tex;
}
