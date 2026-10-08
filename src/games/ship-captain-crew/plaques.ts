import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Face } from '@/core/primitives/dice';

// Canvas textures for the Ship / Captain / Crew dock: engraved brass plaques and the felt slots
// that show which face each role needs. Drawn at runtime, cached per label.

const SIGN_FONT = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";

const plaqueCache = new Map<string, CanvasTexture>();
const slotCache = new Map<Face, Texture>();

function drawPlaque(ctx: CanvasRenderingContext2D, w: number, h: number, label: string) {
  ctx.clearRect(0, 0, w, h);
  const r = 18;
  const plate = new Path2D();
  plate.roundRect(4, 4, w - 8, h - 8, r);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#f2cf7c');
  g.addColorStop(0.35, '#d69b33');
  g.addColorStop(0.7, '#b07524');
  g.addColorStop(1, '#6e4813');
  ctx.fillStyle = g;
  ctx.fill(plate);
  // Brushed streaks.
  ctx.save();
  ctx.clip(plate);
  for (let i = 0; i < 70; i++) {
    const y = (i * 37) % h;
    ctx.fillStyle = i % 3 ? 'rgba(255,240,200,0.06)' : 'rgba(90,55,10,0.07)';
    ctx.fillRect(0, y, w, 1.5);
  }
  ctx.restore();
  // Bevel.
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#6e4a14';
  ctx.stroke(plate);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,245,215,0.75)';
  const inner = new Path2D();
  inner.roundRect(14, 14, w - 28, h - 28, r - 8);
  ctx.stroke(inner);
  // Screws.
  for (const x of [34, w - 34]) {
    const sg = ctx.createRadialGradient(x - 3, h / 2 - 3, 1, x, h / 2, 11);
    sg.addColorStop(0, '#fff2c8');
    sg.addColorStop(1, '#7a5216');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(x, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4a300a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 6, h / 2 + 4);
    ctx.lineTo(x + 6, h / 2 - 4);
    ctx.stroke();
  }
  // Engraved lettering: a light lower lip under dark cut letters.
  let size = 64;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  do {
    ctx.font = `400 ${size}px ${SIGN_FONT}`;
    size -= 4;
  } while (ctx.measureText(label).width > w - 110 && size > 20);
  ctx.fillStyle = 'rgba(255,236,190,0.85)';
  ctx.fillText(label, w / 2, h / 2 + 5);
  ctx.fillStyle = '#241302';
  ctx.fillText(label, w / 2, h / 2 + 1);
}

/** An engraved brass name plate (512 × 128) with the label in sign lettering. */
export function plaqueTexture(label: string, onRedraw?: () => void): Texture {
  const hit = plaqueCache.get(label);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) drawPlaque(ctx, c.width, c.height, label);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  plaqueCache.set(label, tex);
  // The sign font may still be loading the first time: redraw once it's in.
  if (ctx && typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load(`64px Bungee`).then(() => {
      drawPlaque(ctx, c.width, c.height, label);
      tex.needsUpdate = true;
      onRedraw?.();
    });
  }
  return tex;
}

const PIPS: Readonly<Record<Face, readonly (readonly [number, number])[]>> = {
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

/** A sunken felt square with a dashed brass outline and the face it is waiting for, ghosted. */
export function slotTexture(face: Face): Texture {
  const hit = slotCache.get(face);
  if (hit) return hit;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s * 0.7);
    g.addColorStop(0, '#173a28');
    g.addColorStop(1, '#0b1f15');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(4, 4, s - 8, s - 8, 18);
    ctx.fill();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(232,176,74,0.75)';
    ctx.beginPath();
    ctx.roundRect(12, 12, s - 24, s - 24, 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(232,176,74,0.5)';
    for (const [x, y] of PIPS[face]) {
      ctx.beginPath();
      ctx.arc(s / 2 + x * 26, s / 2 + y * 26, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  slotCache.set(face, tex);
  return tex;
}
