import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { selectBannerVisible, useInstall, type InstallPlatform } from '@/store/install';
import { IconCheck, IconClose, IconDownload } from './icons';
import { Sheet } from './Sheet';

// "Install the app": a floating banner on Home (closable) and a row in Settings (always there).
// Both open the browser's own install dialog when it offers one, else a sheet with the steps for
// this phone (iOS has no install API: Share → Add to Home Screen).

const STEPS: Record<InstallPlatform, readonly string[]> = {
  ios: ['install.ios1', 'install.ios2', 'install.ios3'],
  android: ['install.android1', 'install.android2'],
  desktop: ['install.desktop1'],
};

function InstallSteps({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const platform = useInstall((s) => s.platform);
  const insecure = typeof window !== 'undefined' && !window.isSecureContext;
  return (
    <Sheet open={open} onClose={onClose} title={t('install.stepsTitle')} testId="install-steps">
      <ol className="flex flex-col gap-3 pb-2">
        {STEPS[platform].map((key, i) => (
          <li key={key} className="flex items-start gap-3 text-capiz-100">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brass-400 font-sign text-sm text-narra-950">
              {i + 1}
            </span>
            <span className="pt-0.5 leading-snug">{t(key)}</span>
          </li>
        ))}
      </ol>
      {insecure && <p className="mt-2 text-sm text-capiz-400">{t('install.needsHttps')}</p>}
    </Sheet>
  );
}

/** Starts an install: the browser's dialog if there is one, else the steps sheet. */
function useInstallFlow(): { start(): void; sheet: ReactNode } {
  const promptInstall = useInstall((s) => s.promptInstall);
  const [steps, setSteps] = useState(false);
  const close = useCallback(() => setSteps(false), []);
  const start = useCallback(() => {
    void promptInstall().then((shown) => {
      if (!shown) setSteps(true);
    });
  }, [promptInstall]);
  return { start, sheet: <InstallSteps open={steps} onClose={close} /> };
}

/** Floating at the bottom of Home until installed or closed. */
export function InstallBanner() {
  const { t } = useTranslation();
  const visible = useInstall(selectBannerVisible);
  const dismiss = useInstall((s) => s.dismiss);
  const { start, sheet } = useInstallFlow();
  if (!visible) return sheet;
  return (
    <>
      <aside
        className="anim-rise fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30 mx-auto flex w-[calc(100%-24px)] max-w-[536px] items-center gap-3 rounded-2xl border border-brass-600 bg-narra-850/95 p-3 pl-4 shadow-[0_10px_32px_rgb(0_0_0/0.55)] backdrop-blur-sm"
        aria-label={t('install.bannerTitle')}
        data-testid="install-banner"
      >
        <IconDownload className="hidden shrink-0 text-brass-300 min-[400px]:block" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="leading-tight font-bold text-capiz-50">{t('install.bannerTitle')}</span>
          <span className="text-sm leading-snug text-capiz-300">{t('install.bannerBody')}</span>
        </div>
        <button
          type="button"
          className="btn btn-brass min-h-11 shrink-0 px-3.5"
          onClick={start}
          data-testid="install-banner-button"
        >
          {t('install.button')}
        </button>
        <button
          type="button"
          className="icon-btn -mr-1 shrink-0"
          aria-label={t('nav.close')}
          onClick={dismiss}
          data-sfx="back"
          data-testid="install-banner-close"
        >
          <IconClose size={20} />
        </button>
      </aside>
      {sheet}
    </>
  );
}

/** Body of the Settings "App" section: install button, or a note that it's installed. */
export function InstallSettingsRow() {
  const { t } = useTranslation();
  const installed = useInstall((s) => s.installed);
  const { start, sheet } = useInstallFlow();
  if (installed) {
    return (
      <p className="flex items-center gap-2 py-3 text-capiz-200" data-testid="install-installed">
        <IconCheck className="shrink-0 text-brass-300" size={20} />
        {t('install.installed')}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3 py-3" data-testid="settings-install">
      <p className="min-w-0 flex-1 text-sm leading-snug text-capiz-300">
        {t('install.settingsBody')}
      </p>
      <button
        type="button"
        className="btn btn-brass min-h-11 shrink-0 gap-2 px-4"
        onClick={start}
        data-testid="settings-install-button"
      >
        <IconDownload size={18} />
        {t('install.button')}
      </button>
      {sheet}
    </div>
  );
}
