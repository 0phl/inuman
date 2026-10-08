import { useLayoutEffect, useRef, type Ref } from 'react';
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  Euler,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
  type InstancedMesh,
  type Material,
  type Texture,
} from 'three';
import type { ThreeElements } from '@react-three/fiber';
import {
  CUP_BEER_LEVEL,
  CUP_HEIGHT,
  CUP_RIM_TUBE,
  CUP_WALL,
  cupRadiusAt,
  type Vec3,
} from '@/physics/throwConfig';
import { softDiscTexture } from '@/stage/proceduralTextures';
import { useTier } from '@/stage/stageStore';
import type { Tier } from '@/store/settings';
import { useTheme } from '@/store/theme';

// A 16 oz party cup: red outside, white inside, a rolled white rim, three fill-line ridges and the
// shoulder step, with beer at CUP_BEER_LEVEL. Dimensions come from throwConfig, the same numbers
// the Rapier colliders use (outer wall = cupRadiusAt, ±1 mm of rib detail). Origin = centre of the
// base, on the table. Geometry and materials are shared; CupInstances draws a whole rack in four
// draw calls (outer, inner, beer, shadow).

/** Fill-line ridges (heights) and the shoulder step, in world units. */
const RIDGES = [0.07, 0.105, 0.14];
const STEP_Y = 0.3;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Outer radius with the ribs: the shoulder step pulls the lower body in by ~1 mm. */
function outerRadius(y: number): number {
  let r = cupRadiusAt(y) - 0.004 * (1 - smoothstep(STEP_Y - 0.01, STEP_Y + 0.01, y));
  for (const ry of RIDGES) r += 0.0035 * Math.exp(-(((y - ry) / 0.0055) ** 2));
  return r;
}

/** The rolled rim: a tube of radius CUP_RIM_TUBE around this centre (r, y). */
const RIM_C = new Vector2(
  cupRadiusAt(CUP_HEIGHT) - CUP_WALL * 0.5 + CUP_RIM_TUBE * 0.35,
  CUP_HEIGHT - CUP_RIM_TUBE,
);
const RIM_START = -Math.PI / 3; // where the red outer wall tucks under the rim
const RIM_END = (4 * Math.PI) / 3; // where the white inner wall leaves it

function cupGeometries(tier: Tier): { outer: BufferGeometry; inner: BufferGeometry } {
  const seg = tier === 'low' ? 24 : tier === 'mid' ? 32 : 44;
  const ySteps = tier === 'low' ? 40 : 72;
  const rimEnd = new Vector2(
    RIM_C.x + Math.cos(RIM_START) * CUP_RIM_TUBE,
    RIM_C.y + Math.sin(RIM_START) * CUP_RIM_TUBE,
  );

  // Outer (red): bottom centre → foot ring → up the ribbed side to under the rim. Profile order
  // makes LatheGeometry's normals face out.
  const outer: Vector2[] = [
    new Vector2(0, 0.007),
    new Vector2(outerRadius(0) - 0.016, 0.007),
    new Vector2(outerRadius(0) - 0.008, 0.0),
    new Vector2(outerRadius(0) - 0.002, 0.002),
  ];
  for (let i = 0; i <= ySteps; i++) {
    const y = 0.006 + ((rimEnd.y - 0.006) * i) / ySteps;
    outer.push(new Vector2(i === ySteps ? rimEnd.x : outerRadius(y), y));
  }

  // Inner (white): around the rolled rim (out, over, in), down the inside, across the floor.
  const inner: Vector2[] = [];
  const rimSteps = tier === 'low' ? 8 : 14;
  for (let i = 0; i <= rimSteps; i++) {
    const a = RIM_START + ((RIM_END - RIM_START) * i) / rimSteps;
    inner.push(
      new Vector2(RIM_C.x + Math.cos(a) * CUP_RIM_TUBE, RIM_C.y + Math.sin(a) * CUP_RIM_TUBE),
    );
  }
  const floor = 0.014;
  const innerTop = RIM_C.y - CUP_RIM_TUBE * 0.9;
  const innerSteps = tier === 'low' ? 10 : 18;
  for (let i = 0; i <= innerSteps; i++) {
    const y = innerTop + ((floor - innerTop) * i) / innerSteps;
    inner.push(new Vector2(cupRadiusAt(y) - CUP_WALL, y));
  }
  inner.push(new Vector2(cupRadiusAt(floor) - CUP_WALL - 0.01, floor));
  inner.push(new Vector2(0, floor));
  return { outer: new LatheGeometry(outer, seg), inner: new LatheGeometry(inner, seg) };
}

const geoCache = new Map<Tier, { outer: BufferGeometry; inner: BufferGeometry }>();
const cupGeo = (tier: Tier) => {
  let g = geoCache.get(tier);
  if (!g) {
    g = cupGeometries(tier);
    geoCache.set(tier, g);
  }
  return g;
};

let beerGeo: CircleGeometry | null = null;
let beerTex: Texture | null = null;
let shadowGeo: PlaneGeometry | null = null;
let shadowTex: Texture | null = null;

/** Amber beer with a pale foam ring at the wall and a few bubbles. */
function beerTexture(): Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#b77a08');
  g.addColorStop(0.8, '#d9a01c');
  g.addColorStop(0.93, '#ecc255');
  g.addColorStop(1, '#faefcc');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,248,230,0.55)';
  for (let i = 0; i < 26; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rr = size * (0.2 + ((i * 0.618) % 1) * 0.24);
    ctx.beginPath();
    ctx.arc(
      size / 2 + Math.cos(a) * rr,
      size / 2 + Math.sin(a) * rr,
      0.8 + (i % 3) * 0.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const shared = () => {
  beerGeo ??= new CircleGeometry(cupRadiusAt(CUP_BEER_LEVEL) - CUP_WALL + 0.002, 28).rotateX(
    -Math.PI / 2,
  );
  beerTex ??= beerTexture();
  shadowGeo ??= new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shadowTex ??= softDiscTexture(64, 0.35);
  return { beerGeo, beerTex, shadowGeo, shadowTex };
};

const matCache = new Map<string, Material>();
function cached<M extends Material>(key: string, make: () => M): M {
  let m = matCache.get(key) as M | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/** Glossy red (theme.cupColor) plastic; a clearcoat sheen on the high tier only. */
const cupOuterMaterial = (color: string, tier: Tier): Material =>
  cached(`outer:${color}:${tier}`, () =>
    tier === 'high'
      ? new MeshPhysicalMaterial({
          color: new Color(color),
          roughness: 0.38,
          clearcoat: 0.6,
          clearcoatRoughness: 0.22,
          envMapIntensity: 1.1,
        })
      : new MeshStandardMaterial({ color: new Color(color), roughness: 0.3, envMapIntensity: 1.2 }),
  );

/** The white inside and rolled rim. */
const cupInnerMaterial = (): Material =>
  cached(
    'inner',
    () => new MeshStandardMaterial({ color: '#f3efe6', roughness: 0.42, envMapIntensity: 0.9 }),
  );

const beerMaterial = (): Material =>
  cached(
    'beer',
    () =>
      new MeshStandardMaterial({
        map: shared().beerTex,
        roughness: 0.12,
        emissive: new Color('#4a3000'),
        emissiveIntensity: 0.3,
        envMapIntensity: 1.4,
      }),
  );

const shadowMaterial = (): Material =>
  cached(
    'shadow',
    () =>
      new MeshBasicMaterial({
        color: '#000000',
        map: shared().shadowTex,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
  );

const SHADOW_SIZE = cupRadiusAt(0) * 3.1;
const SHADOW_Y = 0.0025;

export type Cup3DProps = Omit<ThreeElements['group'], 'ref'> & {
  /** Plastic colour; default theme.cupColor. */
  color?: string;
  /** Show beer inside (default true). */
  beer?: boolean;
  /** Soft contact shadow on the table (default true). */
  shadow?: boolean;
  ref?: Ref<Group>;
};

/** One party cup (origin = centre of the base). For a whole rack prefer CupInstances. */
export function Cup3D({ color, beer = true, shadow = true, ref, ...group }: Cup3DProps) {
  const themeColor = useTheme((s) => s.theme.cupColor);
  const tier = useTier() ?? 'mid';
  const g = cupGeo(tier);
  const s = shared();
  return (
    <group ref={ref} {...group}>
      <mesh geometry={g.outer} material={cupOuterMaterial(color ?? themeColor, tier)} />
      <mesh geometry={g.inner} material={cupInnerMaterial()} />
      {beer && <mesh geometry={s.beerGeo} material={beerMaterial()} position-y={CUP_BEER_LEVEL} />}
      {shadow && (
        <mesh
          geometry={s.shadowGeo}
          material={shadowMaterial()}
          position-y={SHADOW_Y}
          scale={SHADOW_SIZE}
          renderOrder={-1}
        />
      )}
    </group>
  );
}

export interface CupInstance {
  /** Centre of the base (world units, relative to the parent group). */
  position: Vec3;
  /** Uniform scale (0 hides it); default 1. */
  scale?: number;
  /** Turn about the vertical (radians). */
  rotationY?: number;
  /** Extra tilt (radians) about X then Z, e.g. a knocked or removed cup. */
  tilt?: readonly [number, number];
}

export type CupInstancesProps = Omit<ThreeElements['group'], 'ref'> & {
  cups: readonly CupInstance[];
  color?: string;
  beer?: boolean;
  shadow?: boolean;
  ref?: Ref<Group>;
};

const _m = new Matrix4();
const _beer = new Matrix4().makeTranslation(0, CUP_BEER_LEVEL, 0);
const _mb = new Matrix4();
const _q = new Quaternion();
const _flat = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _e = new Euler();

/**
 * A rack of cups as instanced meshes: four draw calls however many cups. Re-renders with a new
 * `cups` array update every matrix (cheap: ≤ 20 cups).
 */
export function CupInstances({
  cups,
  color,
  beer = true,
  shadow = true,
  ref,
  ...group
}: CupInstancesProps) {
  const themeColor = useTheme((s) => s.theme.cupColor);
  const tier = useTier() ?? 'mid';
  const g = cupGeo(tier);
  const s = shared();
  const outer = useRef<InstancedMesh>(null);
  const inner = useRef<InstancedMesh>(null);
  const beerRef = useRef<InstancedMesh>(null);
  const shadowRef = useRef<InstancedMesh>(null);
  // Room for two full racks, so hits and re-racks never remount the meshes.
  const capacity = Math.max(24, cups.length);

  useLayoutEffect(() => {
    cups.forEach((c, i) => {
      const k = c.scale ?? 1;
      _e.set(c.tilt?.[0] ?? 0, c.rotationY ?? 0, c.tilt?.[1] ?? 0);
      _q.setFromEuler(_e);
      _p.set(c.position[0], c.position[1], c.position[2]);
      _s.setScalar(k);
      _m.compose(_p, _q, _s);
      outer.current?.setMatrixAt(i, _m);
      inner.current?.setMatrixAt(i, _m);
      beerRef.current?.setMatrixAt(i, _mb.multiplyMatrices(_m, _beer));
      _p.set(c.position[0], SHADOW_Y, c.position[2]);
      _s.setScalar(SHADOW_SIZE * k);
      _m.compose(_p, _flat, _s);
      shadowRef.current?.setMatrixAt(i, _m);
    });
    for (const mesh of [outer.current, inner.current, beerRef.current, shadowRef.current]) {
      if (!mesh) continue;
      mesh.count = cups.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [cups, capacity]);

  return (
    <group ref={ref} {...group}>
      <instancedMesh
        key={`o${capacity}`}
        ref={outer}
        args={[g.outer, cupOuterMaterial(color ?? themeColor, tier), capacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`i${capacity}`}
        ref={inner}
        args={[g.inner, cupInnerMaterial(), capacity]}
        frustumCulled={false}
      />
      {beer && (
        <instancedMesh
          key={`b${capacity}`}
          ref={beerRef}
          args={[s.beerGeo, beerMaterial(), capacity]}
          frustumCulled={false}
        />
      )}
      {shadow && (
        <instancedMesh
          key={`s${capacity}`}
          ref={shadowRef}
          args={[s.shadowGeo, shadowMaterial(), capacity]}
          renderOrder={-1}
          frustumCulled={false}
        />
      )}
    </group>
  );
}
