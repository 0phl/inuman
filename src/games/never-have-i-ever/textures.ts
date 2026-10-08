import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { CARD_TEX_H, CARD_TEX_W } from '@/three/cardTextures';
import { LruCache } from '@/three/lru';

// Prompt cards are not playing cards: a hand-painted narra placard with brass trim, lettered like
// a jeepney sign. The prompt itself is shown in the HUD; the 3D card only carries the title and
// the round number on a bottle cap.

export const SIGN_FONT = '64px Bungee';
const SIGN_STACK = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";

const NARRA_DARK = '#150c07';
const NARRA = '#2c1a0f';
const BRASS_HI = '#f3c977';
const BRASS = '#e8b04a';
const BRASS_LO = '#a8772a';
const SILI = '#b8341f';
const SOOT = '#0e0805';

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = CARD_TEX_W;
  c.height = CARD_TEX_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function board(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, NARRA);
  g.addColorStop(1, NARRA_DARK);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, w * 0.07);
  ctx.fill();
  // Grain
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
  // Brass frame
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
  const teeth = 21;
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
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

/** Sign-pintor lettering: soot and chili drop layers under a brass fill. */
function signText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  maxW: number,
) {
  ctx.font = `${px}px ${SIGN_STACK}`;
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

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.7, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s * 0.7, y);
  ctx.closePath();
  ctx.fill();
}

function drawFace(ctx: CanvasRenderingContext2D, round: number) {
  const w = CARD_TEX_W;
  const h = CARD_TEX_H;
  board(ctx, w, h);
  ctx.fillStyle = BRASS;
  for (const [x, y] of [
    [40, 40],
    [w - 40, 40],
    [40, h - 40],
    [w - 40, h - 40],
  ] as const)
    diamond(ctx, x, y, 7);

  const maxW = w - 70;
  signText(ctx, 'NEVER', w / 2, 128, 64, maxW);
  signText(ctx, 'HAVE I', w / 2, 196, 64, maxW);
  signText(ctx, 'EVER', w / 2, 264, 64, maxW);

  // Rule between title and cap
  ctx.strokeStyle = 'rgba(243,201,119,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(70, 302);
  ctx.lineTo(w - 70, 302);
  ctx.stroke();
  ctx.fillStyle = BRASS;
  diamond(ctx, w / 2, 302, 6);

  crown(ctx, w / 2, 366, 46, BRASS);
  if (round > 0) {
    const label = String(round);
    ctx.fillStyle = SOOT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${label.length > 2 ? 26 : 34}px ${SIGN_STACK}`;
    ctx.fillText(label, w / 2, 369, 64);
  }
}

/** Inside of the tent and the backs of the cards still in the stack. */
function drawBack(ctx: CanvasRenderingContext2D) {
  const w = CARD_TEX_W;
  const h = CARD_TEX_H;
  board(ctx, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(26, 26, w - 52, h - 52, w * 0.03);
  ctx.clip();
  ctx.strokeStyle = 'rgba(243,201,119,0.16)';
  ctx.lineWidth = 2;
  const step = w * 0.08;
  for (let i = -h; i < w + h; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.moveTo(i, h);
    ctx.lineTo(i + h, 0);
    ctx.stroke();
  }
  ctx.restore();
  crown(ctx, w / 2, h / 2, 50, BRASS);
  crown(ctx, w / 2, h / 2, 30, NARRA);
}

const faces = new LruCache<string, Texture>(4, (t) => t.dispose());
let back: Texture | null = null;

/** The decorative face for a round. `fontReady` is part of the key so it redraws once Bungee loads. */
export function promptFaceTexture(round: number, fontReady: boolean): Texture {
  return faces.getOrCreate(`${round}:${fontReady ? 1 : 0}`, () => {
    const [c, ctx] = canvas();
    drawFace(ctx, round);
    return toTexture(c);
  });
}

export function promptBackTexture(): Texture {
  if (back) return back;
  const [c, ctx] = canvas();
  drawBack(ctx);
  back = toTexture(c);
  return back;
}
