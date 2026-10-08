import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LatheGeometry,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  Vector2,
  type Material,
} from 'three';
import { ContactShadows } from '@react-three/drei';
import type { Tier } from '@/store/settings';
import { TIER_SPEC } from '../stageStore';
import { softDiscTexture, woodTextures } from '../proceduralTextures';
import { BarLightformers } from './BarLightformers';
import { FeltMat } from './FeltMat';

const TABLE_W = 5.4;
const TABLE_D = 3.8;
const FELT_W = 3.1;
const FELT_D = 2.3;
const FLOOR_Y = -0.8;
/** Back counter and wall sit in the band a portrait camera sees above the table's far edge. */
const BAR_Z = -3.0;
const BAR_TOP = -0.3;
const WALL_Z = -3.65;

/** Bottle silhouettes: radius/height profiles for LatheGeometry. */
const PROFILES: Record<'beer' | 'gin' | 'long' | 'shot', [number, number][]> = {
  beer: [
    [0, 0],
    [0.11, 0],
    [0.12, 0.02],
    [0.12, 0.5],
    [0.105, 0.6],
    [0.05, 0.74],
    [0.04, 0.86],
    [0.042, 0.92],
    [0.04, 0.93],
    [0, 0.93],
  ],
  gin: [
    [0, 0],
    [0.15, 0],
    [0.16, 0.03],
    [0.16, 0.42],
    [0.12, 0.5],
    [0.05, 0.56],
    [0.045, 0.68],
    [0, 0.68],
  ],
  long: [
    [0, 0],
    [0.1, 0],
    [0.105, 0.03],
    [0.1, 0.62],
    [0.06, 0.76],
    [0.035, 0.84],
    [0.035, 1.05],
    [0, 1.05],
  ],
  shot: [
    [0, 0],
    [0.07, 0],
    [0.075, 0.02],
    [0.09, 0.2],
    [0.083, 0.2],
    [0.068, 0.035],
    [0, 0.035],
  ],
};

const lathe = (key: keyof typeof PROFILES, segments: number) =>
  new LatheGeometry(
    PROFILES[key].map(([x, y]) => new Vector2(x, y)),
    segments,
  );

const SHELF_BOTTLES: { kind: 'beer' | 'gin' | 'long'; x: number; color: string; s: number }[] = [
  { kind: 'long', x: -2.6, color: '#3d5b2a', s: 1 },
  { kind: 'gin', x: -2.05, color: '#b9c9c4', s: 1.05 },
  { kind: 'beer', x: -1.55, color: '#6b3a12', s: 1 },
  { kind: 'beer', x: -1.25, color: '#6b3a12', s: 1 },
  { kind: 'long', x: -0.6, color: '#5a1d1d', s: 1.1 },
  { kind: 'gin', x: 0.1, color: '#c9d6d2', s: 1 },
  { kind: 'long', x: 0.75, color: '#2b4d35', s: 0.95 },
  { kind: 'beer', x: 1.3, color: '#6b3a12', s: 1 },
  { kind: 'gin', x: 1.85, color: '#9fb8b2', s: 1.1 },
  { kind: 'long', x: 2.5, color: '#4a2a10', s: 1.05 },
];

function glassMaterial(color: string, tier: Tier): Material {
  if (TIER_SPEC[tier].glass) {
    return new MeshPhysicalMaterial({
      color,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.6,
    });
  }
  if (tier === 'mid')
    return new MeshStandardMaterial({ color, roughness: 0.18, envMapIntensity: 1.3 });
  return new MeshLambertMaterial({ color });
}

/** Out-of-focus bar lights behind the table: one Points draw call, additive. */
function Bokeh() {
  const { geometry, map } = useMemo(() => {
    const g = new BufferGeometry();
    const pos: number[] = [];
    const col: number[] = [];
    const palette = ['#ffb347', '#ff7b39', '#ffd27a', '#ff4d7a', '#4fc3d9'];
    const c = new Color();
    for (let i = 0; i < 26; i++) {
      // Deterministic scatter (no Math.random so the bar looks the same every visit).
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const r = a - Math.floor(a);
      const b = Math.sin(i * 78.233) * 12543.123;
      const q = b - Math.floor(b);
      pos.push(-4.2 + r * 8.4, -0.3 + q * 1.15, -3.42 - ((i * 7) % 5) * 0.05);
      c.set(palette[i % palette.length] as string);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    return { geometry: g, map: softDiscTexture(64, 0.35) };
  }, []);
  useEffect(
    () => () => {
      geometry.dispose();
      map.dispose();
    },
    [geometry, map],
  );
  return (
    <points geometry={geometry}>
      <pointsMaterial
        map={map}
        size={0.42}
        vertexColors
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={AdditiveBlending}
        fog={false}
        toneMapped={false}
      />
    </points>
  );
}

/**
 * Procedural "dive bar" ('procedural-bar', and the stand-in while the baked bar loads or if it
 * fails): procedural narra table, felt mat in the theme colour, warm pendant light,
 * a neon reflection, a blurred back bar. No external assets. ~10k triangles.
 */
export function DiveBar({ tier }: { tier: Tier }) {
  const spec = TIER_SPEC[tier];
  const texSize = tier === 'low' ? 256 : 512;

  const wood = useMemo(() => {
    const w = woodTextures(texSize);
    for (const t of [w.map, w.roughnessMap]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 8;
    }
    return w;
  }, [texSize]);
  const geoms = useMemo(() => {
    const segs = tier === 'low' ? 10 : 16;
    return {
      beer: lathe('beer', segs),
      gin: lathe('gin', segs),
      long: lathe('long', segs),
      shot: lathe('shot', tier === 'low' ? 12 : 20),
    };
  }, [tier]);
  const bottleMats = useMemo(() => SHELF_BOTTLES.map((b) => glassMaterial(b.color, tier)), [tier]);
  const propBeer = useMemo(() => glassMaterial('#5c300c', tier), [tier]);
  const propShot = useMemo(
    () =>
      spec.glass
        ? new MeshPhysicalMaterial({
            color: '#e9f2ef',
            roughness: 0.04,
            clearcoat: 1,
            transparent: true,
            opacity: 0.45,
            envMapIntensity: 2,
          })
        : new MeshStandardMaterial({
            color: '#cfd8d4',
            roughness: 0.15,
            transparent: true,
            opacity: 0.6,
          }),
    [spec.glass],
  );

  useEffect(
    () => () => {
      wood.map.dispose();
      wood.roughnessMap.dispose();
    },
    [wood],
  );
  useEffect(() => () => Object.values(geoms).forEach((g) => g.dispose()), [geoms]);
  useEffect(() => () => bottleMats.forEach((m) => m.dispose()), [bottleMats]);
  useEffect(() => () => propBeer.dispose(), [propBeer]);
  useEffect(() => () => propShot.dispose(), [propShot]);

  return (
    <group>
      <color attach="background" args={['#0a0604']} />
      <fog attach="fog" args={['#0a0604', 8, 15]} />

      {/* Lighting: warm and dim, one pendant over the table. */}
      <hemisphereLight args={['#ffd9a0', '#1a0e08', 0.32]} />
      <spotLight
        position={[0, 6.2, 0.6]}
        angle={0.44}
        penumbra={0.9}
        intensity={85}
        decay={2}
        color="#ffc98a"
      />
      <pointLight
        position={[-1.7, 0.5, -3.3]}
        color="#ff4d7a"
        intensity={3}
        distance={3.5}
        decay={2}
      />
      <pointLight
        position={[3.4, 1.2, 1.5]}
        color="#5cc8db"
        intensity={2.5}
        distance={7}
        decay={2}
      />

      <BarLightformers />

      {/* Table */}
      <mesh position={[0, -0.09, 0]}>
        <boxGeometry args={[TABLE_W, 0.18, TABLE_D]} />
        <meshStandardMaterial
          map={wood.map}
          roughnessMap={wood.roughnessMap}
          roughness={1}
          envMapIntensity={0.7}
        />
      </mesh>

      <FeltMat width={FELT_W} depth={FELT_D} />

      {/* Table props: a beer and the tagayan (the one shot glass that goes around). */}
      <mesh geometry={geoms.beer} material={propBeer} position={[-1.95, 0, -1.25]} scale={1.15} />
      <mesh geometry={geoms.shot} material={propShot} position={[1.9, 0, -1.15]} scale={1.2} />

      {spec.contactShadows && (
        <ContactShadows
          position={[0, 0.003, 0]}
          scale={[TABLE_W, TABLE_D]}
          resolution={256}
          blur={2.2}
          opacity={0.55}
          far={1.2}
          frames={1}
        />
      )}

      {/* Back bar, lost in the dark: counter, bottles, wall, a neon ring */}
      <mesh rotation-x={-Math.PI / 2} position={[0, FLOOR_Y, -2]}>
        <planeGeometry args={[16, 8]} />
        <meshLambertMaterial color="#120a06" />
      </mesh>
      <mesh position={[0, BAR_TOP - 0.25, BAR_Z]}>
        <boxGeometry args={[8, 0.5, 0.6]} />
        <meshStandardMaterial color="#2a170c" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.5, WALL_Z]}>
        <planeGeometry args={[14, 3.2]} />
        <meshLambertMaterial color="#1b0f08" />
      </mesh>
      <mesh position={[-1.7, 0.42, WALL_Z + 0.03]}>
        <torusGeometry args={[0.26, 0.016, 8, tier === 'low' ? 32 : 48]} />
        <meshBasicMaterial color="#ff4f7b" toneMapped={false} fog={false} />
      </mesh>
      {SHELF_BOTTLES.map((b, i) => (
        <mesh
          key={i}
          geometry={geoms[b.kind]}
          material={bottleMats[i]}
          position={[b.x, BAR_TOP, BAR_Z - 0.12 + (i % 2) * 0.14]}
          scale={b.s * 0.85}
        />
      ))}
      <Bokeh />
    </group>
  );
}
