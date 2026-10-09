import {
  CanvasTexture,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Card } from '@/core/primitives/deck';
import { CARD_TEX_H, CARD_TEX_W, drawCardBack, drawCardFace, resolveCardBack } from './cardArt';
import { RefCache } from './lru';

export { CARD_TEX_H, CARD_TEX_W, cardBackIds, drawCardBack, drawCardFace } from './cardArt';

/**
 * Surface finish shared by every card on the table (MeshPhysicalMaterial, for specularIntensity).
 * The pendant hangs straight over the table and the camera looks down at it, so cards sit near the
 * mirror direction of the key light: at full specular they catch a warm-white veil that lifts green
 * and blue and turns red backs coral. Low specular and a weak environment sheen keep reds red; the
 * cost over MeshStandardMaterial is negligible with clearcoat/sheen/transmission off.
 */
export const CARD_FINISH = {
  roughness: 0.55,
  metalness: 0,
  envMapIntensity: 0.45,
  specularIntensity: 0.25,
} as const;

/** The paper edge every Card3D shares (never disposed). */
export const cardEdgeMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

/** A card-surface material over `map` (callers own and dispose it; the map belongs to the caches). */
export const cardMaterial = (map: Texture): MeshPhysicalMaterial =>
  new MeshPhysicalMaterial({ ...CARD_FINISH, map });

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

// ---------------------------------------------------------------- caches

/**
 * Face textures are reference counted: every face-up Card3D holds its texture for as long as it
 * shows it, so a table with any number of distinct faces never loses one that is still on screen
 * (disposing a texture in use makes three re-upload it, and that copy is never freed). Up to
 * FACE_CAPACITY textures are kept in total; beyond that, only faces nobody shows are disposed.
 */
export const FACE_CAPACITY = 12;

const faces = new RefCache<Card, Texture>(
  FACE_CAPACITY,
  (card) => {
    const [c, ctx] = canvas();
    drawCardFace(ctx, card);
    return toTexture(c);
  },
  (tex) => tex.dispose(),
);

/** Only four backs exist (unknown ids fall back to the red one), so they're simply kept. */
const backs = new Map<string, Texture>();
let edge: Texture | null = null;

/** Pins and returns the face texture for `card`. Pair every call with `releaseCardFace(card)`. */
export function acquireCardFace(card: Card): Texture {
  return faces.acquire(card);
}

export function releaseCardFace(card: Card): void {
  faces.release(card);
}

/** Debug/test view of the face cache. */
export const cardFaceStats = (card?: Card) => ({
  size: faces.size,
  refs: card === undefined ? 0 : faces.refs(card),
  cached: card === undefined ? false : faces.has(card),
});

export function cardBackTexture(id: string): Texture {
  const key = resolveCardBack(id);
  let tex = backs.get(key);
  if (!tex) {
    const [c, ctx] = canvas();
    drawCardBack(ctx, key);
    tex = toTexture(c);
    backs.set(key, tex);
  }
  return tex;
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
  for (const tex of backs.values()) tex.dispose();
  backs.clear();
  edge?.dispose();
  edge = null;
}
