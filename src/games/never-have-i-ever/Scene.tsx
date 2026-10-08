import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MeshStandardMaterial, type Group, type Texture } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import type { View } from '@/core/games/never-have-i-ever/logic';
import { BlobShadow } from '@/three/BlobShadow';
import { cardGeometries, CARD_H, deckHeight } from '@/three/cardGeometry';
import { deckEdgeTexture } from '@/three/cardTextures';
import type { GameViewProps } from '../types';
import { promptBackTexture, promptFaceTexture, SIGN_FONT } from './textures';

/**
 * The tent card stands right of centre toward the back of the table, the stack of prompts to its
 * left: the prompt text and player picker cover the near half of the table on a portrait phone.
 */
const TENT_X = 0.3;
const TENT_Z = -0.8;
const TILT = (64 * Math.PI) / 180;
const PANEL_SCALE = 0.96;
const PANEL_H = CARD_H * PANEL_SCALE;
const STACK_X = -0.64;
const STACK_Z = -0.78;
const STACK_YAW = 0.14;
/** The stack is drawn at most this tall; the HUD shows the real count. */
const STACK_MAX = 36;
const SPIN_SECONDS = 0.8;
const HOP = 0.14;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const edgeMaterial = new MeshStandardMaterial({ color: '#d9c9a6', roughness: 0.8 });
const capMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

/** Waits for the sign font so the canvas lettering isn't stuck on the fallback face. */
function useSignFont(): boolean {
  const [ready, setReady] = useState(() => {
    try {
      return typeof document === 'undefined' || !document.fonts || document.fonts.check(SIGN_FONT);
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (ready || !document.fonts) return;
    let live = true;
    const done = () => {
      if (live) setReady(true);
    };
    document.fonts.load(SIGN_FONT).then(done, done);
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

/** One leaning side of the tent: decorated face outward, plain back inward. Its top edge is the ridge. */
function Panel({ face }: { face: Texture }) {
  const geo = cardGeometries();
  const back = useMemo(
    () =>
      new MeshStandardMaterial({ map: promptBackTexture(), roughness: 0.5, envMapIntensity: 0.7 }),
    [],
  );
  useEffect(() => () => back.dispose(), [back]);
  const half = PANEL_H / 2;
  return (
    <group
      position={[0, half * Math.sin(TILT) + 0.002, half * Math.cos(TILT)]}
      rotation={[TILT, 0, 0]}
      scale={PANEL_SCALE}
    >
      <mesh geometry={geo.front}>
        <meshStandardMaterial map={face} roughness={0.42} envMapIntensity={0.9} />
      </mesh>
      <mesh geometry={geo.back} material={back} />
      <mesh geometry={geo.edge} material={edgeMaterial} />
    </group>
  );
}

/**
 * A folded table-tent card. When the round changes it hops and spins a half turn: the far side
 * already carries the new round, so the swap reads as flipping to the next card.
 */
function TentCard({ round, fontReady }: { round: number; fontReady: boolean }) {
  const spin = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  /** The round printed on the side facing the players. */
  const [shown, setShown] = useState(round);
  const anim = useRef<{ start: number; duration: number } | null>(null);

  const near = promptFaceTexture(shown, fontReady);
  const far = promptFaceTexture(round, fontReady);

  // A new round: spin to the far side.
  useEffect(() => {
    if (round === shown) return;
    anim.current = { start: -1, duration: reducedMotion() ? 0.15 : SPIN_SECONDS };
    invalidate();
  }, [round, shown, invalidate]);

  // The spin ended on the far side and the near side now shows the same round: square up again.
  useLayoutEffect(() => {
    const g = spin.current;
    if (!g) return;
    g.rotation.y = 0;
    g.position.y = 0;
    invalidate();
  }, [shown, invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = spin.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.start < 0) a.start = now;
    const raw = Math.min((now - a.start) / a.duration, 1);
    g.rotation.y = Math.PI * easing.cubic.inOut(raw);
    g.position.y = Math.sin(Math.PI * raw) * HOP;
    if (raw < 1) {
      state.invalidate();
    } else {
      anim.current = null;
      setShown(round);
    }
  });

  return (
    <group position={[TENT_X, 0, TENT_Z]}>
      <BlobShadow position={[0, 0.0026, 0]} scale={[0.72, 1, 0.68]} opacity={0.6} />
      <group ref={spin}>
        <Panel face={near} />
        <group rotation={[0, Math.PI, 0]}>
          <Panel face={far} />
        </group>
      </group>
    </group>
  );
}

/** The prompts still to come, face down. */
function PromptStack({ count }: { count: number }) {
  const geo = cardGeometries();
  const shown = Math.min(count, STACK_MAX);
  const height = deckHeight(shown);
  const side = useMemo(() => {
    const map = deckEdgeTexture().clone();
    map.repeat.set(1, Math.max(shown, 1));
    map.needsUpdate = true;
    return new MeshStandardMaterial({ map, color: '#e9dcc0', roughness: 0.85 });
  }, [shown]);
  const top = useMemo(
    () =>
      new MeshStandardMaterial({ map: promptBackTexture(), roughness: 0.45, envMapIntensity: 0.8 }),
    [],
  );
  useEffect(
    () => () => {
      side.map?.dispose();
      side.dispose();
    },
    [side],
  );
  useEffect(() => () => top.dispose(), [top]);

  if (shown <= 0) return null;
  return (
    <group position={[STACK_X, 0.001, STACK_Z]} rotation={[0, STACK_YAW, 0]}>
      <BlobShadow position={[0, 0.0015, 0]} opacity={0.6} />
      <mesh geometry={geo.stack} material={[capMaterial, side]} scale={[1, height, 1]} />
      <mesh geometry={geo.front} material={top} position={[0, height - 0.0026, 0]} />
    </group>
  );
}

/** Never Have I Ever: a tent card propped on the table and the stack of prompts still to come. */
export default function NeverHaveIEverScene({ view }: GameViewProps<View>) {
  const fontReady = useSignFont();
  return (
    <group>
      <PromptStack count={view.remaining} />
      <TentCard round={view.round} fontReady={fontReady} />
    </group>
  );
}
