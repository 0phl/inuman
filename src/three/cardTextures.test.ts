import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Texture } from 'three';

// The cache is exercised with real three.js CanvasTextures; only the 2D canvas is faked (node has
// none). Every context call is a no-op that returns the context again (gradients included).
function fakeContext(): CanvasRenderingContext2D {
  const ctx: object = new Proxy(function () {}, {
    get: (_t, prop) => (prop === Symbol.toPrimitive ? () => 0 : ctx),
    set: () => true,
    apply: () => ctx,
  });
  return ctx as CanvasRenderingContext2D;
}

beforeAll(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext() }),
  });
});

const mod = await import('./cardTextures');
const { acquireCardFace, releaseCardFace, cardFaceStats, disposeCardTextures, FACE_CAPACITY } = mod;

const disposals = (tex: Texture) => {
  const spy = vi.fn();
  tex.addEventListener('dispose', spy);
  return spy;
};

afterEach(() => disposeCardTextures());

describe('card face textures', () => {
  it('keeps every face that is on the table, beyond the cache capacity', () => {
    const cards = Array.from({ length: FACE_CAPACITY + 8 }, (_, i) => i);
    const spies = cards.map((c) => disposals(acquireCardFace(c)));
    expect(cardFaceStats().size).toBe(cards.length);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('two cards showing the same face share one texture', () => {
    const a = acquireCardFace(5);
    const b = acquireCardFace(5);
    expect(b).toBe(a);
    expect(cardFaceStats(5).refs).toBe(2);
    releaseCardFace(5);
    expect(cardFaceStats(5).refs).toBe(1);
  });

  it('disposes only faces nobody shows, once over capacity', () => {
    const held = Array.from({ length: FACE_CAPACITY }, (_, i) => i);
    for (const c of held) acquireCardFace(c);
    const gone = disposals(acquireCardFace(40));
    releaseCardFace(40); // 13 entries, 1 idle → that one goes
    expect(gone).toHaveBeenCalledTimes(1);
    expect(cardFaceStats(40).cached).toBe(false);
    // Held faces are untouched; one released while at capacity stays warm.
    releaseCardFace(0);
    expect(cardFaceStats(0).cached).toBe(true);
    expect(cardFaceStats().size).toBe(FACE_CAPACITY);
  });

  it('a released face comes back as the same texture while it is still warm', () => {
    const first = acquireCardFace(9);
    releaseCardFace(9);
    expect(acquireCardFace(9)).toBe(first);
  });
});
