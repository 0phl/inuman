// App-wide audio wiring, installed once from the root layout: the engine (unlock, visibility,
// settings), music, the delegated click sounds, start-up preloading and the "a game just started"
// fanfare.
import { getLogic } from '@/core/games/registry';
import { useSession } from '@/store/session';
import { audioDebug, engineState, installEngine, play, preload } from './engine';
import { UI_SOUNDS } from './gameSounds';
import { haptic } from './haptics';
import { installMusic, musicState } from './music';
import { installUiSounds } from './uiSounds';

let installed = false;

export function installAudio(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    installEngine();
    installMusic();
    installUiSounds();
    preload(UI_SOUNDS);
    // Debug builds / ?audioDebug=1: a peek at the engine for tests.
    if (audioDebug())
      (window as unknown as { __audioState: () => unknown }).__audioState = () => ({
        ...engineState(),
        ...musicState(),
      });
    // A new game (from the lobby or "Isa pa!"): pop the cap, and shuffle when it's a card game.
    // Hydrating a saved session on load also sets startedAt, so only changes after hydration count.
    useSession.subscribe((s, prev) => {
      if (!prev.hydrated || !s.session || !s.startedAt || s.startedAt === prev.startedAt) return;
      play('ui.gameStart');
      haptic('success');
      const id = s.session.gameId;
      if (getLogic(id).meta.family === 'cards') play('card.shuffle', { delay: 0.45 });
      if (id === 'kings-cup') play('card.fan', { delay: 1.35 });
    });
  } catch {
    // Audio must never take the app down.
  }
}
