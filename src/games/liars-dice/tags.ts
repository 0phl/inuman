import { CanvasTexture, SRGBColorSpace } from 'three';

// The little tag in front of each cup: the player's name and how many dice are under it.

const SIGN_FONT = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";
const BODY_FONT = "'Atkinson Hyperlegible Next Variable', 'Atkinson Hyperlegible Next', system-ui, sans-serif";

export type TagTone = 'idle' | 'turn' | 'out';

const PIP5: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [0, 0],
  [-1, 1],
  [1, 1],
];

function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, max: number, px: number) {
  let size = px;
  ctx.font = font(size);
  while (ctx.measureText(text).width > max && size > 14) {
    size -= 2;
    ctx.font = font(size);
  }
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, count: number, tone: TagTone, outLabel: string) {
  ctx.clearRect(0, 0, w, h);
  const plate = new Path2D();
  plate.roundRect(3, 3, w - 6, h - 6, 22);
  if (tone === 'turn') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f3c977');
    g.addColorStop(1, '#c9913a');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = tone === 'out' ? 'rgba(26,16,11,0.82)' : 'rgba(26,16,11,0.92)';
  }
  ctx.fill(plate);
  ctx.lineWidth = 4;
  ctx.strokeStyle = tone === 'turn' ? '#7a5216' : tone === 'out' ? '#6b4a32' : '#a8772a';
  ctx.stroke(plate);

  const ink = tone === 'turn' ? '#1a100b' : tone === 'out' ? '#a8916f' : '#f6ecd9';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  const label = fitText(ctx, name, (px) => `400 ${px}px ${SIGN_FONT}`, w - 150, 40);
  ctx.fillText(label, 24, h / 2 + 2);

  // Right side: a die glyph and ×N, or an OUT stamp.
  if (tone === 'out') {
    ctx.save();
    ctx.translate(w - 66, h / 2);
    ctx.rotate(-0.12);
    ctx.font = `400 26px ${SIGN_FONT}`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#e0482f';
    ctx.lineWidth = 3;
    ctx.strokeRect(-50, -20, 100, 40);
    ctx.fillStyle = '#e0482f';
    ctx.fillText(outLabel.toUpperCase(), 0, 2);
    ctx.restore();
    return;
  }
  const d = 40;
  const x0 = w - 124;
  const y0 = h / 2 - d / 2;
  ctx.fillStyle = '#f4ead6';
  ctx.beginPath();
  ctx.roundRect(x0, y0, d, d, 9);
  ctx.fill();
  ctx.fillStyle = '#24160d';
  for (const [px, py] of PIP5) {
    ctx.beginPath();
    ctx.arc(x0 + d / 2 + px * 10, y0 + d / 2 + py * 10, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ink;
  ctx.font = `700 40px ${BODY_FONT}`;
  ctx.fillText(`×${count}`, x0 + d + 8, h / 2 + 2);
}

/** A 512 × 128 tag texture. The caller owns it (dispose when the label changes). */
export function tagTexture(name: string, count: number, tone: TagTone, outLabel: string, onRedraw?: () => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) draw(ctx, c.width, c.height, name, count, tone, outLabel);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (ctx && typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load('40px Bungee').then(() => {
      draw(ctx, c.width, c.height, name, count, tone, outLabel);
      tex.needsUpdate = true;
      onRedraw?.();
    });
  }
  return tex;
}
