import { useEffect, useMemo, type Ref } from 'react';
import { MeshStandardMaterial, type Group } from 'three';
import type { ThreeElements } from '@react-three/fiber';
import type { Card } from '@/core/primitives/deck';
import { cardGeometries } from './cardGeometry';
import { cardBackTexture, cardFaceTexture } from './cardTextures';

const edgeMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

type Card3DProps = ThreeElements['group'] & {
  /** The card's face; null renders a card whose face is unknown (shows the back on both sides). */
  card: Card | null;
  back: string;
  ref?: Ref<Group>;
};

/** One playing card lying flat, face up (+Y). Rotate the group to turn it over. */
export function Card3D({ card, back, ref, ...group }: Card3DProps) {
  const geo = cardGeometries();
  const front = useMemo(
    () =>
      new MeshStandardMaterial({
        map: card === null ? cardBackTexture(back) : cardFaceTexture(card),
        roughness: 0.38,
        metalness: 0,
        envMapIntensity: 0.8,
      }),
    [card, back],
  );
  const backMat = useMemo(
    () => new MeshStandardMaterial({ map: cardBackTexture(back), roughness: 0.42, envMapIntensity: 0.8 }),
    [back],
  );
  // Materials are per card; textures belong to the LRU cache.
  useEffect(() => () => front.dispose(), [front]);
  useEffect(() => () => backMat.dispose(), [backMat]);

  return (
    <group ref={ref} {...group}>
      <mesh geometry={geo.front} material={front} />
      <mesh geometry={geo.back} material={backMat} />
      <mesh geometry={geo.edge} material={edgeMaterial} />
    </group>
  );
}
