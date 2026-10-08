import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { GameId } from '@/core/engine/types';
import type { GameViewProps } from './types';

// Views receive the game's projected view type; the registry erases it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyView = LazyExoticComponent<ComponentType<GameViewProps<any>>>;

export interface GameView {
  /** Rendered inside the persistent <Canvas> through the stage tunnel. Loads three. */
  Scene: AnyView;
  /** DOM overlay: turn info, controls. Must not import three. */
  Hud: AnyView;
}

const VIEWS: Partial<Record<GameId, GameView>> = {
  'higher-lower': {
    Scene: lazy(() => import('./higher-lower/Scene')),
    Hud: lazy(() => import('./higher-lower/Hud')),
  },
  'kings-cup': {
    Scene: lazy(() => import('./kings-cup/Scene')),
    Hud: lazy(() => import('./kings-cup/Hud')),
  },
  'never-have-i-ever': {
    Scene: lazy(() => import('./never-have-i-ever/Scene')),
    Hud: lazy(() => import('./never-have-i-ever/Hud')),
  },
  mexico: {
    Scene: lazy(() => import('./mexico/Scene')),
    Hud: lazy(() => import('./mexico/Hud')),
  },
  'ship-captain-crew': {
    Scene: lazy(() => import('./ship-captain-crew/Scene')),
    Hud: lazy(() => import('./ship-captain-crew/Hud')),
  },
  'liars-dice': {
    Scene: lazy(() => import('./liars-dice/Scene')),
    Hud: lazy(() => import('./liars-dice/Hud')),
  },
  'spin-the-bottle': {
    Scene: lazy(() => import('./spin-the-bottle/Scene')),
    Hud: lazy(() => import('./spin-the-bottle/Hud')),
  },
  'truth-or-dare': {
    Scene: lazy(() => import('./truth-or-dare/Scene')),
    Hud: lazy(() => import('./truth-or-dare/Hud')),
  },
  'most-likely-to': {
    Scene: lazy(() => import('./most-likely-to/Scene')),
    Hud: lazy(() => import('./most-likely-to/Hud')),
  },
  'ride-the-bus': {
    Scene: lazy(() => import('./ride-the-bus/Scene')),
    Hud: lazy(() => import('./ride-the-bus/Hud')),
  },
  'beer-pong': {
    Scene: lazy(() => import('./beer-pong/Scene')),
    Hud: lazy(() => import('./beer-pong/Hud')),
  },
  quarters: {
    Scene: lazy(() => import('./quarters/Scene')),
    Hud: lazy(() => import('./quarters/Hud')),
  },
  'flip-cup': {
    Scene: lazy(() => import('./flip-cup/Scene')),
    Hud: lazy(() => import('./flip-cup/Hud')),
  },
};

export const getView = (id: GameId): GameView | undefined => VIEWS[id];
export const hasView = (id: GameId): boolean => id in VIEWS;
