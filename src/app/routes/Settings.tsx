import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DIVE_BAR_CREDITS } from '@/stage/environments/credits';
import { QUALITY_OPTIONS, useSettings } from '@/store/settings';
import { FieldRow, InlineRow, Segmented, Stepper, Toggle } from '@/ui/controls';
import { ThemePicker } from '@/ui/ThemePicker';
import { TopBar } from '@/ui/TopBar';
import { LanguageSwitch } from '../LanguageSwitch';

const MULTIPLIERS = [0.5, 1, 1.5, 2] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="eyebrow mb-2 text-capiz-300">{title}</h2>
      <div className="panel divide-y divide-white/8 px-4 py-1">{children}</div>
    </section>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const s = useSettings();
  const i = s.intensity;
  const soft = i.mode === 'non-alcoholic';

  return (
    <main className="screen" data-testid="settings">
      <TopBar title={t('settings.title')} back="/" />

      <Section title={t('settings.language')}>
        <div className="py-3">
          <LanguageSwitch testId="settings-language" />
        </div>
      </Section>

      <Section title={t('settings.drinking')}>
        <FieldRow label={t('intensity.mode')}>
          <Segmented
            label={t('intensity.mode')}
            value={i.mode}
            onChange={(mode) => s.setIntensity({ mode })}
            options={[
              { value: 'alcohol', label: t('intensity.modeAlcohol') },
              { value: 'non-alcoholic', label: t('intensity.modeSoft') },
            ]}
          />
        </FieldRow>
        <FieldRow label={t('intensity.multiplier')} help={t('intensity.multiplierHelp')}>
          <Segmented
            label={t('intensity.multiplier')}
            value={i.multiplier}
            onChange={(multiplier) => s.setIntensity({ multiplier })}
            options={MULTIPLIERS.map((m) => ({
              value: m,
              label: t(`intensity.mult.${String(m).replace('.', '_')}`),
            }))}
          />
        </FieldRow>
        <FieldRow label={t('intensity.unit')} help={t('intensity.unitHelp')}>
          <Segmented
            label={t('intensity.unit')}
            value={i.unit}
            onChange={(unit) => s.setIntensity({ unit })}
            options={[
              { value: 'sip', label: t('intensity.unitSip') },
              { value: 'tagay', label: t('intensity.unitTagay') },
            ]}
          />
        </FieldRow>
        <InlineRow label={t('intensity.maxSips')} help={t('intensity.maxSipsHelp')}>
          <Stepper
            label={t('intensity.maxSips')}
            value={i.maxSipsPerTurn}
            min={1}
            max={10}
            onChange={(maxSipsPerTurn) => s.setIntensity({ maxSipsPerTurn })}
          />
        </InlineRow>
        <div className="py-2">
          <Toggle
            checked={i.allowFinish}
            onChange={(allowFinish) => s.setIntensity({ allowFinish })}
            label={t('intensity.allowFinish')}
            description={soft ? t('intensity.allowFinishSoft') : t('intensity.allowFinishHelp')}
          />
        </div>
        <InlineRow
          label={t('intensity.water')}
          help={i.waterReminderMin === 0 ? t('intensity.waterOff') : t('intensity.waterHelp')}
        >
          <Stepper
            label={t('intensity.water')}
            value={i.waterReminderMin}
            min={0}
            max={120}
            step={5}
            format={(v) => (v === 0 ? t('intensity.off') : t('intensity.minutes', { count: v }))}
            onChange={(waterReminderMin) => s.setIntensity({ waterReminderMin })}
          />
        </InlineRow>
      </Section>

      <section className="mb-5" aria-labelledby="settings-theme" data-testid="settings-theme">
        <h2 id="settings-theme" className="eyebrow mb-2 text-capiz-300">
          {t('theme.title')}
        </h2>
        <div className="panel p-4">
          <ThemePicker />
        </div>
      </section>

      <Section title={t('settings.quality')}>
        <FieldRow label={t('settings.qualityRow')} help={t('settings.qualityHelp')}>
          <Segmented
            label={t('settings.quality')}
            value={s.quality}
            onChange={s.setQuality}
            options={QUALITY_OPTIONS.map((q) => ({ value: q, label: t(`quality.${q}`) }))}
          />
        </FieldRow>
      </Section>

      <Section title={t('settings.feedback')}>
        <div className="py-1">
          <Toggle checked={s.sound} onChange={s.setSound} label={t('settings.sound')} />
        </div>
        <div className="py-1">
          <Toggle checked={s.haptics} onChange={s.setHaptics} label={t('settings.haptics')} />
        </div>
      </Section>

      <section className="panel mb-4 flex flex-col gap-2 p-4">
        <h2 className="font-bold text-capiz-50">{t('settings.responsibleTitle')}</h2>
        <p className="text-capiz-300">{t('settings.responsibleBody')}</p>
        <p className="font-bold text-brass-300">{t('age.noDrive')}</p>
      </section>

      <details className="panel mb-4 px-4 py-3 text-sm" data-testid="credits">
        <summary className="cursor-pointer font-bold text-capiz-50">
          {t('settings.credits')}
        </summary>
        <p className="mt-2 text-capiz-300">{t('settings.creditsBody')}</p>
        <ul className="mt-2 flex flex-col gap-1 text-capiz-300">
          {DIVE_BAR_CREDITS.map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noreferrer" className="text-brass-300 underline">
                {c.name}
              </a>{' '}
              · {c.authors}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
