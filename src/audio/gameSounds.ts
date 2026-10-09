import type { GameId } from '@/core/engine/types';
import { SOUNDS, type SoundId } from './catalog';

/** Every UI sound (preloaded at start-up). */
export const UI_SOUNDS = (Object.keys(SOUNDS) as SoundId[]).filter((id) => id.startsWith('ui.'));

const DRINKS: SoundId[] = ['drink.cheers', 'drink.social', 'drink.finish', 'drink.give'];
const RESULTS: SoundId[] = ['game.win', 'game.lose', 'game.roundOver'];
const CARDS: SoundId[] = ['card.slide', 'card.flip', 'card.place', 'card.shuffle'];
const DICE: SoundId[] = [
  'dice.throw',
  'dice.hitTable',
  'dice.hitDie',
  'dice.hitWall',
  'dice.grab',
  'dice.shake',
  'cup.slam',
];
const THROW: SoundId[] = ['throw.whoosh'];

/** The sounds a game plays, preloaded when its lobby opens. */
export const GAME_SOUNDS: Record<GameId, SoundId[]> = {
  'higher-lower': [...CARDS, 'game.correct', 'game.wrong', 'game.tie', 'game.streak'],
  'kings-cup': [...CARDS, 'card.fan', 'pour.beer'],
  'ride-the-bus': [...CARDS, 'game.correct', 'game.wrong', 'bus.horn', 'bus.crash', 'game.streak'],
  mexico: [...DICE, 'game.lose', 'game.streak'],
  'ship-captain-crew': [...DICE, 'game.streak'],
  'liars-dice': [...DICE, 'cup.lift', 'game.sting'],
  'beer-pong': [...THROW, 'ball.bounce', 'ball.rim', 'ball.plop', 'cup.remove', 'cup.rerack'],
  quarters: [...THROW, 'coin.bounce', 'coin.rim', 'coin.ding', 'game.streak'],
  'flip-cup': ['flip.whoosh', 'flip.land', 'flip.fail'],
  'spin-the-bottle': ['bottle.spin', 'bottle.stop', 'bottle.select', 'card.flip', 'card.place'],
  'truth-or-dare': ['wheel.whoosh', 'wheel.tick', 'wheel.stop', 'card.flip', 'card.place'],
  'never-have-i-ever': ['card.flip', 'card.place', 'chips.stack'],
  'most-likely-to': ['card.flip', 'card.place', 'chips.stack', 'game.sting'],
};

/** A game's sounds plus the drinks and results every game can end in. */
export const soundsFor = (game: GameId): SoundId[] => [
  ...new Set([...(GAME_SOUNDS[game] ?? []), ...DRINKS, ...RESULTS]),
];
