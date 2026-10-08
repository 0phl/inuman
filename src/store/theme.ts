import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ThemeSchema, type Theme } from '@/core/content/schemas';

export const DEFAULT_THEME: Theme = ThemeSchema.parse({});

export const CARD_BACKS = ['classic-red', 'classic-blue', 'banig', 'jeepney'] as const;
export type CardBackId = (typeof CARD_BACKS)[number];

interface ThemeState {
  theme: Theme;
  setTheme(patch: Partial<Theme>): void;
}

const sanitize = (raw: unknown): Theme => {
  const parsed = ThemeSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_THEME;
};

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (patch) => set((s) => ({ theme: sanitize({ ...s.theme, ...patch }) })),
    }),
    {
      name: 'inuman.theme',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme }),
      migrate: (persisted) => ({ theme: sanitize((persisted as { theme?: unknown } | null)?.theme) }),
      merge: (persisted, current) => ({
        ...current,
        theme: sanitize((persisted as { theme?: unknown } | null)?.theme),
      }),
    },
  ),
);
