import { useEffect, useMemo, type Ref } from 'react';
import {
  AdditiveBlending,
  Color,
  MeshBasicMaterial,
  PlaneGeometry,
  type Group,
  type Mesh,
  type Texture,
} from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { DIE_SIZE, type TraySpec } from '@/physics/diceConfig';
import { feltTexture, softDiscTexture } from '@/stage/proceduralTextures';
import { useTheme } from '@/store/theme';
import { brassMaterial, narraMaterial } from './dice3d';
import { diceCupParts } from './diceCup';

// 3D pieces shared by the dice games (Mexico, Ship Captain & Crew, Liar's Dice): the leather dice
// cup, the dice tray, a soft die shadow and a glow disc.

// ---------------------------------------------------------------- die shadow

let shadowGeo: PlaneGeometry | null = null;
let shadowTex: Texture | null = null;

/** The same soft contact shadow DiceReplay draws, for dice placed by hand. */
export function DieShadow({
  opacity = 0.5,
  size = 1,
  ref,
  ...mesh
}: ThreeElements['mesh'] & { opacity?: number; size?: number; ref?: Ref<Mesh> }) {
  shadowGeo ??= new PlaneGeometry(DIE_SIZE * 2, DIE_SIZE * 2).rotateX(-Math.PI / 2);
  shadowTex ??= softDiscTexture(64, 0.3);
  return (
    <mesh ref={ref} geometry={shadowGeo} renderOrder={-1} scale={size} {...mesh}>
      <meshBasicMaterial
        map={shadowTex}
        color="#000000"
        transparent
        depthWrite={false}
        opacity={opacity}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------- leather dice cup

/** Cup height and radii in world units (a die is 0.26). Origin = centre of the base. */
type DiceCupProps = Omit<ThreeElements['group'], 'ref'> & { ref?: Ref<Group> };

/**
 * A stitched oxblood leather dice cup, mouth up, base centred on the group origin. Geometry and
 * materials are shared by every cup on the table (3 draw calls each).
 */
export function DiceCup({ ref, ...group }: DiceCupProps) {
  const p = diceCupParts();
  return (
    <group ref={ref} {...group}>
      <mesh geometry={p.outer} material={p.leather} />
      <mesh geometry={p.inner} material={p.suede} />
      <mesh geometry={p.stitches} material={p.thread} />
    </group>
  );
}

// ---------------------------------------------------------------- glow ring

let ringTex: Texture | null = null;
let discGeo: PlaneGeometry | null = null;

/** A soft brass halo on the felt (current player, matching dice). */
export function GlowDisc({
  color = '#f3c977',
  opacity = 0.7,
  radius = 0.3,
  ref,
  ...mesh
}: Omit<ThreeElements['mesh'], 'scale'> & {
  color?: string;
  opacity?: number;
  radius?: number;
  ref?: Ref<Mesh>;
}) {
  ringTex ??= softDiscTexture(64, 0.05);
  discGeo ??= new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        map: ringTex,
        color,
        transparent: true,
        depthWrite: false,
        opacity,
        toneMapped: false,
        // Light on the felt rather than paint: reads as a glow on any felt colour.
        blending: AdditiveBlending,
      }),
    [color, opacity],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh
      ref={ref}
      geometry={discGeo}
      material={material}
      renderOrder={-1}
      scale={[radius, 1, radius]}
      {...mesh}
    />
  );
}

// ---------------------------------------------------------------- dice tray

/**
 * The tray DiceReplay throws into (pass `showTray={false}` there): theme felt a shade darker than
 * the mat, narra rails with a brass cap and a tall backboard.
 */
export function DiceTray({
  tray,
  ...group
}: Omit<ThreeElements['group'], 'ref'> & { tray: TraySpec }) {
  const feltColor = useTheme((s) => s.theme.feltColor);
  const floorColor = useMemo(() => new Color(feltColor).multiplyScalar(0.72), [feltColor]);
  const felt = useMemo(() => {
    const t = feltTexture(128);
    t.repeat.set(tray.width * 2, tray.depth * 2);
    return t;
  }, [tray.width, tray.depth]);
  useEffect(() => () => felt.dispose(), [felt]);
  const t = 0.07;
  const cap = 0.012;
  const w = tray.width;
  const d = tray.depth;
  // [x, z, sizeX, height, sizeZ]: near rail, backboard, side rails (inner faces on the tray edge).
  const rails: [number, number, number, number, number][] = [
    [0, d / 2 + t / 2, w + 2 * t, tray.wallHeight, t],
    [0, -d / 2 - t / 2, w + 2 * t, tray.backHeight, t],
    [w / 2 + t / 2, 0, t, tray.wallHeight, d],
    [-w / 2 - t / 2, 0, t, tray.wallHeight, d],
  ];
  return (
    <group {...group}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={floorColor} map={felt} roughness={1} envMapIntensity={0.2} />
      </mesh>
      {rails.map(([x, z, sx, h, sz], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position-y={h / 2} material={narraMaterial()}>
            <boxGeometry args={[sx, h, sz]} />
          </mesh>
          <mesh position-y={h + cap / 2} material={brassMaterial()}>
            <boxGeometry args={[sx + 0.004, cap, sz + 0.004]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
