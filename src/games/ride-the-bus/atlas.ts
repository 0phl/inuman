import { CanvasTexture, SRGBColorSpace, type MeshPhysicalMaterial, type Texture } from 'three';
import type { Card } from '@/core/primitives/deck';
import { CARD_TEX_H, CARD_TEX_W, cardMaterial, drawCardFace } from '@/three/cardTextures';

// Ride the Bus can have ~50 face-up cards out at once (everyone's hand plus the pyramid), more than
// the shared face-texture cache holds. Small cards come from one half-resolution atlas of all 52
// faces instead: one canvas, one GPU upload, and a cheap per-card texture view (offset/repeat) and
// material, created once and kept for the session.

const COLS = 13;
const ROWS = 4;
const CW = CARD_TEX_W / 2;
const CH = CARD_TEX_H / 2;
/** Gutter around each face so mipmaps don't bleed into the neighbour. */
const PAD = 4;
const W = COLS * (CW + 2 * PAD);
const H = ROWS * (CH + 2 * PAD);

let materials: MeshPhysicalMaterial[] | null = null;

function build(): MeshPhysicalMaterial[] {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (ctx) {
    for (let card = 0; card < 52; card++) {
      ctx.save();
      ctx.translate(
        (card % COLS) * (CW + 2 * PAD) + PAD,
        Math.floor(card / COLS) * (CH + 2 * PAD) + PAD,
      );
      ctx.scale(CW / CARD_TEX_W, CH / CARD_TEX_H);
      drawCardFace(ctx, card);
      ctx.restore();
    }
  }
  const atlas = new CanvasTexture(c);
  atlas.colorSpace = SRGBColorSpace;
  atlas.anisotropy = 4;
  // Every view shares the atlas's source, so the GPU holds the image once.
  return Array.from({ length: 52 }, (_, card) => {
    const view: Texture = atlas.clone();
    const x0 = (card % COLS) * (CW + 2 * PAD) + PAD;
    const y0 = Math.floor(card / COLS) * (CH + 2 * PAD) + PAD;
    view.repeat.set(CW / W, CH / H);
    // Canvas rows run down, UVs run up (flipY).
    view.offset.set(x0 / W, 1 - (y0 + CH) / H);
    return cardMaterial(view);
  });
}

/** The shared material for a small face-up card. Never dispose it. */
export function atlasFaceMaterial(card: Card): MeshPhysicalMaterial {
  materials ??= build();
  return materials[((card % 52) + 52) % 52] as MeshPhysicalMaterial;
}
