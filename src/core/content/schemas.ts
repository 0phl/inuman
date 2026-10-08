import { z } from 'zod';

export const LOCALES = ['taglish', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const PlayerSchema = z.object({
  id: z.string().min(1).max(24),
  name: z.string().trim().min(1).max(20),
  nonAlcoholic: z.boolean().default(false),
  sittingOut: z.boolean().default(false),
});
export type Player = z.output<typeof PlayerSchema>;

export const IntensitySchema = z.object({
  mode: z.enum(['alcohol', 'non-alcoholic']).default('alcohol'),
  multiplier: z.union([z.literal(0.5), z.literal(1), z.literal(1.5), z.literal(2)]).default(1),
  unit: z.enum(['sip', 'tagay']).default('sip'),
  maxSipsPerTurn: z.number().int().min(1).max(10).default(4),
  allowFinish: z.boolean().default(false),
  waterReminderMin: z.number().int().min(0).max(120).default(30),
});
export type Intensity = z.output<typeof IntensitySchema>;
export const DEFAULT_INTENSITY: Intensity = IntensitySchema.parse({});

export const SPICE_LEVELS = [0, 1, 2, 3] as const;
export type Spice = (typeof SPICE_LEVELS)[number];

export const PromptItemSchema = z.object({
  id: z.string().min(1).max(12),
  text: z.string().trim().min(1).max(280),
  alt: z.partialRecord(z.enum(LOCALES), z.string().max(280)).optional(),
  kind: z.enum(['truth', 'dare', 'prompt']).optional(),
  spice: z.number().int().min(0).max(3).default(1),
  sips: z.number().int().min(0).max(5).optional(),
  tags: z.array(z.string().max(20)).max(5).optional(),
});
export type PromptItem = z.output<typeof PromptItemSchema>;

export const PACK_GAMES = ['never-have-i-ever', 'truth-or-dare', 'most-likely-to'] as const;
export type PackGame = (typeof PACK_GAMES)[number];

export const PromptPackSchema = z.object({
  schema: z.literal(1),
  kind: z.literal('pack'),
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(60),
  game: z.enum(PACK_GAMES),
  locale: z.enum([...LOCALES, 'any']),
  builtin: z.boolean().optional(),
  items: z.array(PromptItemSchema).min(1).max(1000),
});
export type PromptPack = z.output<typeof PromptPackSchema>;

export const ThemeSchema = z.object({
  environmentId: z.string().max(32).default('dive-bar'),
  cardBack: z.string().max(32).default('classic-red'),
  diceMaterialId: z.string().max(32).default('ivory'),
  cupColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#c8102e'),
  feltColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#1d4d33'),
});
export type Theme = z.output<typeof ThemeSchema>;
