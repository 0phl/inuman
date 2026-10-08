import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { beats } from '@/core/games/liars-dice/logic';
import type { Face } from '@/core/primitives/dice';
import {
  clampDraft,
  FACES,
  isLegalBid,
  legalFaces,
  minQuantity,
  suggestBid,
  type BidDraft,
} from './bidding';

const face = fc.constantFrom<Face>(...FACES);
const table = fc.integer({ min: 2, max: 120 });
const lastBid = (total: number) =>
  fc.record({ quantity: fc.integer({ min: 1, max: total }), face });

describe("Liar's Dice bid composer", () => {
  it('minQuantity is exactly the smallest count that beats the last bid', () => {
    fc.assert(
      fc.property(
        table.chain((t) => fc.tuple(fc.constant(t), lastBid(t), face)),
        ([, last, f]) => {
          const q = minQuantity(last, f);
          expect(beats({ quantity: q, face: f }, last)).toBe(true);
          expect(beats({ quantity: q - 1, face: f }, last)).toBe(false);
        },
      ),
    );
  });

  it('a clamped draft is legal whenever its face is', () => {
    fc.assert(
      fc.property(
        table.chain((t) =>
          fc.tuple(
            fc.constant(t),
            fc.option(lastBid(t), { nil: null }),
            face,
            fc.integer({ min: -5, max: 200 }),
          ),
        ),
        ([total, last, f, q]) => {
          const d = clampDraft({ quantity: q, face: f }, last, total);
          expect(isLegalBid(d, last, total)).toBe(legalFaces(last, total).includes(f));
        },
      ),
    );
  });

  it('the suggestion is legal whenever any raise exists', () => {
    fc.assert(
      fc.property(
        table.chain((t) =>
          fc.tuple(fc.constant(t), fc.option(lastBid(t), { nil: null }), fc.boolean()),
        ),
        ([total, last, wild]) => {
          const s = suggestBid(last, total, wild);
          expect(isLegalBid(s, last, total)).toBe(legalFaces(last, total).length > 0);
        },
      ),
    );
  });

  it('opens on 2s and raises past a 6 to the next count', () => {
    expect(suggestBid(null, 15, true)).toEqual({ quantity: 3, face: 2 });
    expect(suggestBid({ quantity: 4, face: 5 }, 15, true)).toEqual({ quantity: 4, face: 6 });
    expect(suggestBid({ quantity: 4, face: 6 }, 15, true)).toEqual({ quantity: 5, face: 2 });
    expect(suggestBid({ quantity: 4, face: 6 }, 15, false)).toEqual({ quantity: 5, face: 1 });
    const top: BidDraft = { quantity: 15, face: 6 };
    expect(legalFaces(top, 15)).toEqual([]);
  });
});
