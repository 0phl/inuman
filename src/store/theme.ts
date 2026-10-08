import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ThemeSchema, type Theme } from '@/core/content/schemas';

export const DEFAULT_THEME: Theme = ThemeSchema.parse({});

export const CARD_BACKS = ['classic-red', 'classic-blue', 'banig', 'jeepney'] as const;
export type CardBackId = (typeof CARD_BACKS)[number];

/** Rooms (theme.environmentId); see StageEnvironment. */
export const ENVIRONMENTS = ['dive-bar', 'procedural-bar'] as const;
export type EnvironmentId = (typeof ENVIRONMENTS)[number];

/** Dice finishes (theme.diceMaterialId); kept in step with DIE_MATERIAL_IDS in three/diceTextures. */
export const DICE_MATERIALS = ['ivory', 'red-casino', 'wood'] as const;
export type DiceMaterialId = (typeof DICE_MATERIALS)[number];

export interface Swatch {
  /** i18n suffix: theme.cup.<id> / theme.felt.<id>. */
  id: string;
  hex: string;
}

/** Party-cup colours. "bottle" is a beer-bottle green. */
export const CUP_SWATCHES: readonly Swatch[] = [
  { id: 'red', hex: '#c8102e' },
  { id: 'blue', hex: '#1f4fb0' },
  { id: 'bottle', hex: '#1e6b3f' },
  { id: 'yellow', hex: '#e6a817' },
  { id: 'pink', hex: '#e2457c' },
  { id: 'black', hex: '#26221f' },
];

/** Felt mat colours. */
export const FELT_SWATCHES: readonly Swatch[] = [
  { id: 'green', hex: '#1d4d33' },
  { id: 'blue', hex: '#123a5c' },
  { id: 'maroon', hex: '#5a1a24' },
  { id: 'charcoal', hex: '#2b2b2b' },
  { id: 'ube', hex: '#3d2a5c' },
];

const known = <T extends string>(list: readonly T[], value: string, fallback: T): T =>
  (list as readonly string[]).includes(value) ? (value as T) : fallback;

/**
 * Maps ids this version doesn't know (e.g. from a newer app's share link) to the defaults, and
 * lower-cases colours, so pickers always have something selected.
 */
export function normalizeTheme(theme: Theme): Theme {
  return {
    environmentId: known(ENVIRONMENTS, theme.environmentId, 'dive-bar'),
    cardBack: known(CARD_BACKS, theme.cardBack, 'classic-red'),
    diceMaterialId: known(DICE_MATERIALS, theme.diceMaterialId, 'ivory'),
    cupColor: theme.cupColor.toLowerCase(),
    feltColor: theme.feltColor.toLowerCase(),
  };
}

export const sameTheme = (a: Theme, b: Theme): boolean =>
  a.environmentId === b.environmentId &&
  a.cardBack === b.cardBack &&
  a.diceMaterialId === b.diceMaterialId &&
  a.cupColor.toLowerCase() === b.cupColor.toLowerCase() &&
  a.feltColor.toLowerCase() === b.feltColor.toLowerCase();

interface ThemeState {
  theme: Theme;
  setTheme(patch: Partial<Theme>): void;
  resetTheme(): void;
}

const sanitize = (raw: unknown): Theme => {
  const parsed = ThemeSchema.safeParse(raw ?? {});
  return parsed.success ? normalizeTheme(parsed.data) : DEFAULT_THEME;
};

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (patch) => set((s) => ({ theme: sanitize({ ...s.theme, ...patch }) })),
      resetTheme: () => set({ theme: DEFAULT_THEME }),
    }),
    {
      name: 'inuman.theme',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme }),
      migrate: (persisted) => ({
        theme: sanitize((persisted as { theme?: unknown } | null)?.theme),
      }),
      merge: (persisted, current) => ({
        ...current,
        theme: sanitize((persisted as { theme?: unknown } | null)?.theme),
      }),
    },
  ),
);
