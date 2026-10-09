import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO,
  DEFAULT_SETTINGS,
  migrateSettings,
  sanitizeAudio,
  sanitizeSettings,
  SETTINGS_VERSION,
} from './settings';

describe('settings migration', () => {
  it('is at version 3', () => {
    expect(SETTINGS_VERSION).toBe(3);
  });

  it('starts new players on High graphics', () => {
    expect(DEFAULT_SETTINGS.quality).toBe('high');
    expect(sanitizeSettings({}).quality).toBe('high');
    expect(sanitizeSettings({ quality: 'ultra' }).quality).toBe('high');
  });

  it('moves the old Auto default to High, but keeps a quality picked by hand', () => {
    expect(migrateSettings({ quality: 'auto' }, 2).quality).toBe('high');
    expect(migrateSettings({ quality: 'auto' }, 1).quality).toBe('high');
    expect(migrateSettings({ quality: 'mid' }, 2).quality).toBe('mid');
    expect(migrateSettings({ quality: 'low' }, 2).quality).toBe('low');
    // Auto chosen on purpose after v3 stays Auto.
    expect(migrateSettings({ quality: 'auto' }, 3).quality).toBe('auto');
  });

  it('upgrades v1 settings: keeps what was stored, adds the audio defaults', () => {
    const v1 = {
      locale: 'en',
      ageConfirmed: true,
      quality: 'low',
      detectedTier: 'mid',
      sound: false,
      haptics: false,
    };
    const s = migrateSettings(v1, 1);
    expect(s.locale).toBe('en');
    expect(s.ageConfirmed).toBe(true);
    expect(s.quality).toBe('low');
    expect(s.detectedTier).toBe('mid');
    // v1's sound switch stays the master switch.
    expect(s.sound).toBe(false);
    expect(s.haptics).toBe(false);
    expect(s.masterVolume).toBe(DEFAULT_AUDIO.masterVolume);
    expect(s.music).toBe(true);
    expect(s.musicTrack).toBe('opm-acoustic');
    expect(s.musicVolume).toBeLessThan(0.5);
    expect(s.ambience).toBe(false);
    expect(s.mixWithOthers).toBe(true);
  });

  it('keeps valid v2 audio settings and repairs broken ones', () => {
    const s = migrateSettings(
      {
        masterVolume: 0.4,
        sfxVolume: 7,
        music: false,
        musicTrack: 'shuffle',
        musicVolume: 'loud',
        ambience: true,
        ambienceVolume: -1,
        mixWithOthers: false,
      },
      2,
    );
    expect(s.masterVolume).toBe(0.4);
    expect(s.sfxVolume).toBe(1);
    expect(s.music).toBe(false);
    expect(s.musicTrack).toBe('shuffle');
    expect(s.musicVolume).toBe(DEFAULT_AUDIO.musicVolume);
    expect(s.ambience).toBe(true);
    expect(s.ambienceVolume).toBe(0);
    expect(s.mixWithOthers).toBe(false);
  });

  it('falls back to the default track for an unknown one', () => {
    expect(sanitizeAudio({ musicTrack: 'never-gonna' }).musicTrack).toBe('opm-acoustic');
    expect(sanitizeAudio({ musicTrack: 'lofi-lounge' }).musicTrack).toBe('lofi-lounge');
  });

  it('survives garbage', () => {
    expect(migrateSettings(null, 0)).toMatchObject(DEFAULT_AUDIO);
    expect(migrateSettings('nope', 1)).toMatchObject(DEFAULT_AUDIO);
  });
});
