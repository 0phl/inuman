import { useEffect, useMemo } from 'react';
import { Path, Shape, ShapeGeometry } from 'three';
import { useTheme } from '@/store/theme';
import { feltTexture } from '../proceduralTextures';
import { TABLE_Y } from '../tableSpace';

function roundedRectShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

/** The same rounded rectangle, wound the other way (a hole for the inlay ring). */
function holePath(w: number, h: number, r: number): Path {
  const p = new Path();
  p.moveTo(-w / 2 + r, -h / 2);
  p.quadraticCurveTo(-w / 2, -h / 2, -w / 2, -h / 2 + r);
  p.lineTo(-w / 2, h / 2 - r);
  p.quadraticCurveTo(-w / 2, h / 2, -w / 2 + r, h / 2);
  p.lineTo(w / 2 - r, h / 2);
  p.quadraticCurveTo(w / 2, h / 2, w / 2, h / 2 - r);
  p.lineTo(w / 2, -h / 2 + r);
  p.quadraticCurveTo(w / 2, -h / 2, w / 2 - r, -h / 2);
  p.lineTo(-w / 2 + r, -h / 2);
  return p;
}

interface FeltMatProps {
  width: number;
  depth: number;
  radius?: number;
  /**
   * Whether an environment map lights the scene. The brass inlay is a polished metal and goes
   * black without one, so without IBL it gets a duller, partly diffuse finish instead.
   */
  ibl?: boolean;
}

/**
 * The play mat: fibrous felt in the theme colour with a thin brass inlay, lying on the table top
 * (just above TABLE_Y so it never z-fights the table).
 */
export function FeltMat({ width, depth, radius = 0.22, ibl = true }: FeltMatProps) {
  const feltColor = useTheme((s) => s.theme.feltColor);
  const felt = useMemo(() => {
    const t = feltTexture(128);
    // ShapeGeometry UVs are in world units, so the fibre scale stays the same at any mat size.
    t.repeat.set(6, 4.5);
    return t;
  }, []);
  const geoms = useMemo(() => {
    const feltGeo = new ShapeGeometry(roundedRectShape(width, depth, radius), 6);
    const ring = roundedRectShape(width + 0.1, depth + 0.1, radius + 0.04);
    ring.holes.push(holePath(width, depth, radius));
    return { feltGeo, ringGeo: new ShapeGeometry(ring, 6) };
  }, [width, depth, radius]);

  useEffect(() => () => felt.dispose(), [felt]);
  useEffect(
    () => () => {
      geoms.feltGeo.dispose();
      geoms.ringGeo.dispose();
    },
    [geoms],
  );

  return (
    <group position-y={TABLE_Y}>
      <mesh geometry={geoms.ringGeo} rotation-x={-Math.PI / 2} position-y={0.0012}>
        <meshStandardMaterial
          color="#c9913a"
          metalness={ibl ? 1 : 0.55}
          roughness={ibl ? 0.32 : 0.42}
        />
      </mesh>
      <mesh geometry={geoms.feltGeo} rotation-x={-Math.PI / 2} position-y={0.001}>
        <meshStandardMaterial color={feltColor} map={felt} roughness={1} />
      </mesh>
    </group>
  );
}
