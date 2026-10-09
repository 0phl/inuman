import { useEffect, useLayoutEffect, useMemo } from 'react';
import { MeshStandardMaterial } from 'three';
import { useThree, type ThreeElements } from '@react-three/fiber';
import { cardGeometries, deckHeight } from './cardGeometry';
import { cardBackTexture, cardMaterial, deckEdgeTexture } from './cardTextures';

const capMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

type Deck3DProps = ThreeElements['group'] & { count: number; back: string };

/** A face-down stack of `count` cards; its top sits at y = deckHeight(count). */
export function Deck3D({ count, back, ...group }: Deck3DProps) {
  const geo = cardGeometries();
  const invalidate = useThree((s) => s.invalidate);
  const height = deckHeight(count);
  // One side material per deck for its whole life: a draw only changes how many paper layers the
  // stripes repeat (it used to rebuild the material and clone the texture on every draw).
  const side = useMemo(() => {
    const map = deckEdgeTexture().clone();
    map.needsUpdate = true;
    return new MeshStandardMaterial({ map, roughness: 0.85 });
  }, []);
  useLayoutEffect(() => {
    side.map?.repeat.set(1, Math.max(count, 1));
    invalidate();
  }, [side, count, invalidate]);
  const top = useMemo(() => cardMaterial(cardBackTexture(back)), [back]);
  useEffect(
    () => () => {
      side.map?.dispose();
      side.dispose();
    },
    [side],
  );
  useEffect(() => () => top.dispose(), [top]);

  if (count <= 0) return null;
  return (
    <group {...group}>
      <mesh geometry={geo.stack} material={[capMaterial, side]} scale={[1, height, 1]} />
      <mesh geometry={geo.front} material={top} position={[0, height - 0.0026, 0]} />
    </group>
  );
}
