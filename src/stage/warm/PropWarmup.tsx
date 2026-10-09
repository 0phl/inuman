import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { useThree } from '@react-three/fiber';
import { useTheme } from '@/store/theme';
import { Ball3D } from '@/three/Ball3D';
import { BlobShadow } from '@/three/BlobShadow';
import { Card3D } from '@/three/Card3D';
import { cardGeometries } from '@/three/cardGeometry';
import { cardBackTexture, cardMaterial, cardEdgeMaterial } from '@/three/cardTextures';
import { Coin3D } from '@/three/Coin3D';
import { Cup3D, CupInstances, type CupInstance } from '@/three/Cup3D';
import { Deck3D } from '@/three/Deck3D';
import { Die3D } from '@/three/Die3D';
import { ShotGlass3D } from '@/three/ShotGlass3D';
import { useStage, type WarmRequest } from '../stageStore';
import { propKindsFor } from './kinds';
import { warmObject } from './warmObject';

const ONE_CUP: readonly CupInstance[] = [{ position: [0, 0, 0] }];

/** The ring of face-down cards (Kings Cup) is instanced: its own shader variant. */
function InstancedCards({ back }: { back: string }) {
  const geo = cardGeometries();
  const top = useMemo(() => cardMaterial(cardBackTexture(back)), [back]);
  useEffect(() => () => top.dispose(), [top]);
  return (
    <>
      <instancedMesh args={[geo.front, top, 1]} frustumCulled={false} />
      <instancedMesh args={[geo.edge, cardEdgeMaterial, 1]} frustumCulled={false} />
    </>
  );
}

/**
 * One of each shared prop a game will draw (cards, dice, cups, ball, coin, shot glass), with the
 * current theme and tier, kept hidden in the Canvas. Mounted from the Lobby (and by /bench before
 * each scene), it compiles their shaders and uploads their textures before the game starts, so
 * props that only appear mid-game (the dice on the first roll, a drawn card) don't stall a frame.
 * It stays mounted (never drawn: an invisible group is skipped at once) so per-instance materials
 * keep their compiled programs alive until the game's own copies take them over.
 */
export function PropWarmup({ request }: { request: WarmRequest }) {
  const group = useRef<Group>(null);
  const get = useThree((s) => s.get);
  const back = useTheme((s) => s.theme.cardBack);
  const dice = useTheme((s) => s.theme.diceMaterialId);
  const kinds = propKindsFor(request.gameId);

  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    g.visible = false;
    let live = true;
    const { gl, camera, scene } = get();
    void warmObject(gl, g, camera, scene, () => live).then(() => {
      if (live) useStage.getState().markWarmed(request.nonce);
    });
    return () => {
      live = false;
    };
  }, [get, request.nonce]);

  return (
    <group ref={group}>
      <BlobShadow />
      {kinds.has('cards') && (
        <>
          <Card3D card={null} back={back} />
          <Deck3D count={8} back={back} />
          <InstancedCards back={back} />
        </>
      )}
      {kinds.has('dice') && <Die3D materialId={dice} />}
      {kinds.has('cups') && (
        <>
          <Cup3D />
          <Cup3D beer={false} shadow={false} />
          <CupInstances cups={ONE_CUP} />
          <CupInstances cups={ONE_CUP} beer={false} />
          <Ball3D />
        </>
      )}
      {kinds.has('coin') && (
        <>
          <Coin3D />
          <ShotGlass3D />
        </>
      )}
    </group>
  );
}
