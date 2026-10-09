import { play } from './engine';
import { haptic } from './haptics';

/** A done / refused chime with its haptic, for saves, imports and failed submits. */
export function feedback(kind: 'success' | 'error'): void {
  play(kind === 'success' ? 'ui.success' : 'ui.error');
  haptic(kind);
}
