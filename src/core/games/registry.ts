import type { AnyGameLogic, GameId } from '../engine/types';
import { higherLower } from './higher-lower/logic';
import { kingsCup } from './kings-cup/logic';
import { liarsDice } from './liars-dice/logic';
import { mexico } from './mexico/logic';
import { neverHaveIEver } from './never-have-i-ever/logic';
import { shipCaptainCrew } from './ship-captain-crew/logic';

const LOGIC: Partial<Record<GameId, AnyGameLogic>> = {
  'higher-lower': higherLower,
  'kings-cup': kingsCup,
  mexico,
  'liars-dice': liarsDice,
  'ship-captain-crew': shipCaptainCrew,
  'never-have-i-ever': neverHaveIEver,
};

export const implementedGames = (): GameId[] => Object.keys(LOGIC) as GameId[];

export function getLogic(id: GameId): AnyGameLogic {
  const logic = LOGIC[id];
  if (!logic) throw new Error(`game not implemented: ${id}`);
  return logic;
}

export const hasLogic = (id: GameId): boolean => id in LOGIC;
