// One document-level click listener gives every button and link its click, so components need no
// sound code. `data-sfx` on the element (or any ancestor) picks the flavour:
//   primary · select · toggle · back · tap · none
// Without it the role decides: switches toggle, radios/tabs/pressed buttons select, the brass call
// to action is primary, everything else taps.
import type { SoundId } from './catalog';
import { play } from './engine';
import { haptic, type HapticPattern } from './haptics';

export type SfxKind = 'primary' | 'select' | 'toggle' | 'back' | 'tap' | 'none';

const CLICKABLE =
  'button, a[href], summary, [role="button"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="checkbox"], [role="menuitem"], input[type="checkbox"], input[type="radio"], [data-sfx]';

const KINDS: readonly SfxKind[] = ['primary', 'select', 'toggle', 'back', 'tap', 'none'];

/** What a click on `el` should sound like (exported for tests / reuse). */
export function classifyClick(el: Element): { kind: SfxKind; on?: boolean } {
  const tagged = el.closest('[data-sfx]')?.getAttribute('data-sfx') as SfxKind | null | undefined;
  const role = el.getAttribute('role');
  const input = el instanceof HTMLInputElement ? el : null;
  const toggleState = (): boolean =>
    // A native checkbox has already flipped when click fires; an ARIA switch still shows the old state.
    input ? input.checked : el.getAttribute('aria-checked') !== 'true';
  if (tagged && KINDS.includes(tagged)) {
    return tagged === 'toggle' ? { kind: 'toggle', on: toggleState() } : { kind: tagged };
  }
  if (role === 'switch' || role === 'checkbox' || input?.type === 'checkbox')
    return { kind: 'toggle', on: toggleState() };
  if (
    role === 'radio' ||
    role === 'tab' ||
    role === 'option' ||
    input?.type === 'radio' ||
    el.hasAttribute('aria-pressed') ||
    el.tagName === 'SUMMARY'
  )
    return { kind: 'select' };
  if (el.classList.contains('btn-brass')) return { kind: 'primary' };
  return { kind: 'tap' };
}

const SOUND: Record<Exclude<SfxKind, 'none' | 'toggle'>, SoundId> = {
  primary: 'ui.tapPrimary',
  select: 'ui.select',
  back: 'ui.back',
  tap: 'ui.tap',
};
const HAPTIC: Partial<Record<SfxKind, HapticPattern>> = {
  primary: 'tap',
  select: 'select',
  toggle: 'select',
};

function onClick(e: MouseEvent): void {
  try {
    const target = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
    if (!target) return;
    if ((target as HTMLButtonElement).disabled || target.getAttribute('aria-disabled') === 'true')
      return;
    const { kind, on } = classifyClick(target);
    if (kind === 'none') return;
    play(kind === 'toggle' ? (on ? 'ui.toggleOn' : 'ui.toggleOff') : SOUND[kind]);
    const h = HAPTIC[kind];
    if (h) haptic(h);
  } catch {
    // A click sound is never worth breaking the click.
  }
}

let installed = false;

export function installUiSounds(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  // Capture: runs before React's handlers, so an ARIA switch still shows its old state.
  document.addEventListener('click', onClick, { capture: true });
}
