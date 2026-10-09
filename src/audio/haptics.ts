// Haptic feedback. Android: navigator.vibrate patterns. iOS Safari (17.4+), which has no vibrate
// API: toggling a hidden <input type="checkbox" switch> through its label plays the system's
// switch haptic — one short tick, and only inside a user-gesture call stack, so multi-pulse
// patterns become a single tick there and anything scheduled later is a no-op.
import { useSettings } from '@/store/settings';

export type HapticPattern =
  | 'tap'
  | 'select'
  | 'impactLight'
  | 'impactMedium'
  | 'impactHeavy'
  | 'success'
  | 'error'
  | 'drink'
  | 'win';

/** Vibration patterns in ms (on, off, on, …). */
export const HAPTIC_PATTERNS: Readonly<Record<HapticPattern, number | readonly number[]>> = {
  tap: 8,
  select: 5,
  impactLight: 12,
  impactMedium: 22,
  impactHeavy: 38,
  success: [12, 70, 22],
  error: [28, 60, 28],
  drink: [18, 80, 42],
  win: [16, 70, 16, 70, 48],
};

/** Multi-pulse patterns: skipped when the user prefers reduced motion. */
const continuous = (p: HapticPattern) => Array.isArray(HAPTIC_PATTERNS[p]);

/** Heavier patterns may cut in on a light one; light taps never interrupt anything. */
const WEIGHT: Readonly<Record<HapticPattern, number>> = {
  select: 0,
  tap: 0,
  impactLight: 1,
  impactMedium: 2,
  impactHeavy: 3,
  success: 2,
  error: 2,
  drink: 3,
  win: 4,
};

const MIN_GAP_MS = 45;
let lastAt = -Infinity;
let lastEnd = -Infinity;
let lastWeight = 0;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const patternLength = (p: number | readonly number[]) =>
  typeof p === 'number' ? p : p.reduce((a, b) => a + b, 0);

/** Pure rate limiter: may a pattern of `weight` start at `now` (ms)? Exported for tests. */
export function hapticAllowed(
  now: number,
  weight: number,
  last: { at: number; end: number; weight: number },
): boolean {
  if (now - last.at < MIN_GAP_MS) return weight > last.weight;
  // A light tick doesn't cut a longer pattern short.
  if (now < last.end && weight < last.weight) return false;
  return true;
}

// ---------------------------------------------------------------- iOS switch trick

let iosLabel: HTMLLabelElement | null = null;
let iosChecked: boolean | null = null;

function iosSupported(): boolean {
  if (iosChecked !== null) return iosChecked;
  iosChecked = false;
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return false;
  if (typeof navigator.vibrate === 'function') return false;
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  // WebKit 17.4+ reflects the attribute as a property.
  iosChecked = 'switch' in input;
  return iosChecked;
}

function iosTick(): void {
  // Needs transient user activation (inside a tap's call stack).
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (ua && !ua.isActive) return;
  if (!iosLabel) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    // Its synthetic click bubbles: keep the delegated UI sounds from playing a toggle for it.
    label.setAttribute('data-sfx', 'none');
    label.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    iosLabel = label;
  }
  iosLabel.click();
}

// ---------------------------------------------------------------- public

/** Plays a haptic pattern (no-op when haptics are off, unsupported, or rate-limited). */
export function haptic(pattern: HapticPattern): void {
  try {
    if (!useSettings.getState().haptics) return;
    if (continuous(pattern) && reducedMotion()) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const weight = WEIGHT[pattern];
    if (!hapticAllowed(now, weight, { at: lastAt, end: lastEnd, weight: lastWeight })) return;
    const p = HAPTIC_PATTERNS[pattern];
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      // Chrome blocks (and warns about) vibrate before the first tap on the page.
      const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
        .userActivation;
      if (ua && !ua.hasBeenActive) return;
      navigator.vibrate(typeof p === 'number' ? p : [...p]);
    } else if (iosSupported()) {
      iosTick();
    } else return;
    lastAt = now;
    lastEnd = now + patternLength(p);
    lastWeight = weight;
  } catch {
    // Feedback is never worth an exception.
  }
}

/** Plays `pattern` after `ms` (Android only in practice: iOS needs a live gesture). */
export function hapticLater(pattern: HapticPattern, ms: number): () => void {
  if (ms <= 0) {
    haptic(pattern);
    return () => {};
  }
  const id = setTimeout(() => haptic(pattern), ms);
  return () => clearTimeout(id);
}
