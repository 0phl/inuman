import type { AnyGameLogic, GameId } from '../engine/types';
import { beerPong } from './beer-pong/logic';
import { flipCup } from './flip-cup/logic';
import { higherLower } from './higher-lower/logic';
import { kingsCup } from './kings-cup/logic';
import { liarsDice } from './liars-dice/logic';
import { mexico } from './mexico/logic';
import { mostLikelyTo } from './most-likely-to/logic';
import { neverHaveIEver } from './never-have-i-ever/logic';
import { quarters } from './quarters/logic';
import { rideTheBus } from './ride-the-bus/logic';
import { shipCaptainCrew } from './ship-captain-crew/logic';
import { spinTheBottle } from './spin-the-bottle/logic';
import { truthOrDare } from './truth-or-dare/logic';

const LOGIC: Partial<Record<GameId, AnyGameLogic>> = {
  'higher-lower': higherLower,
  'kings-cup': kingsCup,
  mexico,
  'liars-dice': liarsDice,
  'ship-captain-crew': shipCaptainCrew,
  'beer-pong': beerPong,
  'flip-cup': flipCup,
  quarters,
  'never-have-i-ever': neverHaveIEver,
  'ride-the-bus': rideTheBus,
  'spin-the-bottle': spinTheBottle,
  'truth-or-dare': truthOrDare,
  'most-likely-to': mostLikelyTo,
};

export const implementedGames = (): GameId[] => Object.keys(LOGIC) as GameId[];

export function getLogic(id: GameId): AnyGameLogic {
  const logic = LOGIC[id];
  if (!logic) throw new Error(`game not implemented: ${id}`);
  return logic;
}

export const hasLogic = (id: GameId): boolean => id in LOGIC;
