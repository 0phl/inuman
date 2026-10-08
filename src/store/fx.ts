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
  push(effects: readonly UiEffect[]): void;
  dismiss(id: number): void;
  clear(): void;
  setAnchor(y: number | null): void;
}

let nextId = 1;
const MAX_QUEUE = 30;

/** The effect queue the play UI drains: drink toasts, notices, pass-the-phone covers. */
export const useFx = create<FxState>()((set) => ({
  items: [],
  anchor: null,
  push: (effects) =>
    set((s) => {
      const at = Date.now();
      const added = effects
        .filter((fx) => fx.type !== 'sfx')
        .map((fx) => ({ id: nextId++, fx, at }));
      if (!added.length) return {};
      // Only the latest pass-the-phone cover matters.
      const keep = added.some((a) => a.fx.type === 'passTo')
        ? s.items.filter((i) => i.fx.type !== 'passTo')
        : s.items;
      return { items: [...keep, ...added].slice(-MAX_QUEUE) };
    }),
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  clear: () => set({ items: [] }),
  setAnchor: (y) => set((s) => (s.anchor === y ? {} : { anchor: y })),
}));
