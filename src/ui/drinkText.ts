import type { TFunction } from 'i18next';
import type { DrinkEntry } from '@/core/engine/drink';

/** "2 lagok" / "1 tagay" / "Ubusin!" — the amount part of a drink line. */
export function drinkAmount(
  t: TFunction,
  e: Pick<DrinkEntry, 'amount' | 'unit' | 'finish' | 'alcoholic'>,
): string {
  if (e.finish) return t('drink.finish');
  if (!e.alcoholic) return t('drink.sipsSoft', { count: e.amount });
  return e.unit === 'tagay'
    ? t('drink.tagay', { count: e.amount })
    : t('drink.sips', { count: e.amount });
}
