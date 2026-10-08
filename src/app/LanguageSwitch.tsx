import { useTranslation } from 'react-i18next';
import { LOCALES } from '@/core/content/schemas';
import { useSettings } from '@/store/settings';
import { Segmented } from '@/ui/controls';

export function LanguageSwitch({ testId }: { testId?: string }) {
  const { t } = useTranslation();
  const locale = useSettings((s) => s.locale);
  const setLocale = useSettings((s) => s.setLocale);
  return (
    <Segmented
      label={t('settings.language')}
      value={locale}
      onChange={setLocale}
      options={LOCALES.map((l) => ({ value: l, label: t(`locale.${l}`) }))}
      testId={testId}
    />
  );
}
