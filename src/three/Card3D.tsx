import { useLayoutEffect, useRef, type Ref } from 'react';
import { MeshStandardMaterial, type Group, type MeshPhysicalMaterial, type Texture } from 'three';
import { useThree, type ThreeElements } from '@react-three/fiber';
import type { Card } from '@/core/primitives/deck';
import { cardGeometries } from './cardGeometry';
import { acquireCardFace, CARD_FINISH, cardBackTexture, releaseCardFace } from './cardTextures';

const edgeMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

type Card3DProps = ThreeElements['group'] & {
  /** The card's face; null renders a card whose face is unknown (shows the back on both sides). */
  card: Card | null;
  back: string;
  ref?: Ref<Group>;
};

/** Puts `map` on a material that may not have been drawn with one yet. */
function setMap(material: MeshPhysicalMaterial | null, map: Texture): boolean {
  if (!material || material.map === map) return false;
  // Going from no map to a map switches shader variants.
  if (!material.map) material.needsUpdate = true;
  material.map = map;
  return true;
}

/**
 * One playing card lying flat, face up (+Y). Rotate the group to turn it over.
 *
 * Materials are per card (cheap, created and disposed by R3F); textures are shared. The face
 * texture is held from the commit that shows it until the card unmounts or changes face (acquire
 * in a layout effect, before the frame is drawn; release in its cleanup), so the shared cache can
 * never dispose a face that is still on the table, however many distinct faces are out.
 *
 * Colour notes: under the bar's warm key light and AgX, a bright saturated red lands on AgX's
 * shoulder and reads coral. Cards use the deeper 'print' ink (cardArt.ts) and the low-sheen
 * CARD_FINISH so hearts, diamonds and red backs come out true red.
 */
export function Card3D({ card, back, ref, ...group }: Card3DProps) {
  const geo = cardGeometries();
  const invalidate = useThree((s) => s.invalidate);
  const backMap = cardBackTexture(back);
  const frontMat = useRef<MeshPhysicalMaterial>(null);
  const backMat = useRef<MeshPhysicalMaterial>(null);

  useLayoutEffect(() => {
    if (setMap(backMat.current, backMap)) invalidate();
  }, [backMap, invalidate]);

  useLayoutEffect(() => {
    if (card === null) {
      if (setMap(frontMat.current, backMap)) invalidate();
      return;
    }
    setMap(frontMat.current, acquireCardFace(card));
    invalidate();
    return () => releaseCardFace(card);
  }, [card, backMap, invalidate]);

  return (
    <group ref={ref} {...group}>
      <mesh geometry={geo.front}>
        <meshPhysicalMaterial ref={frontMat} {...CARD_FINISH} />
      </mesh>
      <mesh geometry={geo.back}>
        <meshPhysicalMaterial ref={backMat} {...CARD_FINISH} />
      </mesh>
      <mesh geometry={geo.edge} material={edgeMaterial} />
    </group>
  );
}
