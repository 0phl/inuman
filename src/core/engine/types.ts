import type { z } from 'zod';
import type { Player, PromptItem } from '../content/schemas';
import type { Rng } from './rng';

export type { Player };
export type PlayerId = string;
/** 'host' is the trusted local device (or a future room host). A PlayerId is a remote seat. */
export type Actor = PlayerId | 'host';

export type GameId =
  | 'higher-lower'
  | 'kings-cup'
  | 'ride-the-bus'
  | 'mexico'
  | 'liars-dice'
  | 'ship-captain-crew'
  | 'beer-pong'
  | 'flip-cup'
  | 'quarters'
  | 'spin-the-bottle'
  | 'truth-or-dare'
  | 'never-have-i-ever'
  | 'most-likely-to';

export type Family = 'cards' | 'dice' | 'skill' | 'party';

/** A translatable message: an i18n key plus params. Core never produces prose. */
export interface Msg {
  key: string;
  params?: Record<string, string | number>;
}

export interface DrinkEffect {
  type: 'drink';
  to: PlayerId[];
  /** Base sips, before the intensity multiplier and caps. */
  amount: number;
  /** "Finish your drink" — downgraded to the per-turn cap unless intensity.allowFinish. */
  finish?: boolean;
  kind: 'drink' | 'give' | 'social' | 'waterfall';
  reason: Msg;
}

export type Effect =
  | DrinkEffect
  | { type: 'passTo'; player: PlayerId; private: boolean }
  | { type: 'notice'; msg: Msg }
  | { type: 'sfx'; id: string };

export interface Ctx {
  players: readonly Player[];
  rng: Rng;
}

export interface GameContent {
  prompts?: PromptItem[];
}

export interface Step<S> {
  state: S;
  effects: Effect[];
}

export interface GameLogic<S, A extends { type: string }, R> {
  id: GameId;
  version: number;
  meta: { family: Family; min: number; max: number; hiddenInfo: boolean; needsContent?: boolean };
  /** Every field has a .default() and a .meta({ label }) — the rules editor is generated from it. */
  rulesSchema: z.ZodType<R>;
  actionSchema: z.ZodType<A>;
  setup(rules: R, ctx: Ctx, content: GameContent): S;
  /** Returns an i18n error key, or null when the action is legal. */
  validate(state: S, action: A, actor: Actor, rules: R): string | null;
  reduce(state: S, action: A, ctx: Ctx, rules: R): Step<S>;
  /** Redacts hidden info for a viewer. The UI renders only this. */
  project(state: S, viewer: PlayerId | 'table'): unknown;
  activeActor(state: S): PlayerId | 'any' | null;
  isOver(state: S): boolean;
}

// The registry stores heterogeneous games; each module stays fully typed internally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameLogic = GameLogic<any, any, any>;
