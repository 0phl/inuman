import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getLogic } from '@/core/games/registry';
import { uniquePresetName } from '@/store/rules';
import { rulesDiff } from './rulesDiff';
import { hashPayload, safeBack, shareUrl } from './share';

describe('rulesDiff', () => {
  const schema = z.object({
    sips: z.number().int().default(1).meta({ label: 'r.sips' }),
    mode: z.enum(['a', 'b']).default('a').meta({ label: 'r.mode' }),
    card: z
      .object({
        title: z.string().default('x').meta({ label: 'r.card.title' }),
        on: z.boolean().default(false).meta({ label: 'r.card.on' }),
      })
      .default({ title: 'x', on: false })
      .meta({ label: 'r.card' }),
  });

  it('lists only changed leaves, with their group trail', () => {
    expect(rulesDiff(schema, schema.parse({}))).toEqual([]);
    const diff = rulesDiff(schema, schema.parse({ sips: 3, card: { title: 'x', on: true } }));
    expect(diff.map((d) => [d.trail.map((f) => f.label), d.from, d.to])).toEqual([
      [['r.sips'], 1, 3],
      [['r.card', 'r.card.on'], false, true],
    ]);
  });

  it('works on a real game schema', () => {
    const logic = getLogic('higher-lower');
    const rules = logic.rulesSchema.parse({ wrongSips: 2, tie: 'social' });
    expect(rulesDiff(logic.rulesSchema, rules).map((d) => d.field.key)).toEqual([
      'wrongSips',
      'tie',
    ]);
  });
});

describe('share url helpers', () => {
  it('builds and reads /import#s= links', () => {
    const url = shareUrl('1.abc_-', 'https://inuman.app');
    expect(url).toBe('https://inuman.app/import#s=1.abc_-');
    expect(hashPayload(new URL(url).hash)).toBe('1.abc_-');
    expect(hashPayload('')).toBeNull();
    expect(hashPayload('#x=1')).toBeNull();
  });

  it('only allows in-app back links', () => {
    expect(safeBack('/games/never-have-i-ever', '/')).toBe('/games/never-have-i-ever');
    expect(safeBack('//evil.com', '/')).toBe('/');
    expect(safeBack('https://evil.com', '/')).toBe('/');
    expect(safeBack(null, '/packs')).toBe('/packs');
  });
});

describe('uniquePresetName', () => {
  it('never overwrites an existing preset', () => {
    expect(uniquePresetName(' House ', [])).toBe('House');
    expect(uniquePresetName('House', ['House'])).toBe('House (2)');
    expect(uniquePresetName('House', ['House', 'House (2)'])).toBe('House (3)');
    const long = 'x'.repeat(40);
    const out = uniquePresetName(long, ['x'.repeat(30)]);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith(' (2)')).toBe(true);
  });
});
