import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Group } from 'three';
import { useThree } from '@react-three/fiber';
import { useStage } from '../stageStore';
import { sceneTunnel } from '../tunnel';
import { warmObject } from './warmObject';

/**
 * Keeps its children hidden from mount until their shaders are compiled (in parallel, where the
 * GPU allows: KHR_parallel_shader_compile) and their textures uploaded, then shows them. Instead of
 * the page freezing in the first frame that draws them, it stays responsive and they appear a
 * moment later. Only gates on mount; later changes inside render as usual.
 *
 * Lights must stay outside: hiding a light changes every lit material's shader, so the programs
 * compiled here would be thrown away the moment the lights came back.
 */
export function WarmGate({ children, onShown }: { children: ReactNode; onShown?: () => void }) {
  const group = useRef<Group>(null);
  const get = useThree((s) => s.get);
  const shown = useRef(onShown);
  useLayoutEffect(() => {
    shown.current = onShown;
  });

  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    let live = true;
    const { gl, camera, scene } = get();
    g.visible = false;
    void warmObject(gl, g, camera, scene, () => live).then(() => {
      if (!live) return;
      g.visible = true;
      get().invalidate();
      shown.current?.();
    });
    return () => {
      live = false;
    };
  }, [get]);

  // Hidden imperatively above (before any frame), not with a `visible` prop: after a Suspense
  // re-show R3F restores that prop and would keep the content hidden.
  return <group ref={group}>{children}</group>;
}

const markRevealed = () => useStage.getState().markRevealed();

/** The game scene: gated again whenever a different screen's <In> takes over the tunnel. */
export function SceneGate() {
  const key = sceneTunnel.useContentKey();
  // A new screen (or none): not ready until its gate opens.
  useLayoutEffect(() => useStage.getState().setSceneReady(false), [key]);
  return (
    <WarmGate key={key} onShown={key ? markRevealed : undefined}>
      <sceneTunnel.Out />
    </WarmGate>
  );
}
