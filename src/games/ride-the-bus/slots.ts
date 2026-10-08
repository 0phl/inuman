import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { CARD_TEX_H, CARD_TEX_W } from '@/three/cardTextures';

// The four card spots of a deal or a bus run: a dashed brass outline on the felt with the
// question number painted in. The spot waiting for the next answer is brighter.

const SIGN = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";
const cache = new Map<string, Texture>();

function draw(ctx: CanvasRenderingContext2D, n: number, active: boolean) {
  const w = CARD_TEX_W / 2;
  const h = CARD_TEX_H / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = active ? 'rgba(232,176,74,0.16)' : 'rgba(8,22,14,0.32)';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 14);
  ctx.fill();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = active ? 5 : 3.5;
  ctx.strokeStyle = active ? 'rgba(243,201,119,0.95)' : 'rgba(232,176,74,0.5)';
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 16, 12);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${active ? 68 : 60}px ${SIGN}`;
  ctx.fillStyle = active ? 'rgba(248,222,170,0.95)' : 'rgba(232,176,74,0.45)';
  ctx.fillText(String(n), w / 2, h / 2 + 4);
}

/** Spot `n` (1–4). Cached; never dispose. */
export function slotTexture(n: number, active: boolean): Texture {
  const key = `${n}:${active ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = CARD_TEX_W / 2;
  c.height = CARD_TEX_H / 2;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, n, active);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cache.set(key, tex);
  if (ctx && typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load(`60px Bungee`).then(() => {
      draw(ctx, n, active);
      tex.needsUpdate = true;
    });
  }
  return tex;
}
