import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Kind } from '@/core/games/truth-or-dare/prompts';
import { TAU, hash01 } from '../spin-the-bottle/spin';

// The perya prize wheel for Truth or Dare: eight segments, TRUTH in felt green and DARE in chili
// red, a narra band studded with bulbs, sign-painted lettering. Angles are in the wheel's own
// plane, counter-clockwise from +X as seen from the front; the pointer sits at the top (π/2).

export const SEGMENTS = 8;
export const SEG = TAU / SEGMENTS;

/** Even segments are TRUTH, odd ones DARE. */
export const segmentKind = (k: number): Kind => (k % 2 === 0 ? 'truth' : 'dare');

/** Wheel rotation that stops segment `k` under the pointer, `offset` (rad) off its centre. */
export const angleForSegment = (k: number, offset = 0): number =>
  Math.PI / 2 - (k + 0.5) * SEG - offset;

/** A segment of `kind` and a landing spot inside it, the same every time for the same seed. */
export function landingFor(kind: Kind, seed: number): number {
  const first = kind === 'truth' ? 0 : 1;
  const k = first + 2 * Math.floor(hash01(seed * 3.17 + 0.3) * (SEGMENTS / 2));
  const offset = (hash01(seed * 5.91 + 1.7) * 2 - 1) * SEG * 0.32;
  return angleForSegment(k, offset);
}

/**
 * How far the pointer's flapper is pushed by the peg it is riding over, 0..1, for a wheel
 * angle `psi` turning clockwise (pegs sit on the segment boundaries).
 */
export function flapAt(psi: number): number {
  const under = Math.PI / 2 - psi;
  const phase = (((under / SEG) % 1) + 1) % 1;
  const t = Math.min(1, Math.max(0, (phase - 0.74) / 0.26));
  return t * t * (3 - 2 * t);
}

const SIGN = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";

const COLORS: Record<Kind, [string, string]> = {
  truth: ['#3a8c5f', '#1a4a31'],
  dare: ['#ef5a3c', '#9e2814'],
};

function drawWheel(ctx: CanvasRenderingContext2D, s: number, labels: Record<Kind, string>) {
  const c = s / 2;
  const rFace = s * 0.43;
  const rBand = s * 0.488;
  ctx.clearRect(0, 0, s, s);

  // Narra band behind everything.
  const band = ctx.createRadialGradient(c, c, rFace, c, c, rBand);
  band.addColorStop(0, '#3a2414');
  band.addColorStop(0.6, '#24150b');
  band.addColorStop(1, '#140b05');
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.arc(c, c, s / 2, 0, TAU);
  ctx.fill();

  // Segments. Canvas y runs down, so the wheel's angle a is drawn at canvas angle −a.
  for (let k = 0; k < SEGMENTS; k++) {
    const kind = segmentKind(k);
    const [hi, lo] = COLORS[kind];
    const g = ctx.createRadialGradient(c, c, s * 0.06, c, c, rFace);
    g.addColorStop(0, lo);
    g.addColorStop(0.55, hi);
    g.addColorStop(1, lo);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, rFace, -(k + 1) * SEG, -k * SEG);
    ctx.closePath();
    ctx.fill();
  }

  // Brass spokes on the boundaries and a brass ring around the face.
  ctx.strokeStyle = '#e8b04a';
  ctx.lineWidth = s * 0.008;
  for (let k = 0; k < SEGMENTS; k++) {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(-k * SEG) * rFace, c + Math.sin(-k * SEG) * rFace);
    ctx.stroke();
  }
  ctx.lineWidth = s * 0.014;
  ctx.beginPath();
  ctx.arc(c, c, rFace, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(243,201,119,0.5)';
  ctx.lineWidth = s * 0.004;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.497, 0, TAU);
  ctx.stroke();

  // Bulbs around the band, alternating warm and white.
  const bulbs = 24;
  for (let i = 0; i < bulbs; i++) {
    const a = (i / bulbs) * TAU + SEG / 6;
    const x = c + Math.cos(a) * s * 0.459;
    const y = c + Math.sin(a) * s * 0.459;
    const r = s * 0.017;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    glow.addColorStop(0, i % 2 ? 'rgba(255,214,140,0.9)' : 'rgba(255,246,220,0.9)');
    glow.addColorStop(0.4, i % 2 ? 'rgba(232,176,74,0.55)' : 'rgba(255,230,180,0.45)');
    glow.addColorStop(1, 'rgba(232,176,74,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = i % 2 ? '#ffe2a8' : '#fff8ea';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // Lettering along each segment's bisector, reading outward.
  for (let k = 0; k < SEGMENTS; k++) {
    const kind = segmentKind(k);
    const label = labels[kind].toUpperCase();
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(-(k + 0.5) * SEG);
    let px = s * 0.07;
    ctx.font = `400 ${px}px ${SIGN}`;
    const room = rFace - s * 0.15;
    while (ctx.measureText(label).width > room && px > s * 0.035) {
      px -= 2;
      ctx.font = `400 ${px}px ${SIGN}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = s * 0.13 + room / 2 + s * 0.012;
    const d = px * 0.07;
    ctx.fillStyle = '#0e0805';
    ctx.fillText(label, x + d * 2, d * 2);
    ctx.fillStyle = kind === 'dare' ? '#5a1408' : '#0f2a1c';
    ctx.fillText(label, x + d, d);
    ctx.fillStyle = kind === 'dare' ? '#fff3dc' : '#f8deaa';
    ctx.fillText(label, x, 0);
    ctx.restore();
  }
}

/** The wheel face (1024²). The caller owns it; `onRedraw` fires once the sign font has loaded. */
export function wheelTexture(labels: Record<Kind, string>, onRedraw?: () => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  if (ctx) drawWheel(ctx, c.width, labels);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  if (ctx && typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load('72px Bungee').then(() => {
      drawWheel(ctx, c.width, labels);
      tex.needsUpdate = true;
      onRedraw?.();
    });
  }
  return tex;
}
