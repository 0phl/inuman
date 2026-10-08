import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  CanvasTexture,
  Color,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type InstancedMesh,
  type Texture,
} from 'three';
import { useThree, type ThreeElements } from '@react-three/fiber';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import { CUP_HEIGHT, CUP_RIM_TUBE, CUP_WALL, cupRadiusAt } from '@/physics/throwConfig';
import { CupInstances, type CupInstance } from '@/three/Cup3D';
import { brassMaterial } from '../mexico/dice3d';
import { TEAM_COLORS } from './layout';
import { useThrowBus } from './throwBus';

// Scene pieces shared by the skill games. Team dressing for the party cups (Beer Pong racks, Flip
// Cup rows): a team-coloured rolled rim over the cup's white one, and a team name plaque; cup
// bodies keep theme.cupColor. Plus the camera probe the Huds map gestures with. Three-only; the
// HUDs never import this.

/** The rolled rim's tube centre (matches Cup3D's RIM_C) and a slightly fatter tube over it. */
const RIM_R = cupRadiusAt(CUP_HEIGHT) - CUP_WALL * 0.5 + CUP_RIM_TUBE * 0.35;
const RIM_Y = CUP_HEIGHT - CUP_RIM_TUBE;
const RIM_TUBE = CUP_RIM_TUBE * 1.22;

let rimGeo: TorusGeometry | null = null;
const rimMaterials = new Map<TeamIndex, MeshStandardMaterial>();

function rimMaterial(team: TeamIndex): MeshStandardMaterial {
  let m = rimMaterials.get(team);
  if (!m) {
    const c = TEAM_COLORS[team];
    m = new MeshStandardMaterial({
      color: new Color(c.rim),
      roughness: 0.4,
      emissive: new Color(c.emissive),
      emissiveIntensity: 0.7,
      envMapIntensity: 0.8,
    });
    rimMaterials.set(team, m);
  }
  return m;
}

const _m = new Matrix4();
const _rim = new Matrix4().makeTranslation(0, RIM_Y, 0);
const _out = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _e = new Euler();

export type TeamCupsProps = Omit<ThreeElements['group'], 'ref'> & {
  team: TeamIndex;
  cups: readonly CupInstance[];
  beer?: boolean;
  shadow?: boolean;
};

/** A team's cups (CupInstances) with team-coloured rims: five draw calls however many cups. */
export function TeamCups({ team, cups, beer = true, shadow = true, ...group }: TeamCupsProps) {
  const rims = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  rimGeo ??= new TorusGeometry(RIM_R, RIM_TUBE, 8, 40).rotateX(Math.PI / 2);
  const capacity = Math.max(24, cups.length);

  useLayoutEffect(() => {
    const mesh = rims.current;
    if (!mesh) return;
    cups.forEach((c, i) => {
      _e.set(c.tilt?.[0] ?? 0, c.rotationY ?? 0, c.tilt?.[1] ?? 0);
      _q.setFromEuler(_e);
      _p.set(c.position[0], c.position[1], c.position[2]);
      _s.setScalar(c.scale ?? 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _out.multiplyMatrices(_m, _rim));
    });
    mesh.count = cups.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [cups, capacity, invalidate]);

  return (
    <group {...group}>
      <CupInstances cups={cups} beer={beer} shadow={shadow} />
      <instancedMesh
        key={capacity}
        ref={rims}
        args={[rimGeo, rimMaterial(team), capacity]}
        frustumCulled={false}
      />
    </group>
  );
}

/** One team rim for a single Cup3D (same origin: the centre of the cup's base). */
export function TeamRim({ team }: { team: TeamIndex }) {
  rimGeo ??= new TorusGeometry(RIM_R, RIM_TUBE, 8, 40).rotateX(Math.PI / 2);
  return <mesh geometry={rimGeo} material={rimMaterial(team)} position-y={RIM_Y} />;
}

// ---------------------------------------------------------------- camera

/** Hands the live R3F camera to the Hud (flick → world mapping, Flip Cup's hit zone). */
export function CameraProbe() {
  const camera = useThree((s) => s.camera);
  const setCamera = useThrowBus((s) => s.setCamera);
  useEffect(() => {
    setCamera(camera as unknown as Parameters<typeof setCamera>[0]);
    return () => setCamera(null);
  }, [camera, setCamera]);
  return null;
}

// ---------------------------------------------------------------- plaque

const SIGN_FONT = "Bungee, 'Arial Black', 'Helvetica Neue', sans-serif";

const PLATE = [
  { top: '#ef6a4f', bottom: '#9e2814', rim: '#f3c977', ink: '#fff6e6', drop: '#4a1208' },
  { top: '#5b98f0', bottom: '#1b3f96', rim: '#f3c977', ink: '#f2f7ff', drop: '#0b1a44' },
] as const;

function drawPlate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  team: TeamIndex,
) {
  const c = PLATE[team];
  ctx.clearRect(0, 0, w, h);
  const plate = new Path2D();
  plate.roundRect(4, 4, w - 8, h - 8, 26);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, c.top);
  g.addColorStop(1, c.bottom);
  ctx.fillStyle = g;
  ctx.fill(plate);
  ctx.lineWidth = 6;
  ctx.strokeStyle = c.rim;
  ctx.stroke(plate);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(243,201,119,0.4)';
  const inner = new Path2D();
  inner.roundRect(15, 15, w - 30, h - 30, 18);
  ctx.stroke(inner);

  let size = 64;
  const label = text.toUpperCase();
  ctx.font = `400 ${size}px ${SIGN_FONT}`;
  while (ctx.measureText(label).width > w - 64 && size > 24) {
    size -= 2;
    ctx.font = `400 ${size}px ${SIGN_FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.drop;
  ctx.fillText(label, w / 2 + 4, h / 2 + 7);
  ctx.fillStyle = c.ink;
  ctx.fillText(label, w / 2, h / 2 + 3);
}

/** A 512 × 128 team plaque texture. The caller owns it (dispose when the text changes). */
function teamPlateTexture(text: string, team: TeamIndex, onRedraw?: () => void): Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) drawPlate(ctx, c.width, c.height, text, team);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  if (ctx && typeof document !== 'undefined' && document.fonts?.load) {
    void document.fonts.load('64px Bungee').then(() => {
      drawPlate(ctx, c.width, c.height, text, team);
      tex.needsUpdate = true;
      onRedraw?.();
    });
  }
  return tex;
}

/** Leans the plaque back from upright so it faces the fixed camera (~46° above the table). */
const LEAN = 0.72;
let plateGeo: PlaneGeometry | null = null;

export type TeamPlaqueProps = Omit<ThreeElements['group'], 'ref'> & {
  text: string;
  team: TeamIndex;
  /** Plaque width (world units); its height is a quarter of that. */
  width?: number;
};

/** A team name plaque on a thin brass foot, tilted toward the players. */
export function TeamPlaque({ text, team, width = 0.6, ...group }: TeamPlaqueProps) {
  const invalidate = useThree((s) => s.invalidate);
  const tex = useMemo(() => teamPlateTexture(text, team, invalidate), [text, team, invalidate]);
  useEffect(() => () => tex.dispose(), [tex]);
  useEffect(() => invalidate(), [tex, invalidate]);
  plateGeo ??= new PlaneGeometry(1, 0.25);
  const h = width / 4;
  return (
    <group {...group}>
      <mesh
        material={brassMaterial()}
        position={[0, 0.007, 0.004]}
        scale={[width * 0.94, 0.014, 0.05]}
      >
        <boxGeometry />
      </mesh>
      <mesh
        geometry={plateGeo}
        rotation-x={-Math.PI / 2 + LEAN}
        position={[0, 0.32 * h + 0.006, 0]}
        scale={width}
      >
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
