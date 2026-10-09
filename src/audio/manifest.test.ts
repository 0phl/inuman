import { describe, expect, it } from 'vitest';
import { parseManifest } from './manifest';

describe('parseManifest', () => {
  it('keeps valid entries and drops unsafe or empty ones', () => {
    const m = parseManifest({
      version: 1,
      sfx: {
        'ui.tap': {
          files: ['../etc/passwd', 'sfx/ui.tap_1.mp3', 'https://x.y/a.mp3'],
          durationsSec: [9, 0.08, 1],
          gainDb: -3,
        },
        'card.flip': { files: [] },
        'bottle.spin': { files: ['sfx/bottle.spin_1.mp3'], loop: true, gainDb: 99 },
      },
      music: {
        'opm-acoustic': {
          file: 'music/opm-acoustic.mp3',
          title: 'Gabi',
          artist: 'Someone',
          license: 'CC BY 4.0',
          url: 'https://example.com',
          loopStart: 4.2,
          loopEnd: 120.5,
          durationSec: 125,
        },
        bad: { file: '/abs.mp3' },
        'no-loop': { file: 'music/x.mp3', loopStart: 10, loopEnd: 5 },
      },
      credits: [{ what: 'Clinks', author: 'A', license: 'CC0', url: 'u' }, { nope: 1 }],
    });
    expect(m).not.toBeNull();
    expect(m!.sfx['ui.tap']).toEqual({
      files: ['sfx/ui.tap_1.mp3'],
      gainDb: -3,
      loop: false,
      durationsSec: [0.08],
    });
    expect(m!.sfx['bottle.spin']!.durationsSec).toEqual([null]);
    expect(m!.sfx['card.flip']).toBeUndefined();
    expect(m!.sfx['bottle.spin']!.gainDb).toBe(12);
    expect(m!.sfx['bottle.spin']!.loop).toBe(true);
    expect(m!.music['opm-acoustic']!.loopEnd).toBe(120.5);
    expect(m!.music.bad).toBeUndefined();
    expect(m!.music['no-loop']!.loopStart).toBeNull();
    expect(m!.music['no-loop']!.title).toBe('no-loop');
    expect(m!.credits).toHaveLength(1);
  });

  it('rejects anything that is not a v1 manifest', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('x')).toBeNull();
    expect(parseManifest({ version: 2 })).toBeNull();
    expect(parseManifest({ version: 1 })).toEqual({ version: 1, sfx: {}, music: {}, credits: [] });
  });
});
