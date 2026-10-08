import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_INTENSITY, IntensitySchema, LOCALES, type Intensity, type Locale } from '@/core/content/schemas';

export const QUALITY_OPTIONS = ['auto', 'low', 'mid', 'high'] as const;
export type Quality = (typeof QUALITY_OPTIONS)[number];
export type Tier = Exclude<Quality, 'auto'>;

export interface SettingsData {
  locale: Locale;
  ageConfirmed: boolean;
  quality: Quality;
  /** Result of GPU detection / runtime step-downs, remembered so we only probe once. */
  detectedTier: Tier | null;
  intensity: Intensity;
  sound: boolean;
  haptics: boolean;
}

interface SettingsActions {
  setLocale(locale: Locale): void;
  confirmAge(): void;
  setQuality(quality: Quality): void;
  setDetectedTier(tier: Tier): void;
  setIntensity(patch: Partial<Intensity>): void;
  setSound(on: boolean): void;
  setHaptics(on: boolean): void;
}

export type SettingsState = SettingsData & SettingsActions;

export const DEFAULT_SETTINGS: SettingsData = {
  locale: 'taglish',
  ageConfirmed: false,
  quality: 'auto',
  detectedTier: null,
  intensity: DEFAULT_INTENSITY,
  sound: true,
  haptics: true,
};

const SETTINGS_VERSION = 1;

/** Accepts anything from storage and returns a valid settings object. */
export function sanitizeSettings(raw: unknown): SettingsData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SettingsData, unknown>>;
  const intensity = IntensitySchema.safeParse(r.intensity ?? {});
  const tier = (v: unknown): v is Tier => v === 'low' || v === 'mid' || v === 'high';
  return {
    locale: LOCALES.includes(r.locale as Locale) ? (r.locale as Locale) : DEFAULT_SETTINGS.locale,
    ageConfirmed: r.ageConfirmed === true,
    quality: QUALITY_OPTIONS.includes(r.quality as Quality) ? (r.quality as Quality) : 'auto',
    detectedTier: tier(r.detectedTier) ? r.detectedTier : null,
    intensity: intensity.success ? intensity.data : DEFAULT_INTENSITY,
    sound: typeof r.sound === 'boolean' ? r.sound : DEFAULT_SETTINGS.sound,
    haptics: typeof r.haptics === 'boolean' ? r.haptics : DEFAULT_SETTINGS.haptics,
  };
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
        sound: s.sound,
        haptics: s.haptics,
      }),
      // v0 never shipped; any older/unknown shape is sanitized field by field.
      migrate: (persisted) => sanitizeSettings(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);
