import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { isRed, rankKey, suitOf, type Card, type Suit } from '@/core/primitives/deck';
import { LruCache } from './lru';

/** Canvas size for faces/backs. 5:7 like a poker card. */
export const CARD_TEX_W = 320;
export const CARD_TEX_H = 448;

const INK_RED = '#b3121f';
const INK_BLACK = '#17130f';
const PAPER = '#f8f2e4';
const SERIF = "700 {px}px Georgia, 'Noto Serif', 'Times New Roman', serif";
const font = (px: number) => SERIF.replace('{px}', String(Math.round(px)));

function canvas(w = CARD_TEX_W, h = CARD_TEX_H): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------------------------------------------------------------- suits (drawn as paths, no glyph fonts)

/** Draws a suit centred on (0,0) with nominal size `s` (≈ height). */
function suitPath(ctx: CanvasRenderingContext2D, suit: Suit, s: number) {
  ctx.beginPath();
  switch (suit) {
    case 'H':
      ctx.moveTo(0, 0.45 * s);
      ctx.bezierCurveTo(-0.16 * s, 0.3 * s, -0.5 * s, 0.1 * s, -0.5 * s, -0.15 * s);
      ctx.bezierCurveTo(-0.5 * s, -0.43 * s, -0.12 * s, -0.5 * s, 0, -0.24 * s);
      ctx.bezierCurveTo(0.12 * s, -0.5 * s, 0.5 * s, -0.43 * s, 0.5 * s, -0.15 * s);
      ctx.bezierCurveTo(0.5 * s, 0.1 * s, 0.16 * s, 0.3 * s, 0, 0.45 * s);
      break;
    case 'D':
      ctx.moveTo(0, -0.5 * s);
      ctx.quadraticCurveTo(0.12 * s, -0.14 * s, 0.38 * s, 0);
      ctx.quadraticCurveTo(0.12 * s, 0.14 * s, 0, 0.5 * s);
      ctx.quadraticCurveTo(-0.12 * s, 0.14 * s, -0.38 * s, 0);
      ctx.quadraticCurveTo(-0.12 * s, -0.14 * s, 0, -0.5 * s);
      break;
    case 'S':
      ctx.moveTo(0, -0.5 * s);
      ctx.bezierCurveTo(-0.16 * s, -0.32 * s, -0.5 * s, -0.14 * s, -0.5 * s, 0.1 * s);
      ctx.bezierCurveTo(-0.5 * s, 0.34 * s, -0.16 * s, 0.38 * s, -0.04 * s, 0.2 * s);
      ctx.quadraticCurveTo(-0.08 * s, 0.42 * s, -0.2 * s, 0.5 * s);
      ctx.lineTo(0.2 * s, 0.5 * s);
      ctx.quadraticCurveTo(0.08 * s, 0.42 * s, 0.04 * s, 0.2 * s);
      ctx.bezierCurveTo(0.16 * s, 0.38 * s, 0.5 * s, 0.34 * s, 0.5 * s, 0.1 * s);
      ctx.bezierCurveTo(0.5 * s, -0.14 * s, 0.16 * s, -0.32 * s, 0, -0.5 * s);
      break;
    case 'C': {
      const r = 0.2 * s;
      ctx.moveTo(r, -0.24 * s);
      ctx.arc(0, -0.24 * s, r, 0, Math.PI * 2);
      ctx.moveTo(-0.24 * s + r, 0.08 * s);
      ctx.arc(-0.24 * s, 0.08 * s, r, 0, Math.PI * 2);
      ctx.moveTo(0.24 * s + r, 0.08 * s);
      ctx.arc(0.24 * s, 0.08 * s, r, 0, Math.PI * 2);
      ctx.moveTo(-0.1 * s, -0.05 * s);
      ctx.lineTo(0.1 * s, -0.05 * s);
      ctx.lineTo(0.1 * s, 0.12 * s);
      ctx.lineTo(-0.1 * s, 0.12 * s);
      ctx.closePath();
      ctx.moveTo(0, 0.1 * s);
      ctx.quadraticCurveTo(-0.06 * s, 0.42 * s, -0.2 * s, 0.5 * s);
      ctx.lineTo(0.2 * s, 0.5 * s);
      ctx.quadraticCurveTo(0.06 * s, 0.42 * s, 0, 0.1 * s);
      break;
    }
  }
}

function drawSuit(
  ctx: CanvasRenderingContext2D,
  suit: Suit,
  x: number,
  y: number,
  s: number,
  flip = false,
) {
  ctx.save();
  ctx.translate(x, y);
  if (flip) ctx.rotate(Math.PI);
  suitPath(ctx, suit, s);
  ctx.fill('nonzero');
  ctx.restore();
}

// ---------------------------------------------------------------- faces

/** Pip positions in a [-1,1] box, standard layouts. */
const PIPS: Record<number, [number, number][]> = {
  2: [
    [0, -1],
    [0, 1],
  ],
  3: [
    [0, -1],
    [0, 0],
    [0, 1],
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
  7: [
    [-1, -1],
    [1, -1],
    [0, -0.5],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
  8: [
    [-1, -1],
    [1, -1],
    [0, -0.5],
    [-1, 0],
    [1, 0],
    [0, 0.5],
    [-1, 1],
    [1, 1],
  ],
  9: [
    [-1, -1],
    [1, -1],
    [-1, -1 / 3],
    [1, -1 / 3],
    [0, 0],
    [-1, 1 / 3],
    [1, 1 / 3],
    [-1, 1],
    [1, 1],
  ],
  10: [
    [-1, -1],
    [1, -1],
    [0, -2 / 3],
    [-1, -1 / 3],
    [1, -1 / 3],
    [-1, 1 / 3],
    [1, 1 / 3],
    [0, 2 / 3],
    [-1, 1],
    [1, 1],
  ],
};

function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#fbf7ec');
  g.addColorStop(1, '#efe6d2');
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, w * 0.07);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,40,20,0.25)';
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, w - 2, h - 2, w * 0.07);
  ctx.stroke();
}

function drawIndex(ctx: CanvasRenderingContext2D, label: string, suit: Suit, w: number, h: number) {
  const corner = () => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(label === '10' ? w * 0.12 : w * 0.14);
    ctx.fillText(label, w * 0.11, h * 0.115);
    drawSuit(ctx, suit, w * 0.11, h * 0.165, w * 0.085);
  };
  corner();
  ctx.save();
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  corner();
  ctx.restore();
}

function drawCourt(
  ctx: CanvasRenderingContext2D,
  label: string,
  suit: Suit,
  ink: string,
  w: number,
  h: number,
) {
  const x = w * 0.2;
  const y = h * 0.14;
  const fw = w * 0.6;
  const fh = h * 0.72;
  // Gilded frame
  ctx.fillStyle = '#f1e2b9';
  roundRect(ctx, x, y, fw, fh, 10);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = ink;
  roundRect(ctx, x, y, fw, fh, 10);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#b8892f';
  roundRect(ctx, x + 6, y + 6, fw - 12, fh - 12, 7);
  ctx.stroke();
  // Diagonal divide like a double-headed court card
  ctx.beginPath();
  ctx.moveTo(x + 8, y + fh - 8);
  ctx.lineTo(x + fw - 8, y + 8);
  ctx.strokeStyle = 'rgba(184,137,47,0.6)';
  ctx.stroke();

  const half = () => {
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = font(w * 0.27);
    ctx.fillText(label, w * 0.42, h * 0.39);
    drawSuit(ctx, suit, w * 0.62, h * 0.29, w * 0.15);
  };
  half();
  ctx.save();
  ctx.translate(w, h);
  ctx.rotate(Math.PI);
  half();
  ctx.restore();
}

export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  card: Card,
  w = CARD_TEX_W,
  h = CARD_TEX_H,
) {
  const suit = suitOf(card);
  const label = rankKey(card);
  const ink = isRed(card) ? INK_RED : INK_BLACK;
  drawPaper(ctx, w, h);
  ctx.fillStyle = ink;
  drawIndex(ctx, label, suit, w, h);

  if (label === 'A') {
    const s = suit === 'S' ? w * 0.5 : w * 0.38;
    drawSuit(ctx, suit, w / 2, h / 2, s);
    if (suit === 'S') {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 - s * 0.05, s * 0.12, s * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }
  if (label === 'J' || label === 'Q' || label === 'K') {
    drawCourt(ctx, label, suit, ink, w, h);
    return;
  }
  const layout = PIPS[Number(label)] ?? [];
  const px = w * 0.2;
  const py = h * 0.3;
  for (const [ux, uy] of layout) {
    drawSuit(ctx, suit, w / 2 + ux * px, h / 2 + uy * py, w * 0.15, uy > 0.01);
  }
}

// ---------------------------------------------------------------- backs

type BackPainter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function framedBack(base: string, line: string, accent: string): BackPainter {
  return (ctx, w, h) => {
    const m = w * 0.06;
    ctx.fillStyle = PAPER;
    roundRect(ctx, 0, 0, w, h, w * 0.07);
    ctx.fill();
    ctx.fillStyle = base;
    roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
    ctx.fill();
    ctx.save();
    roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
    ctx.clip();
    // Diamond lattice
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    const step = w * 0.07;
    for (let i = -h; i < w + h; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.moveTo(i, h);
      ctx.lineTo(i + h, 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    roundRect(ctx, m + 8, m + 8, w - 2 * m - 16, h - 2 * m - 16, w * 0.03);
    ctx.stroke();
    // Centre medallion: a bottle cap
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.fillStyle = base;
    ctx.beginPath();
    const teeth = 21;
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 ? w * 0.15 : w * 0.165;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };
}

/** Banig: a woven pandan mat, over-under strips with dyed diamond bands. */
const banigBack: BackPainter = (ctx, w, h) => {
  const m = w * 0.05;
  ctx.fillStyle = '#e7cf9c';
  roundRect(ctx, 0, 0, w, h, w * 0.07);
  ctx.fill();
  ctx.save();
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
  ctx.clip();
  const cell = 16;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const dyes = ['#d9b77a', '#b0185a', '#d9b77a', '#2f7d4a', '#e3a21a', '#5b2a86'];
  const cx = cols / 2;
  const cy = rows / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d = Math.abs(i + 0.5 - cx) + Math.abs(j + 0.5 - cy);
      const band = Math.floor(d / 2.5) % dyes.length;
      const x = i * cell;
      const y = j * cell;
      ctx.fillStyle = dyes[band] as string;
      ctx.fillRect(x, y, cell, cell);
      // Over/under shading
      const horizontal = (i + j) % 2 === 0;
      const g = horizontal
        ? ctx.createLinearGradient(x, y, x, y + cell)
        : ctx.createLinearGradient(x, y, x + cell, y);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.28)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = 'rgba(40,20,5,0.35)';
      if (horizontal) ctx.fillRect(x, y + cell - 1.5, cell, 1.5);
      else ctx.fillRect(x + cell - 1.5, y, 1.5, cell);
    }
  }
  ctx.restore();
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = 3;
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
  ctx.stroke();
};

/** Jeepney: chrome trim, loud stripes and the eight-rayed sun. */
const jeepneyBack: BackPainter = (ctx, w, h) => {
  const chrome = ctx.createLinearGradient(0, 0, w, h);
  chrome.addColorStop(0, '#f4f4f4');
  chrome.addColorStop(0.45, '#9aa3ab');
  chrome.addColorStop(0.55, '#e8ecef');
  chrome.addColorStop(1, '#7d868f');
  ctx.fillStyle = chrome;
  roundRect(ctx, 0, 0, w, h, w * 0.07);
  ctx.fill();
  const m = w * 0.06;
  ctx.save();
  roundRect(ctx, m, m, w - 2 * m, h - 2 * m, w * 0.04);
  ctx.clip();
  const stripes = [
    '#c8102e',
    '#ffd100',
    '#0038a8',
    '#ffffff',
    '#c8102e',
    '#14853b',
    '#ffd100',
    '#0038a8',
  ];
  const sh = (h - 2 * m) / stripes.length;
  stripes.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, m + i * sh, w, sh + 1);
  });
  // Diagonal speed slashes
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = -h; x < w; x += 46) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 18, h);
    ctx.lineTo(x + 18 + h * 0.5, 0);
    ctx.lineTo(x + h * 0.5, 0);
    ctx.fill();
  }
  ctx.restore();
  // Sun medallion
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.fillStyle = '#0b1f4d';
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8ecef';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#ffd100';
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(-w * 0.025, w * 0.06);
    ctx.lineTo(0, w * 0.17);
    ctx.lineTo(w * 0.025, w * 0.06);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

const BACKS: Record<string, BackPainter> = {
  'classic-red': framedBack('#9e1b22', 'rgba(255,230,200,0.22)', '#f1d7a8'),
  'classic-blue': framedBack('#1d3f7a', 'rgba(220,235,255,0.22)', '#e3ecf7'),
  banig: banigBack,
  jeepney: jeepneyBack,
};

export const cardBackIds = (): string[] => Object.keys(BACKS);

// ---------------------------------------------------------------- caches

const faces = new LruCache<Card, Texture>(12, (tex) => tex.dispose());
const backs = new LruCache<string, Texture>(4, (tex) => tex.dispose());
let edge: Texture | null = null;

export function cardFaceTexture(card: Card): Texture {
  return faces.getOrCreate(card, () => {
    const [c, ctx] = canvas();
    drawCardFace(ctx, card);
    return toTexture(c);
  });
}

export function cardBackTexture(id: string): Texture {
  const key = id in BACKS ? id : 'classic-red';
  return backs.getOrCreate(key, () => {
    const [c, ctx] = canvas();
    (BACKS[key] as BackPainter)(ctx, CARD_TEX_W, CARD_TEX_H);
    return toTexture(c);
  });
}

/** Thin layered-paper stripes for deck sides; repeat on V per card. */
export function deckEdgeTexture(): Texture {
  if (edge) return edge;
  const [c, ctx] = canvas(8, 8);
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillStyle = 'rgba(90,70,45,0.45)';
  ctx.fillRect(0, 6, 8, 2);
  const tex = toTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  edge = tex;
  return tex;
}

export function disposeCardTextures(): void {
  faces.clear();
  backs.clear();
  edge?.dispose();
  edge = null;
}
