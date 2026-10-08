import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export const I18N_PREFIX = 'i18n:';

/** True when a data string is a translation key rather than user-written text. */
export const isKey = (s: string): boolean => s.startsWith(I18N_PREFIX);

/**
 * Resolves data strings: `i18n:some.key` goes through t(), anything else is literal user text.
 * Never render the result as HTML.
 */
export function useTx() {
  const { t } = useTranslation();
  return useCallback(
    (s: string | undefined | null, params?: Record<string, string | number>): string => {
      if (!s) return '';
      return isKey(s) ? t(s.slice(I18N_PREFIX.length), params ?? {}) : s;
    },
    [t],
  );
}
