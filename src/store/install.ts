import { create } from 'zustand';

// "Install the app" state: Chrome / Android's deferred `beforeinstallprompt` (the real install
// dialog), iOS (no prompt API: Share → Add to Home Screen), whether we already run installed, and
// whether the floating banner was closed on this device (Settings keeps the button either way).

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPlatform = 'ios' | 'android' | 'desktop';

/** Which install steps fit this browser (iPadOS reports a Mac UA, but with touch). */
export function detectPlatform(ua: string, maxTouchPoints: number): InstallPlatform {
  if (/iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

const DISMISS_KEY = 'inuman.installDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function runningInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

interface InstallState {
  platform: InstallPlatform;
  /** Running as the installed app (home screen / its own window). */
  installed: boolean;
  /** The browser's install dialog, when it offers one (Chrome, Edge, Samsung Internet). */
  promptEvent: BeforeInstallPromptEvent | null;
  /** The floating banner was closed on this device. */
  dismissed: boolean;
  dismiss(): void;
  /** Opens the browser's install dialog; false when there is none (show the steps instead). */
  promptInstall(): Promise<boolean>;
}

export const useInstall = create<InstallState>()((set, get) => ({
  platform:
    typeof navigator === 'undefined'
      ? 'desktop'
      : detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0),
  installed: runningInstalled(),
  promptEvent: null,
  dismissed: readDismissed(),
  dismiss: () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode: it just comes back next visit.
    }
    set({ dismissed: true });
  },
  promptInstall: async () => {
    const e = get().promptEvent;
    if (!e) return false;
    // A prompt can only be shown once; Chrome fires a fresh event if it may ask again.
    set({ promptEvent: null });
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') set({ installed: true });
    } catch {
      // Already used or blocked: the steps sheet is the fallback next time.
    }
    return true;
  },
}));

/** Whether the floating banner should show (Settings shows its row regardless). */
export const selectBannerVisible = (s: InstallState): boolean =>
  !s.installed && !s.dismissed && (s.promptEvent !== null || s.platform !== 'desktop');

let captured = false;

/**
 * Listens for the install events. Call before the first render: Chrome fires
 * `beforeinstallprompt` early, and only once per page load.
 */
export function captureInstallEvents(): void {
  if (captured || typeof window === 'undefined') return;
  captured = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep Chrome's own mini-infobar away; our banner and Settings offer it instead.
    e.preventDefault();
    useInstall.setState({ promptEvent: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    useInstall.setState({ installed: true, promptEvent: null });
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (m) => {
    if (m.matches) useInstall.setState({ installed: true });
  });
}
