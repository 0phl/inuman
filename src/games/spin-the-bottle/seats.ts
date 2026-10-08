import { CanvasTexture, SRGBColorSpace } from 'three';

// Seat layout and name-plaque textures for the games that sit everyone around the table (Spin the
// Bottle, Most Likely To, Ride the Bus).

const SIGN_FONT = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";

/** idle: narra plate · turn: brass (whose move it is) · picked: chili red (the bottle / the vote) · dim: out of it. */
export type PlateTone = 'idle' | 'turn' | 'picked' | 'dim';

const TONES: Record<
  PlateTone,
  { top: string; bottom: string; rim: string; ink: string; drop: string | null }
> = {
  idle: { top: '#2c1a0f', bottom: '#170d07', rim: '#a8772a', ink: '#f6ecd9', drop: '#0e0805' },
  turn: { top: '#f8deaa', bottom: '#c9913a', rim: '#7a5216', ink: '#1a100b', drop: null },
  picked: { top: '#ef6a4f', bottom: '#a52d18', rim: '#f3c977', ink: '#fff6e6', drop: '#4a1208' },
  dim: { top: '#20140d', bottom: '#120b07', rim: '#4d3423', ink: '#a8916f', drop: null },
};

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, px: number): string {
  let size = px;
  ctx.font = `400 ${size}px ${SIGN_FONT}`;
  while (ctx.measureText(text).width > max && size > 22) {
    size -= 2;
    ctx.font = `400 ${size}px ${SIGN_FONT}`;
  }
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function drawPlate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  name: string,
  tone: PlateTone,
) {
  const c = TONES[tone];
  ctx.clearRect(0, 0, w, h);
  const plate = new Path2D();
  plate.roundRect(4, 4, w - 8, h - 8, 26);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, c.top);
  g.addColorStop(1, c.bottom);
  ctx.fillStyle = g;
  ctx.fill(plate);
  ctx.lineWidth = 6;
  ctx.strokeStyle = c.rim;
  ctx.stroke(plate);
  // Inner hairline, like the brass trim on the HUD panels.
  ctx.lineWidth = 2;
  ctx.strokeStyle = tone === 'turn' ? 'rgba(90,55,10,0.45)' : 'rgba(243,201,119,0.35)';
  const inner = new Path2D();
  inner.roundRect(15, 15, w - 30, h - 30, 18);
  ctx.stroke(inner);

  const label = fit(ctx, name.toUpperCase(), w - 60, 66);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (c.drop) {
    ctx.fillStyle = c.drop;
    ctx.fillText(label, w / 2 + 4, h / 2 + 7);
  }
  ctx.fillStyle = c.ink;
  ctx.fillText(label, w / 2, h / 2 + 3);
}

/** A 512 × 128 plaque texture. The caller owns it (dispose when the name or tone changes). */
export function plateTexture(name: string, tone: PlateTone, onRedraw?: () => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) drawPlate(ctx, c.width, c.height, name, tone);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  // The sign font may still be loading: redraw once it's in.
  if (ctx && typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load('66px Bungee').then(() => {
      drawPlate(ctx, c.width, c.height, name, tone);
      tex.needsUpdate = true;
      onRedraw?.();
    });
  }
  return tex;
}

export interface Seat {
  x: number;
  z: number;
  /** Angle on the oval (x = cx + rx·cos φ, z = cz + rz·sin φ). */
  phi: number;
}

/**
 * `n` seats on an oval. Seat 0 sits nearest the camera (φ = π/2) and play passes to the left, so
 * the next seat is the one to seat 0's left (−x). With `span` < 2π the seats fill an arc centred on
 * `centre` (radians) instead, ends included.
 */
export function ovalSeats(
  n: number,
  o: { cx?: number; cz: number; rx: number; rz: number; span?: number; centre?: number },
): Seat[] {
  const cx = o.cx ?? 0;
  const span = o.span ?? Math.PI * 2;
  const full = span >= Math.PI * 2 - 1e-6;
  const centre = o.centre ?? Math.PI / 2;
  return Array.from({ length: n }, (_, i) => {
    const phi = full
      ? Math.PI / 2 + (i * Math.PI * 2) / Math.max(n, 1)
      : n <= 1
        ? centre
        : centre - span / 2 + (i * span) / (n - 1);
    return { x: cx + o.rx * Math.cos(phi), z: o.cz + o.rz * Math.sin(phi), phi };
  });
}

/** Plaque width that keeps neighbours from touching on a ring of `n` around `perimeter`. */
export const plateWidthFor = (n: number, perimeter: number, max = 0.56, min = 0.3): number =>
  Math.min(max, Math.max(min, (perimeter / Math.max(n, 1)) * 0.9));
