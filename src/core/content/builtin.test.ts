import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS, collectPrompts } from './builtin';
import type { PromptPack } from './schemas';

describe('built-in packs', () => {
  it('ships a Taglish and an English pack for every prompt game', () => {
    expect(BUILTIN_PACKS.map((p) => [p.locale, p.game])).toEqual([
      ['taglish', 'never-have-i-ever'],
      ['en', 'never-have-i-ever'],
      ['taglish', 'truth-or-dare'],
      ['en', 'truth-or-dare'],
      ['taglish', 'most-likely-to'],
      ['en', 'most-likely-to'],
    ]);
    for (const pack of BUILTIN_PACKS) expect(pack.builtin).toBe(true);
  });

  it('marks every truth-or-dare item as a truth or a dare, with both at every everyday spice', () => {
    for (const pack of BUILTIN_PACKS.filter((p) => p.game === 'truth-or-dare')) {
      for (const item of pack.items) expect(['truth', 'dare']).toContain(item.kind);
      for (const kind of ['truth', 'dare'])
        for (const spice of [0, 1, 2])
          expect(
            pack.items.filter((i) => i.kind === kind && i.spice === spice).length,
            `${pack.id} ${kind} spice ${spice}`,
          ).toBeGreaterThan(0);
    }
  });

  it('has prompts at every everyday spice level and unique ids', () => {
    for (const pack of BUILTIN_PACKS) {
      for (const spice of [0, 1, 2]) {
        expect(
          pack.items.filter((i) => i.spice === spice).length,
          `${pack.id} spice ${spice}`,
        ).toBeGreaterThan(0);
      }
      const ids = pack.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const all = BUILTIN_PACKS.flatMap((p) => p.items.map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('only uses known placeholders', () => {
    for (const pack of BUILTIN_PACKS) {
      for (const item of pack.items) {
        for (const ph of item.text.match(/\{[^}]*\}/g) ?? [])
          expect(['{player}', '{random}', '{left}', '{right}']).toContain(ph);
      }
    }
  });
});

describe('collectPrompts', () => {
  const pack = (
    id: string,
    items: [string, number][],
    game: PromptPack['game'] = 'never-have-i-ever',
  ): PromptPack => ({
    schema: 1,
    kind: 'pack',
    id,
    name: id,
    game,
    locale: 'any',
    items: items.map(([itemId, spice]) => ({ id: itemId, text: itemId, spice })),
  });

  it('filters by spice and dedupes by id (first wins)', () => {
    const a = pack('a', [
      ['x', 0],
      ['y', 2],
      ['z', 3],
    ]);
    const b = pack('b', [
      ['x', 1],
      ['w', 1],
    ]);
    const out = collectPrompts([a, b], { maxSpice: 2 });
    expect(out.map((i) => i.id)).toEqual(['x', 'y', 'w']);
    expect(out[0]?.spice).toBe(0);
    expect(collectPrompts([a, b], { maxSpice: 0 }).map((i) => i.id)).toEqual(['x']);
  });

  it('can restrict to one game', () => {
    const other = pack('t', [['t1', 0]], 'truth-or-dare');
    expect(
      collectPrompts([other, pack('n', [['n1', 0]])], {
        maxSpice: 3,
        game: 'never-have-i-ever',
      }).map((i) => i.id),
    ).toEqual(['n1']);
  });

  it('works on the built-in packs', () => {
    const mild = collectPrompts(BUILTIN_PACKS, { maxSpice: 0 });
    expect(mild.length).toBeGreaterThan(30);
    expect(mild.every((i) => i.spice === 0)).toBe(true);
  });
});
