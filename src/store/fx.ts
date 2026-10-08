import { create } from 'zustand';
import type { SessionEffect } from '@/core/engine/session';
import type { Msg } from '@/core/engine/types';

/** UI-only effects that don't come from core (e.g. a rejected action). */
export type UiEffect = SessionEffect | { type: 'error'; msg: Msg };

export interface FxItem {
  id: number;
  fx: UiEffect;
  /** When it was queued (ms epoch), so the UI can let a 3D animation land before revealing it. */
  at: number;
}

interface FxState {
  items: FxItem[];
  /**
   * Viewport y (px) of the bottom of the game's turn indicator. Toasts stack below it so they never
   * hide whose turn it is; null = the default slot under the play header.
   */
  anchor: number | null;
  /**
   * Toasts shrink to one-line chips while the table itself is the news (e.g. Liar's Dice's reveal,
   * where the full cards would sit on top of the dice being counted).
   */
  compact: boolean;
  /** The game-over results cover is up (a game can name its winner on top of it). */
  resultsShown: boolean;
  push(effects: readonly UiEffect[]): void;
  dismiss(id: number): void;
  clear(): void;
  setAnchor(y: number | null): void;
  setCompact(on: boolean): void;
  setResultsShown(on: boolean): void;
}

let nextId = 1;
const MAX_QUEUE = 30;

/** The effect queue the play UI drains: drink toasts, notices, pass-the-phone prompts. */
export const useFx = create<FxState>()((set) => ({
  items: [],
  anchor: null,
  compact: false,
  resultsShown: false,
  push: (effects) =>
    set((s) => {
      const at = Date.now();
      const added = effects
        .filter((fx) => fx.type !== 'sfx')
        .map((fx) => ({ id: nextId++, fx, at }));
      if (!added.length) return {};
      // Only the latest pass-the-phone prompt matters.
      const keep = added.some((a) => a.fx.type === 'passTo')
        ? s.items.filter((i) => i.fx.type !== 'passTo')
        : s.items;
      return { items: [...keep, ...added].slice(-MAX_QUEUE) };
    }),
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
  setAnchor: (y) => set((s) => (s.anchor === y ? {} : { anchor: y })),
  setCompact: (on) => set((s) => (s.compact === on ? {} : { compact: on })),
  setResultsShown: (on) => set((s) => (s.resultsShown === on ? {} : { resultsShown: on })),
}));
