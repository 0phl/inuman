import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { rulesSchema as hlRules } from '@/core/games/higher-lower/logic';
import { getAt, rulesFields, setAt, type FieldNode } from './rulesForm';

const byKey = (fields: FieldNode[], key: string) => fields.find((f) => f.key === key) as FieldNode;

describe('rulesFields', () => {
  it('maps Higher-or-Lower rules to controls with their labels', () => {
    const fields = rulesFields(hlRules);
    expect(fields.map((f) => f.kind)).toEqual(['number', 'enum', 'enum', 'number', 'boolean']);
    const wrong = byKey(fields, 'wrongSips');
    expect(wrong).toMatchObject({ kind: 'number', min: 1, max: 5, step: 1, integer: true, label: 'rules.hl.wrongSips' });
    expect(byKey(fields, 'tie')).toMatchObject({ kind: 'enum', options: ['lose', 'safe', 'social'] });
  });

  it('recurses into nested objects (Kings Cup style card tables)', () => {
    const card = z.object({
      title: z.string().max(40).default('i18n:kc.card.A.title').meta({ label: 'rules.kc.title' }),
      sips: z.number().int().min(0).max(5).default(2).meta({ label: 'rules.kc.sips' }),
    });
    const schema = z.object({
      cards: z
        .object({ A: card.default({ title: 'i18n:kc.card.A.title', sips: 2 }), K: card.default({ title: 'x', sips: 1 }) })
        .default({ A: { title: 'i18n:kc.card.A.title', sips: 2 }, K: { title: 'x', sips: 1 } })
        .meta({ label: 'rules.kc.cards' }),
      speed: z.union([z.literal(0.5), z.literal(1)]).default(1).meta({ label: 'rules.kc.speed' }),
    });
    const fields = rulesFields(schema);
    const cards = byKey(fields, 'cards');
    expect(cards.kind).toBe('group');
    if (cards.kind !== 'group') throw new Error('expected group');
    expect(cards.children.map((c) => c.key)).toEqual(['A', 'K']);
    const a = cards.children[0] as FieldNode;
    if (a.kind !== 'group') throw new Error('expected group');
    expect(a.label).toBeUndefined();
    expect(a.children[0]).toMatchObject({ kind: 'string', path: ['cards', 'A', 'title'], maxLength: 40 });
    expect(byKey(fields, 'speed')).toMatchObject({ kind: 'enum', options: [0.5, 1] });
  });
});

describe('getAt / setAt', () => {
  it('reads and writes nested values immutably', () => {
    const src = { cards: { A: { sips: 2 } }, other: 1 };
    const next = setAt(src, ['cards', 'A', 'sips'], 4);
    expect(getAt(next, ['cards', 'A', 'sips'])).toBe(4);
    expect(src.cards.A.sips).toBe(2);
    expect(next.other).toBe(1);
  });
});
