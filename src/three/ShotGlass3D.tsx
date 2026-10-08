import type { Ref } from 'react';
import {
  BackSide,
  Color,
  FrontSide,
  LatheGeometry,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
  Vector2,
  type BufferGeometry,
  type Group,
  type Material,
  type Texture,
} from 'three';
import type { ThreeElements } from '@react-three/fiber';
import { GLASS_BASE, GLASS_HEIGHT, GLASS_WALL, glassRadiusAt } from '@/physics/throwConfig';
import { softDiscTexture } from '@/stage/proceduralTextures';
import { TIER_SPEC, useTier } from '@/stage/stageStore';
import type { Tier } from '@/store/settings';

// A heavy-based 2 oz shot glass, the quarters target. One closed lathe (outer wall, rounded rim,
// inner wall, inner floor, base) built from the same numbers as its Rapier colliders. Tiers with
// TIER_SPEC.glass (high) get real transmission (MeshPhysicalMaterial); low/mid get a cheap fake: a back-face pass
// and a front-face pass of a glossy, mostly transparent material, which also makes the thick base
// read denser. Origin = centre of the base, on the table.

const RIM_R = GLASS_WALL / 2;

function glassProfile(): Vector2[] {
  const pts: Vector2[] = [];
  // Base underside: centre → bevelled outer edge (normals down, then out).
  const r0 = glassRadiusAt(0);
  pts.push(new Vector2(0, 0.001), new Vector2(r0 - 0.006, 0.001), new Vector2(r0 - 0.001, 0.004));
  // Outer wall up to the rim.
  const top = GLASS_HEIGHT - RIM_R;
  for (let i = 0; i <= 12; i++) {
    const y = 0.008 + ((top - 0.008) * i) / 12;
    pts.push(new Vector2(glassRadiusAt(y), y));
  }
  // Rounded rim: half circle over the top, outer → inner.
  const rc = glassRadiusAt(GLASS_HEIGHT) - RIM_R;
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    pts.push(new Vector2(rc + Math.cos(a) * RIM_R, top + Math.sin(a) * RIM_R));
  }
  // Inner wall down to the floor of the thick base, then across to the centre (normals in, up).
  for (let i = 0; i <= 10; i++) {
    const y = top - ((top - GLASS_BASE - 0.006) * i) / 10;
    pts.push(new Vector2(glassRadiusAt(y) - GLASS_WALL, y));
  }
  const rf = glassRadiusAt(GLASS_BASE) - GLASS_WALL;
  pts.push(new Vector2(rf - 0.004, GLASS_BASE), new Vector2(0, GLASS_BASE));
  return pts;
}

/** The liquid (if any): a lathe filling the inside from the floor up to `level`. */
function liquidGeometry(level: number): BufferGeometry {
  const pts: Vector2[] = [new Vector2(0, GLASS_BASE + 0.001)];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const y = GLASS_BASE + 0.001 + ((level - GLASS_BASE - 0.001) * i) / steps;
    pts.push(new Vector2(glassRadiusAt(y) - GLASS_WALL - 0.002, y));
  }
  pts.push(new Vector2(0, level));
  return new LatheGeometry(pts, 32);
}

const geoCache = new Map<Tier, BufferGeometry>();
function glassGeometry(tier: Tier): BufferGeometry {
  let g = geoCache.get(tier);
  if (!g) {
    g = new LatheGeometry(glassProfile(), tier === 'low' ? 24 : tier === 'mid' ? 36 : 48);
    geoCache.set(tier, g);
  }
  return g;
}

const matCache = new Map<string, Material>();
function cached<M extends Material>(key: string, make: () => M): M {
  let m = matCache.get(key) as M | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/** High tier: real refraction. */
const transmissive = () =>
  cached(
    'glass:tx',
    () =>
      new MeshPhysicalMaterial({
        color: '#ffffff',
        transmission: 1,
        thickness: 0.06,
        roughness: 0.03,
        ior: 1.5,
        attenuationColor: new Color('#cfeee4'),
        attenuationDistance: 0.35,
        specularIntensity: 1,
        envMapIntensity: 1.4,
      }),
  );

/** Low/mid: the cheap fake (two passes of a glossy see-through material). */
const fake = (side: 'back' | 'front') =>
  cached(
    `glass:fake:${side}`,
    () =>
      new MeshStandardMaterial({
        color: side === 'back' ? '#d2e6e2' : '#f6fcfc',
        transparent: true,
        opacity: side === 'back' ? 0.09 : 0.15,
        roughness: 0.05,
        metalness: 0.1,
        envMapIntensity: 2.6,
        depthWrite: false,
        side: side === 'back' ? BackSide : FrontSide,
      }),
  );

const liquidMat = () =>
  cached(
    'glass:liquid',
    () =>
      new MeshStandardMaterial({
        color: '#c9781a',
        transparent: true,
        opacity: 0.78,
        roughness: 0.1,
        emissive: new Color('#4a2200'),
        emissiveIntensity: 0.4,
        depthWrite: false,
      }),
  );

/** Low/mid: a thin bright line on the rim, the cue that sells a cheap glass as glass. */
const rimMat = () =>
  cached(
    'glass:rim',
    () =>
      new MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
  );
let rimGeo: TorusGeometry | null = null;

let shadowGeo: PlaneGeometry | null = null;
let shadowTex: Texture | null = null;
const shadowMat = () => {
  shadowTex ??= softDiscTexture(64, 0.4);
  return cached(
    'glass:shadow',
    () =>
      new MeshBasicMaterial({
        color: '#000000',
        map: shadowTex,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
  );
};

const liquidCache = new Map<number, BufferGeometry>();

export type ShotGlass3DProps = Omit<ThreeElements['group'], 'ref'> & {
  /** 0 … 1 of the inside filled with liquor (default 0: empty, as for quarters). */
  fill?: number;
  /** Soft contact shadow (default true). */
  shadow?: boolean;
  ref?: Ref<Group>;
};

export function ShotGlass3D({ fill = 0, shadow = true, ref, ...group }: ShotGlass3DProps) {
  const tier = useTier() ?? 'mid';
  const g = glassGeometry(tier);
  shadowGeo ??= new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const level = Math.round(Math.min(1, Math.max(0, fill)) * 20) / 20;
  let liquid: BufferGeometry | null = null;
  if (level > 0) {
    liquid = liquidCache.get(level) ?? null;
    if (!liquid) {
      liquid = liquidGeometry(GLASS_BASE + (GLASS_HEIGHT - GLASS_BASE - 0.02) * level);
      liquidCache.set(level, liquid);
    }
  }
  return (
    <group ref={ref} {...group}>
      {shadow && (
        <mesh
          geometry={shadowGeo}
          material={shadowMat()}
          position-y={0.0025}
          scale={glassRadiusAt(0) * 3}
          renderOrder={-1}
        />
      )}
      {liquid && <mesh geometry={liquid} material={liquidMat()} renderOrder={1} />}
      {TIER_SPEC[tier].glass ? (
        <mesh geometry={g} material={transmissive()} />
      ) : (
        <>
          <mesh geometry={g} material={fake('back')} renderOrder={2} />
          <mesh geometry={g} material={fake('front')} renderOrder={3} />
          <mesh
            geometry={
              (rimGeo ??= new TorusGeometry(
                glassRadiusAt(GLASS_HEIGHT) - RIM_R,
                RIM_R * 0.9,
                6,
                tier === 'low' ? 24 : 40,
              ).rotateX(Math.PI / 2))
            }
            material={rimMat()}
            position-y={GLASS_HEIGHT - RIM_R}
            renderOrder={4}
          />
        </>
      )}
    </group>
  );
}
