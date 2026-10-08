import { describe, expect, it } from 'vitest';
import { checkPayload } from '@/ui/importCheck';
import { DEFAULT_THEME, normalizeTheme, sameTheme } from './theme';

describe('theme', () => {
  it('maps unknown ids to the defaults and lower-cases colours', () => {
    const t = normalizeTheme({
      environmentId: 'moon-base',
      cardBack: 'holo',
      diceMaterialId: 'glass',
      cupColor: '#1E6B3F',
      feltColor: '#3D2A5C',
    });
    expect(t).toEqual({
      environmentId: 'dive-bar',
      cardBack: 'classic-red',
      diceMaterialId: 'ivory',
      cupColor: '#1e6b3f',
      feltColor: '#3d2a5c',
    });
  });

  it('keeps known ids', () => {
    const t = { ...DEFAULT_THEME, environmentId: 'procedural-bar', cardBack: 'jeepney' };
    expect(normalizeTheme(t)).toEqual(t);
  });

  it('compares colours case-insensitively', () => {
    expect(sameTheme(DEFAULT_THEME, { ...DEFAULT_THEME, cupColor: '#C8102E' })).toBe(true);
    expect(sameTheme(DEFAULT_THEME, { ...DEFAULT_THEME, cardBack: 'banig' })).toBe(false);
  });

  it('import accepts shared looks, normalized', () => {
    const res = checkPayload({
      schema: 1,
      kind: 'theme',
      name: 'Jeepney sa Quiapo',
      theme: { ...DEFAULT_THEME, cardBack: 'jeepney', diceMaterialId: 'future-dice' },
    });
    expect(res).toEqual({
      kind: 'theme',
      name: 'Jeepney sa Quiapo',
      theme: { ...DEFAULT_THEME, cardBack: 'jeepney', diceMaterialId: 'ivory' },
    });
  });
});
