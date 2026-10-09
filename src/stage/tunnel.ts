import { createElement, Fragment, useLayoutEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';

// A minimal tunnel (same In/Out API as tunnel-rat): game scenes render into the one persistent
// <Canvas> through it. Each <In> is keyed by its own id, so Out keeps an In's content mounted
// across its re-renders and can tell when a different In (a new game screen) took over: the
// stage precompiles that new content before showing it (see warm/SceneGate.tsx).

interface Entry {
  id: number;
  children: ReactNode;
}

function createTunnel() {
  const useStore = create<{ entries: Entry[] }>()(() => ({ entries: [] }));
  let nextId = 0;

  function In({ children }: { children: ReactNode }) {
    const [id] = useState(() => ++nextId);
    useLayoutEffect(() => {
      useStore.setState((s) => ({
        entries: [...s.entries.filter((e) => e.id !== id), { id, children }].sort(
          (a, b) => a.id - b.id,
        ),
      }));
    }, [id, children]);
    useLayoutEffect(
      () => () => useStore.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      [id],
    );
    return null;
  }

  function Out() {
    const entries = useStore((s) => s.entries);
    return entries.map((e) => createElement(Fragment, { key: e.id }, e.children));
  }

  /** Changes only when an <In> mounts or unmounts (not when its children re-render). */
  const useContentKey = (): string => useStore((s) => s.entries.map((e) => e.id).join(','));

  return { In, Out, useContentKey };
}

/** Game scenes render into the one persistent <Canvas> through this tunnel. */
export const sceneTunnel = createTunnel();
