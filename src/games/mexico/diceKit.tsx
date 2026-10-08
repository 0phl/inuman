import { useEffect, useMemo, type Ref } from 'react';
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  LatheGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type BufferGeometry,
  type Group,
  type Mesh,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ThreeElements } from '@react-three/fiber';
import { DIE_SIZE, type TraySpec } from '@/physics/diceConfig';
import { feltTexture, softDiscTexture } from '@/stage/proceduralTextures';
import { useTheme } from '@/store/theme';
import { brassMaterial, narraMaterial } from './dice3d';

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
export const CUP_H = 0.4;
export const CUP_R_BOT = 0.15;
export const CUP_R_TOP = 0.172;
const INNER_FLOOR = 0.026;
const outerR = (y: number) => CUP_R_BOT + ((CUP_R_TOP - CUP_R_BOT) * y) / CUP_H;

interface CupParts {
  outer: BufferGeometry;
  inner: BufferGeometry;
  stitches: BufferGeometry;
  leather: MeshStandardMaterial;
  suede: MeshStandardMaterial;
  thread: MeshStandardMaterial;
}

let cupParts: CupParts | null = null;

/** Oxblood leather: mottled grain plus faint vertical creases, tiled around the cup. */
function leatherTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#8a3a1f';
    ctx.fillRect(0, 0, 256, 256);
    let s = 0x51ed27;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * 256;
      const y = rnd() * 256;
      const r = 0.6 + rnd() * 2.6;
      const dark = rnd() < 0.6;
      ctx.fillStyle = dark
        ? `rgba(40,10,4,${0.08 + rnd() * 0.14})`
        : `rgba(255,190,140,${0.03 + rnd() * 0.06})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256;
      ctx.strokeStyle = `rgba(30,8,2,${0.08 + rnd() * 0.1})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, 80, x - 6, 170, x + rnd() * 8, 256);
      ctx.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

function makeCupParts(): CupParts {
  const v = (r: number, y: number) => new Vector2(r, y);
  const outer = new LatheGeometry(
    [
      v(0.0001, 0),
      v(CUP_R_BOT - 0.012, 0),
      v(CUP_R_BOT + 0.006, 0.012),
      v(CUP_R_BOT + 0.008, 0.05),
      v(outerR(0.062), 0.062),
      v(outerR(CUP_H - 0.06), CUP_H - 0.06),
      v(outerR(CUP_H - 0.05) + 0.006, CUP_H - 0.048),
      v(CUP_R_TOP + 0.008, CUP_H - 0.008),
      v(CUP_R_TOP + 0.003, CUP_H + 0.003),
      v(CUP_R_TOP - 0.006, CUP_H + 0.003),
    ],
    40,
  );
  const inner = new LatheGeometry(
    [
      v(CUP_R_TOP - 0.006, CUP_H + 0.003),
      v(CUP_R_TOP - 0.011, CUP_H - 0.02),
      v(CUP_R_BOT - 0.012, INNER_FLOOR),
      v(0.0001, INNER_FLOOR),
    ],
    40,
  );
  // Saddle stitching: two rings of short tangential dashes, merged into one geometry.
  const dashes: BufferGeometry[] = [];
  const PER_RING = 44;
  for (const y of [0.079, CUP_H - 0.07]) {
    const r = outerR(y) + 0.0035;
    for (let i = 0; i < PER_RING; i++) {
      const a = (i / PER_RING) * Math.PI * 2;
      const d = new BoxGeometry(0.016, 0.005, 0.004);
      d.rotateY(-a + Math.PI / 2);
      d.translate(r * Math.cos(a), y, r * Math.sin(a));
      dashes.push(d);
    }
  }
  const stitches = mergeGeometries(dashes) ?? new BoxGeometry(0, 0, 0);
  dashes.forEach((d) => d.dispose());
  return {
    outer,
    inner,
    stitches,
    leather: (() => {
      const map = leatherTexture();
      return new MeshStandardMaterial({
        color: '#b8644a',
        map,
        roughness: 0.56,
        metalness: 0,
        envMapIntensity: 0.75,
        // A little of its own grain so the cup never reads as a black hole when it's lifted.
        emissive: '#ffffff',
        emissiveMap: map,
        emissiveIntensity: 0.16,
      });
    })(),
    suede: new MeshStandardMaterial({ color: '#160c08', roughness: 1, side: DoubleSide }),
    thread: new MeshStandardMaterial({ color: '#e9d7ad', roughness: 0.85 }),
  };
}

type DiceCupProps = Omit<ThreeElements['group'], 'ref'> & { ref?: Ref<Group> };

/**
 * A stitched oxblood leather dice cup, mouth up, base centred on the group origin. Geometry and
 * materials are shared by every cup on the table (3 draw calls each).
 */
export function DiceCup({ ref, ...group }: DiceCupProps) {
  cupParts ??= makeCupParts();
  const p = cupParts;
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
