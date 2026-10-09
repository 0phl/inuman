import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MUSIC } from '@/audio/catalog';
import { useAudioManifest } from '@/audio/react';
import { DIVE_BAR_CREDITS } from '@/stage/environments/credits';
import { QUALITY_OPTIONS, useSettings } from '@/store/settings';
import { SoundSettings } from '@/ui/AudioControls';
import { FieldRow, InlineRow, Segmented, Stepper, Toggle } from '@/ui/controls';
import { IconChevron } from '@/ui/icons';
import { ThemePicker } from '@/ui/ThemePicker';
import { TopBar } from '@/ui/TopBar';
import { InstallSettingsRow } from '@/ui/InstallPrompt';
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

const LICENSE_URLS: Record<string, string> = {
  'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0 1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};

/** " · CC-BY 4.0", linked to the licence deed when it's one we know (CC-BY asks for the link). */
function LicenseTag({ license }: { license: string }) {
  if (!license) return null;
  const url = LICENSE_URLS[license];
  return (
    <>
      {' · '}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline">
          {license}
        </a>
      ) : (
        license
      )}
    </>
  );
}

/** Attribution for the sounds and music, from the audio manifest (nothing while it's missing). */
function AudioCredits() {
  const { t } = useTranslation();
  const manifest = useAudioManifest();
  if (!manifest) return null;
  const tracks = MUSIC.flatMap((m) => {
    const e = manifest.music[m.id];
    return e ? [{ id: m.id, ...e }] : [];
  });
  if (!tracks.length && !manifest.credits.length) return null;
  return (
    <div data-testid="audio-credits">
      <p className="mt-3 text-capiz-300">{t('settings.audioCredits')}</p>
      <ul className="mt-2 flex flex-col gap-1 text-capiz-300">
        {tracks.map((m) => (
          <li key={m.id}>
            {m.url ? (
              <a href={m.url} target="_blank" rel="noreferrer" className="text-brass-300 underline">
                {t('settings.musicBy', { title: m.title, artist: m.artist || '?' })}
              </a>
            ) : (
              t('settings.musicBy', { title: m.title, artist: m.artist || '?' })
            )}
            <LicenseTag license={m.license} />
          </li>
        ))}
        {manifest.credits.map((c, i) => (
          <li key={`${c.url}:${i}`}>
            {c.url ? (
              <a href={c.url} target="_blank" rel="noreferrer" className="text-brass-300 underline">
                {c.what || c.author}
              </a>
            ) : (
              c.what || c.author
            )}
            {c.author && c.what && ` · ${c.author}`}
            <LicenseTag license={c.license} />
          </li>
        ))}
      </ul>
    </div>
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

      <Section title={t('install.settingsTitle')}>
        <InstallSettingsRow />
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
        <SoundSettings />
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
        <AudioCredits />
      </details>

      <section className="mb-4" aria-labelledby="settings-advanced">
        <h2 id="settings-advanced" className="eyebrow mb-2 text-capiz-300">
          {t('settings.advanced')}
        </h2>
        <Link
          to="/bench"
          className="panel flex min-h-14 items-center gap-3 px-4 py-3"
          data-testid="bench-link"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-bold text-capiz-50">{t('settings.bench')}</span>
            <span className="text-sm text-capiz-400">{t('settings.benchHelp')}</span>
          </span>
          <IconChevron className="text-capiz-300" />
        </Link>
      </section>
    </main>
  );
}
