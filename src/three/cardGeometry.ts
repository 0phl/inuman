import { BufferGeometry, ExtrudeGeometry, Shape, ShapeGeometry } from 'three';

/** Poker proportions in world units (the table is ~4 units wide). */
export const CARD_W = 0.7;
export const CARD_H = 0.98;
export const CARD_T = 0.006;
const RADIUS = 0.055;

/** Height of one card in a stack, in world units. */
export const CARD_STACK_STEP = 0.0045;

export const deckHeight = (count: number): number => Math.max(count, 0) * CARD_STACK_STEP;

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** ShapeGeometry UVs are raw coordinates; remap them to 0..1 across the card. */
function normalizeUv(g: BufferGeometry, w: number, h: number) {
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
}

export interface CardGeometries {
  /** Face-up plane, normal +Y, card top pointing to -Z. */
  front: BufferGeometry;
  /** Underside plane, normal -Y. */
  back: BufferGeometry;
  /** Paper edge (extruded outline), centred on y = 0. */
  edge: BufferGeometry;
  /** Unit-height extrusion for deck stacks (y from 0 to 1); scale Y by stack height. */
  stack: BufferGeometry;
}

let shared: CardGeometries | null = null;

export function cardGeometries(): CardGeometries {
  if (shared) return shared;
  const shape = roundedRect(CARD_W, CARD_H, RADIUS);
  const front = new ShapeGeometry(shape, 5);
  normalizeUv(front, CARD_W, CARD_H);
  const back = front.clone();
  front.rotateX(-Math.PI / 2).translate(0, CARD_T / 2 + 0.0004, 0);
  back.rotateX(Math.PI / 2).translate(0, -CARD_T / 2 - 0.0004, 0);

  const edge = new ExtrudeGeometry(shape, { depth: CARD_T, bevelEnabled: false, curveSegments: 5 });
  edge.translate(0, 0, -CARD_T / 2).rotateX(-Math.PI / 2);

  const stack = new ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 5 });
  stack.rotateX(-Math.PI / 2);

  shared = { front, back, edge, stack };
  return shared;
}
