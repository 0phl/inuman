import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  PointsMaterial,
  RingGeometry,
  type Mesh,
  type Texture,
} from 'three';
import { useThree } from '@react-three/fiber';
import { softDiscTexture } from '@/stage/proceduralTextures';
import { BALL_RADIUS, COIN_RADIUS, type ThrowTarget } from './throwConfig';
import { ballisticPath, type RawThrow } from './throwMath';

const DOTS = 24;
let dotTex: Texture | null = null;
let ringGeo: RingGeometry | null = null;

export interface AimPreviewProps {
  /** The throw that would happen on release (after aim assist), or null to hide. */
  aim: RawThrow | null;
  /** Standing targets: an arc that drops into one ends at its opening instead of the felt. */
  targets?: readonly ThrowTarget[];
  color?: string;
  /** Dot size in world units. */
  size?: number;
}

/**
 * A dotted arc of where the current drag would send the ball/coin (the coin's arc shows its one
 * modelled bounce; a ball dropping into a cup ends at the rim), plus a ring where it lands — seen
 * from behind, a lob's arc folds onto itself on screen, the ring shows where it ends. Meant for
 * aim-assist levels ≥ 2. Two draw calls.
 */
export function AimPreview({ aim, targets, color = '#fff3cf', size = 0.055 }: AimPreviewProps) {
  const invalidate = useThree((s) => s.invalidate);
  const ring = useRef<Mesh>(null);
  dotTex ??= softDiscTexture(32, 0.55);
  ringGeo ??= new RingGeometry(0.72, 1, 32).rotateX(-Math.PI / 2);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array((DOTS + 1) * 3), 3));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new PointsMaterial({
        color,
        size,
        map: dotTex,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    [color, size],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (aim) {
      const pts = ballisticPath(aim, DOTS, 1.6, targets);
      const attr = geometry.getAttribute('position') as BufferAttribute;
      pts.forEach((p, i) => attr.setXYZ(i, p[0], p[1], p[2]));
      attr.needsUpdate = true;
      geometry.setDrawRange(1, pts.length - 1); // skip the dot inside the hand
      geometry.computeBoundingSphere();
      const end = pts[pts.length - 1];
      if (end && ring.current) {
        // On the rim plane when it ends dropping into an opening, else flat on the felt.
        const onFelt = end[1] < (aim.kind === 'ball' ? BALL_RADIUS : COIN_RADIUS) + 0.02;
        ring.current.position.set(end[0], onFelt ? 0.004 : end[1] + 0.003, end[2]);
        ring.current.scale.setScalar((aim.kind === 'ball' ? BALL_RADIUS : COIN_RADIUS) * 1.35);
      }
    }
    invalidate();
  }, [aim, targets, geometry, invalidate]);

  return (
    <group visible={aim !== null}>
      <points geometry={geometry} material={material} renderOrder={5} />
      <mesh ref={ring} geometry={ringGeo} renderOrder={5}>
        <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} />
      </mesh>
    </group>
  );
}
