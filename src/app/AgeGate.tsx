import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/store/settings';
import { IconNoDrive } from '@/ui/icons';
import { LanguageSwitch } from './LanguageSwitch';

/** Self-attested 18+ gate (the legal drinking age in the Philippines). Remembered in settings. */
export function AgeGate() {
  const { t } = useTranslation();
  const confirmAge = useSettings((s) => s.confirmAge);
  const [refused, setRefused] = useState(false);

  return (
    <main className="screen justify-between gap-8" data-testid="age-gate">
      <div className="ml-auto w-48">
        <LanguageSwitch />
      </div>

      <section className="flex flex-col gap-5">
        <p className="sign-pintor text-[clamp(3.4rem,18.5vw,5.6rem)]">{t('app.name')}</p>
        {refused ? (
          <div className="anim-rise flex flex-col gap-3">
            <h1 className="text-3xl font-extrabold text-capiz-50">{t('age.refusedTitle')}</h1>
            <p className="text-lg text-capiz-300">{t('age.refusedBody')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-extrabold text-capiz-50">{t('age.title')}</h1>
            <p className="text-lg text-capiz-300">{t('age.body')}</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="panel flex gap-3 p-4">
          <IconNoDrive className="mt-0.5 shrink-0 text-sili-500" />
          <p className="text-capiz-200">
            <strong className="text-capiz-50">{t('age.noDrive')}</strong> {t('age.responsible')}
          </p>
        </div>
        {!refused && (
          <div className="grid gap-3">
            <button type="button" className="btn btn-brass min-h-14 text-lg" onClick={confirmAge} data-testid="age-yes">
              {t('age.yes')}
            </button>
            <button type="button" className="btn btn-wood" onClick={() => setRefused(true)} data-testid="age-no">
              {t('age.no')}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
