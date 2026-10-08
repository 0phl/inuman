import type { TFunction } from 'i18next';
import { CUP_SWATCHES, FELT_SWATCHES, type Swatch } from '@/store/theme';

export const findSwatch = (list: readonly Swatch[], hex: string): Swatch | undefined =>
  list.find((s) => s.hex.toLowerCase() === hex.toLowerCase());

/** A colour's name if it's one of the presets, else its hex code. */
export function swatchName(t: TFunction, kind: 'cup' | 'felt', hex: string): string {
  const s = findSwatch(kind === 'cup' ? CUP_SWATCHES : FELT_SWATCHES, hex);
  return s ? t(`theme.${kind}Name.${s.id}`) : hex.toUpperCase();
}
