import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { CARD_TEX_H, CARD_TEX_W } from '@/three/cardTextures';
import { LruCache } from '@/three/lru';

// Most Likely To's tent card: the same hand-painted narra placard as Never Have I Ever's, lettered
// MOST / LIKELY / TO, with the round on a crown cork. Plus the crown cork the votes are counted in.

const SIGN = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";
const NARRA_DARK = '#150c07';
const NARRA = '#2c1a0f';
const BRASS_HI = '#f3c977';
const BRASS = '#e8b04a';
const BRASS_LO = '#a8772a';
const SILI = '#b8341f';
const SOOT = '#0e0805';

function board(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, NARRA);
  g.addColorStop(1, NARRA_DARK);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, w * 0.07);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, w * 0.07);
  ctx.clip();
  for (let i = 0; i < 46; i++) {
    const y = (i / 46) * h + Math.sin(i * 7.31) * 4;
    ctx.strokeStyle = i % 3 ? 'rgba(255,220,170,0.035)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = i % 3 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + Math.sin(i) * 6, w * 0.7, y - Math.cos(i) * 6, w, y + 2);
    ctx.stroke();
  }
  ctx.restore();
  const brass = ctx.createLinearGradient(0, 0, w, h);
  brass.addColorStop(0, BRASS_HI);
  brass.addColorStop(0.5, BRASS_LO);
  brass.addColorStop(1, BRASS);
  ctx.strokeStyle = brass;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(11, 11, w - 22, h - 22, w * 0.045);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(243,201,119,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(22, 22, w - 44, h - 44, w * 0.03);
  ctx.stroke();
}

function crown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i <= 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    const rr = i % 2 ? r * 0.92 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.fill();
  ctx.strokeStyle = BRASS_LO;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function signText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  maxW: number,
) {
  ctx.font = `${px}px ${SIGN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const d = px * 0.07;
  ctx.fillStyle = SOOT;
  ctx.fillText(text, x + d * 2, y + d * 2, maxW);
  ctx.fillStyle = SILI;
  ctx.fillText(text, x + d, y + d, maxW);
  ctx.fillStyle = BRASS_HI;
  ctx.fillText(text, x, y, maxW);
}

function drawFace(ctx: CanvasRenderingContext2D, round: number) {
  const w = CARD_TEX_W;
  const h = CARD_TEX_H;
  board(ctx, w, h);
  const maxW = w - 70;
  signText(ctx, 'MOST', w / 2, 126, 66, maxW);
  signText(ctx, 'LIKELY', w / 2, 196, 66, maxW);
  signText(ctx, 'TO…', w / 2, 266, 66, maxW);
  ctx.strokeStyle = 'rgba(243,201,119,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(70, 302);
  ctx.lineTo(w - 70, 302);
  ctx.stroke();
  crown(ctx, w / 2, 366, 46, BRASS);
  if (round > 0) {
    const label = String(round);
    ctx.fillStyle = SOOT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${label.length > 2 ? 26 : 34}px ${SIGN}`;
    ctx.fillText(label, w / 2, 369, 64);
  }
}

const faces = new LruCache<string, Texture>(4, (t) => t.dispose());

/** The tent's face for a round. `fontReady` is part of the key so it redraws once Bungee loads. */
export function mltFaceTexture(round: number, fontReady: boolean): Texture {
  return faces.getOrCreate(`${round}:${fontReady ? 1 : 0}`, () => {
    const c = document.createElement('canvas');
    c.width = CARD_TEX_W;
    c.height = CARD_TEX_H;
    const ctx = c.getContext('2d');
    if (ctx) drawFace(ctx, round);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

let cap: Texture | null = null;

/**
 * Top of a crown cork, light so each instance's colour tints it: a pressed rim ring, a star and
 * fine radial ribs.
 */
export function capTexture(): Texture {
  if (cap) return cap;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  if (ctx) {
    const m = s / 2;
    const g = ctx.createRadialGradient(m * 0.8, m * 0.7, 4, m, m, m);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#d9d2c4');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(60,30,10,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m, m, m * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(m, m, m * 0.68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,248,230,0.95)';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? m * 0.2 : m * 0.46;
      ctx.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  cap = tex;
  return tex;
}
