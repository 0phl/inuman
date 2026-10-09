import { describe, expect, it } from 'vitest';
import { BUILTIN_PACKS, collectPrompts, isBilingual, LEGACY_BUILTIN_IDS } from './builtin';
import type { PromptPack } from './schemas';

describe('built-in packs', () => {
  it('ships one bilingual pack per prompt game', () => {
    expect(BUILTIN_PACKS.map((p) => [p.id, p.game, p.locale])).toEqual([
      ['builtin-nhie', 'never-have-i-ever', 'any'],
      ['builtin-tod', 'truth-or-dare', 'any'],
      ['builtin-mlt', 'most-likely-to', 'any'],
    ]);
    for (const pack of BUILTIN_PACKS) {
      expect(pack.builtin).toBe(true);
      expect(isBilingual(pack), pack.id).toBe(true);
      for (const item of pack.items) {
        expect(item.text.trim(), item.id).not.toBe('');
        expect(item.alt?.en?.trim(), item.id).toBeTruthy();
      }
    }
  });

  it('uses the same placeholders in both languages of a prompt', () => {
    const slots = (t: string) => [...(t.match(/\{[^}]*\}/g) ?? [])].sort();
    for (const pack of BUILTIN_PACKS)
      for (const item of pack.items)
        expect(slots(item.alt?.en ?? ''), item.id).toEqual(slots(item.text));
  });

  it('maps picks of the old per-language packs to the merged ones', () => {
    const ids = new Set(BUILTIN_PACKS.map((p) => p.id));
    for (const to of Object.values(LEGACY_BUILTIN_IDS)) expect(ids.has(to)).toBe(true);
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

  it('ships a real SPG (spice 3) set in every pack, truths and dares alike', () => {
    for (const pack of BUILTIN_PACKS) {
      const spg = pack.items.filter((i) => i.spice === 3);
      expect(spg.length, `${pack.id} SPG prompts`).toBeGreaterThanOrEqual(20);
      if (pack.game === 'truth-or-dare')
        for (const kind of ['truth', 'dare'])
          expect(
            spg.filter((i) => i.kind === kind).length,
            `${pack.id} SPG ${kind}s`,
          ).toBeGreaterThanOrEqual(15);
    }
  });

  it('keeps every SPG dare that involves another player consensual', () => {
    const asks = /if (they're|they are|both are) (okay|game)|kung (game|okay)/i;
    for (const pack of BUILTIN_PACKS.filter((p) => p.game === 'truth-or-dare')) {
      for (const item of pack.items) {
        if (item.kind !== 'dare' || item.spice < 3) continue;
        if (!/\{(random|left|right)\}/.test(item.text)) continue;
        expect(item.text, item.id).toMatch(asks);
        expect(item.alt?.en ?? '', item.id).toMatch(asks);
      }
    }
  });

  it('only uses known placeholders', () => {
    for (const pack of BUILTIN_PACKS) {
      for (const item of pack.items) {
        for (const ph of `${item.text} ${item.alt?.en ?? ''}`.match(/\{[^}]*\}/g) ?? [])
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
