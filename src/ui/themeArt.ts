import type { Theme } from '@/core/content/schemas';
import { drawCardBack, drawCardFace } from '@/three/cardArt';

// Flat canvas art for the "Itsura ng mesa" picker: a small lit table vignette that previews a whole
// theme, plus the dice tiles. Drawn in CSS pixels (the caller scales for devicePixelRatio). No
// three.js: it renders instantly in Settings, the Lobby and the import preview.

/** King of hearts (suit H = 1, rank K = 13 → 13 + 11). */
const KING_OF_HEARTS = 24;

const hash = (i: number, j: number) => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Mixes a hex colour toward black (t < 0) or white (t > 0). */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t),
  );
  return `rgb(${ch.join(',')})`;
}

const cardCache = new Map<string, HTMLCanvasElement>();

/** A card face or back pre-rendered at a fixed size, reused across redraws. */
function cardImage(kind: 'back' | 'face', id: string, px: number): HTMLCanvasElement {
  const key = `${kind}:${id}:${px}`;
  let c = cardCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round(px * 1.4);
  const ctx = c.getContext('2d');
  if (ctx) {
    if (kind === 'back') drawCardBack(ctx, id, c.width, c.height, 'screen');
    else drawCardFace(ctx, Number(id), c.width, c.height, 'screen');
  }
  if (cardCache.size > 24) cardCache.clear();
  cardCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- rooms

function diveBarRoom(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wall = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  wall.addColorStop(0, '#1e0f08');
  wall.addColorStop(1, '#2c160b');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // Vertical wainscot boards.
  const board = w / 13;
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.18)' : 'rgba(255,200,150,0.035)';
    ctx.fillRect(i * board, 0, board, h * 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(i * board, 0, Math.max(1, w / 340), h * 0.5);
  }
  // The neon sign: brass frame, pink tubes.
  const sw = w * 0.5;
  const sh = h * 0.2;
  const sx = (w - sw) / 2;
  const sy = h * 0.07;
  ctx.save();
  ctx.shadowColor = 'rgba(255,170,80,0.7)';
  ctx.shadowBlur = h * 0.05;
  ctx.strokeStyle = '#e8b04a';
  ctx.lineWidth = Math.max(1.2, h * 0.012);
  ctx.beginPath();
  ctx.roundRect(sx, sy, sw, sh, h * 0.025);
  ctx.stroke();
  ctx.fillStyle = 'rgba(30,8,24,0.75)';
  ctx.fill();
  ctx.font = `400 ${Math.round(sh * 0.62)}px Bungee, 'Arial Black', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff3d8a';
  ctx.shadowBlur = h * 0.06;
  ctx.lineWidth = Math.max(1, h * 0.008);
  ctx.strokeStyle = '#ff8ec0';
  ctx.strokeText('INUMAN', w / 2, sy + sh * 0.54);
  ctx.fillStyle = 'rgba(255,120,180,0.35)';
  ctx.fillText('INUMAN', w / 2, sy + sh * 0.54);
  ctx.restore();
  // A cool videoke-screen glow at the right edge.
  const tv = ctx.createRadialGradient(w * 1.02, h * 0.3, 0, w * 1.02, h * 0.3, w * 0.22);
  tv.addColorStop(0, 'rgba(63,182,201,0.35)');
  tv.addColorStop(1, 'rgba(63,182,201,0)');
  ctx.fillStyle = tv;
  ctx.fillRect(0, 0, w, h);
}

function proceduralRoom(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const wall = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  wall.addColorStop(0, '#2a1a10');
  wall.addColorStop(1, '#3a2416');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  // Two back-bar shelves with a row of bottles each.
  const colours = ['#3d6b3a', '#7a4a1c', '#2d4f6b', '#8a2a2a', '#c9913a', '#4a3a5c'];
  for (const [row, y] of [h * 0.2, h * 0.38].entries()) {
    ctx.fillStyle = '#4d3423';
    ctx.fillRect(0, y, w, Math.max(2, h * 0.018));
    for (let i = 0; i < 16; i++) {
      const bw = w * 0.022;
      const bh = h * (0.08 + hash(i, row) * 0.05);
      const bx = w * 0.04 + i * w * 0.06 + hash(row, i) * w * 0.012;
      ctx.fillStyle = colours[(i + row * 3) % colours.length] as string;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.roundRect(bx, y - bh, bw, bh, bw * 0.35);
      ctx.fill();
      ctx.fillRect(bx + bw * 0.32, y - bh - bh * 0.3, bw * 0.36, bh * 0.32);
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------- table pieces

function tableAndFelt(ctx: CanvasRenderingContext2D, w: number, h: number, felt: string) {
  // Narra table top in perspective.
  ctx.beginPath();
  ctx.moveTo(w * 0.02, h * 0.46);
  ctx.lineTo(w * 0.98, h * 0.46);
  ctx.lineTo(w * 1.15, h);
  ctx.lineTo(-w * 0.15, h);
  ctx.closePath();
  const wood = ctx.createLinearGradient(0, h * 0.46, 0, h);
  wood.addColorStop(0, '#8a5230');
  wood.addColorStop(1, '#4a2614');
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(40,18,6,0.28)';
  ctx.lineWidth = Math.max(0.6, w / 500);
  for (let i = 0; i < 22; i++) {
    const y = h * 0.46 + (i / 22) * h * 0.56;
    ctx.beginPath();
    ctx.moveTo(-w * 0.2, y);
    ctx.bezierCurveTo(w * 0.3, y + h * 0.01, w * 0.6, y - h * 0.012, w * 1.2, y + h * 0.004);
    ctx.stroke();
  }
  ctx.restore();

  // Felt mat with a brass inlay.
  const mat = new Path2D();
  mat.moveTo(w * 0.15, h * 0.53);
  mat.lineTo(w * 0.85, h * 0.53);
  mat.lineTo(w * 1.0, h * 1.02);
  mat.lineTo(w * 0.0, h * 1.02);
  mat.closePath();
  ctx.strokeStyle = '#c9913a';
  ctx.lineWidth = Math.max(1.5, h * 0.016);
  ctx.stroke(mat);
  ctx.fillStyle = felt;
  ctx.fill(mat);
  ctx.save();
  ctx.clip(mat);
  // Fibres.
  for (let i = 0; i < 900; i++) {
    const x = hash(i, 1) * w;
    const y = h * 0.53 + hash(i, 2) * h * 0.5;
    ctx.fillStyle = hash(i, 3) > 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function lightPool(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // The pendant's warm pool on the table, and the room falling off into the dark.
  const pool = ctx.createRadialGradient(w * 0.5, h * 0.72, 0, w * 0.5, h * 0.72, w * 0.55);
  pool.addColorStop(0, 'rgba(255,190,120,0.16)');
  pool.addColorStop(1, 'rgba(255,190,120,0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.6, w * 0.3, w * 0.5, h * 0.6, w * 0.8);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function softShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lyingCard(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  cw: number,
  angle: number,
) {
  const ch = cw * 1.4;
  softShadow(ctx, x + cw * 0.06, y + ch * 0.06, cw * 0.75, ch * 0.42);
  ctx.save();
  ctx.translate(x, y);
  // Seen from above at an angle: the table squashes things vertically.
  ctx.scale(1, 0.72);
  ctx.rotate(angle);
  ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch);
  ctx.restore();
}

/** A red-cup style party cup seen from the side, base at (x, y). */
export function drawPartyCup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  height: number,
  color: string,
) {
  const top = height * 0.72;
  const bottom = height * 0.5;
  softShadow(ctx, x, y, bottom * 0.9, bottom * 0.28);
  const body = new Path2D();
  body.moveTo(x - top / 2, y - height);
  body.lineTo(x + top / 2, y - height);
  body.lineTo(x + bottom / 2, y);
  body.lineTo(x - bottom / 2, y);
  body.closePath();
  const g = ctx.createLinearGradient(x - top / 2, 0, x + top / 2, 0);
  g.addColorStop(0, shade(color, -0.45));
  g.addColorStop(0.28, color);
  g.addColorStop(0.42, shade(color, 0.32));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, -0.55));
  ctx.fillStyle = g;
  ctx.fill(body);
  // Moulded steps.
  ctx.strokeStyle = shade(color, -0.35);
  ctx.lineWidth = Math.max(0.8, height * 0.025);
  for (const f of [0.4, 0.66]) {
    const yy = y - height * f;
    const half = (bottom + (top - bottom) * f) / 2;
    ctx.beginPath();
    ctx.moveTo(x - half, yy);
    ctx.lineTo(x + half, yy);
    ctx.stroke();
  }
  // White inside and the rolled lip.
  ctx.fillStyle = '#efe7d8';
  ctx.beginPath();
  ctx.ellipse(x, y - height, top / 2, top * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(80,50,30,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y - height + top * 0.03, top * 0.4, top * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(color, 0.15);
  ctx.lineWidth = Math.max(1, height * 0.04);
  ctx.beginPath();
  ctx.ellipse(x, y - height, top / 2, top * 0.16, 0, 0, Math.PI * 2);
  ctx.stroke();
}

// ---------------------------------------------------------------- dice

const PIPS: Record<number, [number, number][]> = {
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

interface DieLook {
  body: string;
  side: string;
  edge: string;
  pip(face: number): string;
  grain?: boolean;
}

const DICE: Record<string, DieLook> = {
  // Ivory with the Asian-style red ace and red four.
  ivory: {
    body: '#f6eedc',
    side: '#d9c7a2',
    edge: '#b9a47c',
    pip: (f) => (f === 1 || f === 4 ? '#c8161f' : '#221a14'),
  },
  'red-casino': {
    body: '#c4141f',
    side: '#7c0912',
    edge: '#5a050c',
    pip: () => '#fbf6ee',
  },
  wood: {
    body: '#c99460',
    side: '#9a6638',
    edge: '#6e4422',
    pip: () => '#3b1e0b',
    grain: true,
  },
};

/** A die seen slightly from above: top face `face`, a strip of front face below it. */
export function drawDie(
  ctx: CanvasRenderingContext2D,
  material: string,
  face: number,
  x: number,
  y: number,
  size: number,
) {
  const look = DICE[material] ?? (DICE.ivory as DieLook);
  const r = size * 0.18;
  const front = size * 0.32;
  softShadow(ctx, x + size * 0.08, y + size * 0.62, size * 0.75, size * 0.22);
  // Front face (darker), then the top face over it.
  ctx.fillStyle = look.side;
  ctx.beginPath();
  ctx.roundRect(x - size / 2, y - size / 2 + front * 0.4, size, size * 0.7 + front * 0.6, r);
  ctx.fill();
  ctx.fillStyle = look.body;
  ctx.beginPath();
  ctx.roundRect(x - size / 2, y - size / 2, size, size * 0.86, r);
  ctx.fill();
  if (look.grain) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(110,62,28,0.32)';
    ctx.lineWidth = Math.max(0.6, size / 40);
    for (let i = 0; i < 6; i++) {
      const yy = y - size / 2 + (i + 0.5) * (size / 6);
      ctx.beginPath();
      ctx.moveTo(x - size / 2, yy);
      ctx.quadraticCurveTo(x, yy + size * 0.06 * (i % 2 ? 1 : -1), x + size / 2, yy);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = look.edge;
  ctx.lineWidth = Math.max(0.8, size / 36);
  ctx.beginPath();
  ctx.roundRect(x - size / 2, y - size / 2, size, size * 0.86, r);
  ctx.stroke();
  // Pips on the top face (squashed like the face).
  const pr = (face === 1 ? 0.15 : 0.085) * size;
  for (const [px, py] of PIPS[face] ?? []) {
    ctx.fillStyle = look.pip(face);
    ctx.beginPath();
    ctx.ellipse(
      x + px * size * 0.25,
      y - size * 0.07 + py * size * 0.22,
      pr,
      pr * 0.86,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

// ---------------------------------------------------------------- the vignette

export interface PreviewOptions {
  /** Leave out the cards, cup and dice (environment thumbnails). */
  bare?: boolean;
}

/** The whole look in one picture: the room, the felt, a card back and a king, the cup and dice. */
export function drawTablePreview(
  ctx: CanvasRenderingContext2D,
  theme: Theme,
  w: number,
  h: number,
  opts: PreviewOptions = {},
) {
  ctx.clearRect(0, 0, w, h);
  if (theme.environmentId === 'procedural-bar') proceduralRoom(ctx, w, h);
  else diveBarRoom(ctx, w, h);
  tableAndFelt(ctx, w, h, theme.feltColor);

  if (!opts.bare) {
    const cw = Math.min(w * 0.14, h * 0.26);
    const px = Math.max(48, Math.round(cw * 2.5));
    lyingCard(ctx, cardImage('back', theme.cardBack, px), w * 0.34, h * 0.76, cw, -0.24);
    lyingCard(ctx, cardImage('face', String(KING_OF_HEARTS), px), w * 0.5, h * 0.8, cw, 0.12);
    drawPartyCup(ctx, w * 0.74, h * 0.78, h * 0.4, theme.cupColor);
    const ds = Math.min(w * 0.075, h * 0.13);
    drawDie(ctx, theme.diceMaterialId, 5, w * 0.15, h * 0.76, ds);
    drawDie(ctx, theme.diceMaterialId, 1, w * 0.23, h * 0.88, ds);
  }
  lightPool(ctx, w, h);
}

/** A felt swatch: the colour with fibre speckle and a brass rim, for CSS `background`. */
export const feltSwatchCss = (hex: string): string =>
  `radial-gradient(circle at 35% 30%, ${rgba('#ffffff', 0.14)}, transparent 55%), radial-gradient(${rgba('#000000', 0.22)} 0.8px, transparent 1px) 0 0 / 4px 4px, ${hex}`;
