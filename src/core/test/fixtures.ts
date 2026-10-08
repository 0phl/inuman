import type { Player } from '../content/schemas';
import { DEFAULT_INTENSITY, type Intensity } from '../content/schemas';

export const players = (...names: string[]): Player[] =>
  names.map((name, i) => ({ id: `p${i + 1}`, name, nonAlcoholic: false, sittingOut: false }));

export const intensity = (patch: Partial<Intensity> = {}): Intensity => ({ ...DEFAULT_INTENSITY, ...patch });
