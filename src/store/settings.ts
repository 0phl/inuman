import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { MUSIC } from '@/audio/catalog';
import {
  DEFAULT_INTENSITY,
  IntensitySchema,
  LOCALES,
  type Intensity,
  type Locale,
} from '@/core/content/schemas';

export const QUALITY_OPTIONS = ['auto', 'low', 'mid', 'high'] as const;
export type Quality = (typeof QUALITY_OPTIONS)[number];
export type Tier = Exclude<Quality, 'auto'>;

/** A music track id from the catalog, or 'shuffle' ("Halo-halo": every track, in random order). */
export type MusicChoice = string;
export const SHUFFLE = 'shuffle';
export const MUSIC_CHOICES: readonly MusicChoice[] = [...MUSIC.map((m) => m.id), SHUFFLE];

/** The sound and haptics settings (all volumes are 0..1 sliders). */
export interface AudioSettings {
  /** Master switch: off silences effects, music and ambience alike. */
  sound: boolean;
  masterVolume: number;
  /** UI clicks and game effects. */
  sfxVolume: number;
  music: boolean;
  musicTrack: MusicChoice;
  musicVolume: number;
  /** The bar room-tone loop. */
  ambience: boolean;
  ambienceVolume: number;
  /** iOS: let the barkada's own music (Spotify…) keep playing alongside the app. */
  mixWithOthers: boolean;
  haptics: boolean;
}

export interface SettingsData extends AudioSettings {
  locale: Locale;
  ageConfirmed: boolean;
  quality: Quality;
  /** Result of GPU detection / runtime step-downs, remembered so we only probe once. */
  detectedTier: Tier | null;
  intensity: Intensity;
}

interface SettingsActions {
  setLocale(locale: Locale): void;
  confirmAge(): void;
  setQuality(quality: Quality): void;
  setDetectedTier(tier: Tier): void;
  setIntensity(patch: Partial<Intensity>): void;
  setSound(on: boolean): void;
  setHaptics(on: boolean): void;
  /** Any of the sound settings at once (values are clamped / validated). */
  setAudio(patch: Partial<AudioSettings>): void;
}

export type SettingsState = SettingsData & SettingsActions;

export const DEFAULT_AUDIO: AudioSettings = {
  sound: true,
  masterVolume: 0.9,
  sfxVolume: 0.85,
  music: true,
  musicTrack: 'opm-acoustic',
  musicVolume: 0.3,
  ambience: false,
  ambienceVolume: 0.5,
  mixWithOthers: true,
  haptics: true,
};

export const DEFAULT_SETTINGS: SettingsData = {
  locale: 'taglish',
  ageConfirmed: false,
  quality: 'auto',
  detectedTier: null,
  intensity: DEFAULT_INTENSITY,
  ...DEFAULT_AUDIO,
};

/**
 * v1: language, intensity, quality and two booleans (sound, haptics).
 * v2: the audio engine — volumes, music track, ambience, mix-with-other-apps.
 */
export const SETTINGS_VERSION = 2;

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const volume = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const track = (v: unknown): MusicChoice =>
  typeof v === 'string' && MUSIC_CHOICES.includes(v) ? v : DEFAULT_AUDIO.musicTrack;

/** Validates the sound settings field by field; anything unknown falls back to its default. */
export function sanitizeAudio(raw: Partial<Record<keyof AudioSettings, unknown>>): AudioSettings {
  const d = DEFAULT_AUDIO;
  return {
    sound: bool(raw.sound, d.sound),
    masterVolume: volume(raw.masterVolume, d.masterVolume),
    sfxVolume: volume(raw.sfxVolume, d.sfxVolume),
    music: bool(raw.music, d.music),
    musicTrack: track(raw.musicTrack),
    musicVolume: volume(raw.musicVolume, d.musicVolume),
    ambience: bool(raw.ambience, d.ambience),
    ambienceVolume: volume(raw.ambienceVolume, d.ambienceVolume),
    mixWithOthers: bool(raw.mixWithOthers, d.mixWithOthers),
    haptics: bool(raw.haptics, d.haptics),
  };
}

/** Accepts anything from storage and returns a valid settings object. */
export function sanitizeSettings(raw: unknown): SettingsData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof SettingsData, unknown>
  >;
  const intensity = IntensitySchema.safeParse(r.intensity ?? {});
  const tier = (v: unknown): v is Tier => v === 'low' || v === 'mid' || v === 'high';
  return {
    locale: LOCALES.includes(r.locale as Locale) ? (r.locale as Locale) : DEFAULT_SETTINGS.locale,
    ageConfirmed: r.ageConfirmed === true,
    quality: QUALITY_OPTIONS.includes(r.quality as Quality) ? (r.quality as Quality) : 'auto',
    detectedTier: tier(r.detectedTier) ? r.detectedTier : null,
    intensity: intensity.success ? intensity.data : DEFAULT_INTENSITY,
    ...sanitizeAudio(r),
  };
}

/**
 * Brings stored settings of any earlier version up to SETTINGS_VERSION. v0 never shipped and
 * v1 → v2 only added fields, so both are sanitized field by field: what v1 stored (including
 * its sound/haptics switches) is kept and the new audio fields get their defaults.
 */
export function migrateSettings(persisted: unknown, _fromVersion: number): SettingsData {
  // Nothing was renamed between versions, so sanitizing is the whole migration: v1's "Tunog"
  // switch stays the master switch and the new audio fields fill in from their defaults.
  return sanitizeSettings(persisted);
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setLocale: (locale) => set({ locale }),
      confirmAge: () => set({ ageConfirmed: true }),
      setQuality: (quality) => set({ quality }),
      setDetectedTier: (detectedTier) => set({ detectedTier }),
      setIntensity: (patch) =>
        set((s) => {
          const next = IntensitySchema.safeParse({ ...s.intensity, ...patch });
          return next.success ? { intensity: next.data } : {};
        }),
      setSound: (sound) => set({ sound }),
      setHaptics: (haptics) => set({ haptics }),
      setAudio: (patch) => set((s) => sanitizeAudio({ ...pickAudio(s), ...patch })),
    }),
    {
      name: 'inuman.settings',
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): SettingsData => ({
        locale: s.locale,
        ageConfirmed: s.ageConfirmed,
        quality: s.quality,
        detectedTier: s.detectedTier,
        intensity: s.intensity,
        ...pickAudio(s),
      }),
      migrate: (persisted, version) => migrateSettings(persisted, version),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);

/** Just the sound settings out of the whole state. */
export function pickAudio(s: AudioSettings): AudioSettings {
  return {
    sound: s.sound,
    masterVolume: s.masterVolume,
    sfxVolume: s.sfxVolume,
    music: s.music,
    musicTrack: s.musicTrack,
    musicVolume: s.musicVolume,
    ambience: s.ambience,
    ambienceVolume: s.ambienceVolume,
    mixWithOthers: s.mixWithOthers,
    haptics: s.haptics,
  };
}
