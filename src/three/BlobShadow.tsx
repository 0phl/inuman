import { useEffect, useMemo, type Ref } from 'react';
import { MeshBasicMaterial, PlaneGeometry, type Mesh } from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { blobShadowTexture } from '@/stage/proceduralTextures';
import { CARD_H, CARD_W } from './cardGeometry';

let geometry: PlaneGeometry | null = null;
let texture: ReturnType<typeof blobShadowTexture> | null = null;

const shared = () => {
  geometry ??= new PlaneGeometry(CARD_W * 1.5, CARD_H * 1.4).rotateX(-Math.PI / 2);
  texture ??= blobShadowTexture();
  return { geometry, texture };
};

type BlobShadowProps = ThreeElements['mesh'] & { opacity?: number; ref?: Ref<Mesh> };

/** Cheap soft shadow decal under a card or deck (works on every tier and while things move). */
export function BlobShadow({ opacity = 0.55, ref, ...mesh }: BlobShadowProps) {
  const { geometry: g, texture: map } = shared();
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map,
        transparent: true,
        depthWrite: false,
        opacity,
        color: '#000000',
      }),
    [map, opacity],
  );
  useEffect(() => () => material.dispose(), [material]);
  return <mesh ref={ref} geometry={g} material={material} renderOrder={-1} {...mesh} />;
}
