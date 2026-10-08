import { useEffect, useEffectEvent, useMemo, useRef, type Ref } from 'react';
import {
  Color,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Group,
  type Mesh,
  type Texture,
} from 'three';
import { useFrame, useThree, type ThreeElements } from '@react-three/fiber';
import { IDENTITY, remap, type Face, type Quat } from '@/core/primitives/dice';
import { feltTexture, softDiscTexture } from '@/stage/proceduralTextures';
import { useTheme } from '@/store/theme';
import { Die3D } from '@/three/Die3D';
import { DEFAULT_TRAY, DIE_SIZE, FRAME_STRIDE, type TraySpec } from './diceConfig';
import { loadPresim, preloadDicePhysics } from './loadPresim';
// Types only: the Rapier chunk is loaded on demand through loadPresim().
import type { DiePose, PresimResult } from './presim';

export interface DiceSettleResult {
  rollId: number;
  /** Face showing on top of every die, by index (equals `targets` for the dice that rolled). */
  faces: (Face | null)[];
  /** Indices of the dice thrown in this roll (the others stayed put). */
  rolled: number[];
  /** Physically landed face per die index before remapping (null for dice that didn't roll). */
  landed: (Face | null)[];
  /** True where a rolled die still leans after the presim's retries (it still shows its target). */
  cocked: boolean[];
  /** Presim attempts and time (0 when physics was unavailable and dice were placed directly). */
  attempts: number;
  presimMs: number;
}

export type DiceReplayProps = Omit<ThreeElements['group'], 'ref'> & {
  /** Face each die must end on, from the reducer's RNG. Its length is the number of dice. */
  targets: readonly Face[];
  /** Change it to throw. The first value seen on mount throws too. */
  rollId: number;
  /** Called exactly once per rollId, after the last frame is shown. */
  onSettled?: (result: DiceSettleResult) => void;
  tray?: TraySpec;
  /** Dice material id (theme.diceMaterialId): 'ivory' | 'red-casino' | 'wood'. */
  theme?: string;
  /** Only these dice are thrown; the others keep their pose and face. Default: all. */
  indices?: readonly number[];
  /** Skip the animation and show the settled dice at once. Default: prefers-reduced-motion. */
  instant?: boolean;
  /** Draw the tray's felt and wooden rim (default true). */
  showTray?: boolean;
  ref?: Ref<Group>;
};

interface DieSlot {
  placed: boolean;
  p: [number, number, number];
  q: [number, number, number, number];
  /** Extra local rotation of the visual mesh inside the (symmetric) physics body. */
  visual: Quat;
  face: Face | null;
}

interface Playback {
  frames: Float32Array;
  steps: number;
  dt: number;
  rolled: number[];
  /** performance.now() seconds of the first shown frame; -1 until then. */
  start: number;
  result: DiceSettleResult;
}

const DT = 1 / 60;
const HALF = DIE_SIZE / 2;
const SHADOW_Y = 0.004;

const newSlot = (): DieSlot => ({
  placed: false,
  p: [0, HALF, 0],
  q: [0, 0, 0, 1],
  visual: IDENTITY,
  face: null,
});

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

let shadowGeometry: PlaneGeometry | null = null;
let shadowTexture: Texture | null = null;
const sharedShadow = () => {
  shadowGeometry ??= new PlaneGeometry(DIE_SIZE * 2, DIE_SIZE * 2).rotateX(-Math.PI / 2);
  shadowTexture ??= softDiscTexture(64, 0.3);
  return { geometry: shadowGeometry, map: shadowTexture };
};

/** Physics unavailable (WASM failed): place the dice in a row, 1 up, so the game never stalls. */
function placedWithoutThrow(count: number, tray: TraySpec): PresimResult {
  const frames = new Float32Array(count * FRAME_STRIDE);
  const gap = Math.min(DIE_SIZE * 1.6, (tray.width - DIE_SIZE) / Math.max(count, 1));
  for (let i = 0; i < count; i++) {
    frames.set([(i - (count - 1) / 2) * gap, HALF, 0, 0, 0, 0, 1], i * FRAME_STRIDE);
  }
  return {
    frames,
    steps: 1,
    landed: Array<Face>(count).fill(1),
    cocked: Array<boolean>(count).fill(false),
    attempts: 0,
    rejected: [],
    ms: 0,
  };
}

/** The tray: felt a shade darker than the table's, a low wooden rim and a taller backboard. */
function TrayModel({ tray }: { tray: TraySpec }) {
  const feltColor = useTheme((s) => s.theme.feltColor);
  const floorColor = useMemo(() => new Color(feltColor).multiplyScalar(0.72), [feltColor]);
  const felt = useMemo(() => {
    const t = feltTexture(128);
    t.repeat.set(tray.width * 2, tray.depth * 2);
    return t;
  }, [tray.width, tray.depth]);
  useEffect(() => () => felt.dispose(), [felt]);
  const wood = useMemo(
    () => new MeshStandardMaterial({ color: '#4a2614', roughness: 0.42, envMapIntensity: 0.8 }),
    [],
  );
  useEffect(() => () => wood.dispose(), [wood]);
  const t = 0.07;
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
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={floorColor} map={felt} roughness={1} envMapIntensity={0.2} />
      </mesh>
      {rails.map(([x, z, sx, h, sz], i) => (
        <mesh key={i} position={[x, h / 2, z]} material={wood}>
          <boxGeometry args={[sx, h, sz]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Outcome-first physical dice. On every new `rollId` it pre-simulates a throw headlessly (Rapier,
 * lazily loaded), then replays the recording at real time. Each die's visual mesh sits inside the
 * recorded body with an extra rotation remap(landed, target), so `targets` always ends up on top.
 */
export function DiceReplay({
  targets,
  rollId,
  onSettled,
  tray = DEFAULT_TRAY,
  theme,
  indices,
  instant,
  showTray = true,
  ref,
  ...group
}: DiceReplayProps) {
  const invalidate = useThree((s) => s.invalidate);
  const slots = useRef<DieSlot[]>([]);
  const bodies = useRef<(Group | null)[]>([]);
  const visuals = useRef<(Mesh | null)[]>([]);
  const shadows = useRef<(Mesh | null)[]>([]);
  const playback = useRef<Playback | null>(null);
  const seq = useRef(0);
  const alive = useRef(false);
  const settled = useRef(onSettled);
  const shadow = sharedShadow();

  useEffect(() => {
    settled.current = onSettled;
  });

  useEffect(() => {
    alive.current = true;
    preloadDicePhysics();
    return () => {
      alive.current = false;
    };
  }, []);

  const slot = (i: number): DieSlot => {
    slots.current[i] ??= newSlot();
    return slots.current[i];
  };

  const applyPose = (i: number) => {
    const s = slot(i);
    const body = bodies.current[i];
    if (body) {
      body.position.set(s.p[0], s.p[1], s.p[2]);
      body.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
      body.visible = s.placed;
    }
    const sh = shadows.current[i];
    if (sh) {
      const lift = Math.max(0, s.p[1] - HALF);
      sh.visible = s.placed;
      sh.position.set(s.p[0], SHADOW_Y, s.p[2]);
      sh.scale.setScalar(1 + lift * 0.9);
      (sh.material as MeshBasicMaterial).opacity =
        0.55 * Math.min(1, Math.max(0.12, 1 - lift * 1.4));
    }
  };

  /** Writes frame f0 (blended toward f0 + 1 by `a`) of the playback into the rolled dice. */
  const showFrame = (pb: Playback, f0: number, a: number) => {
    const stride = pb.rolled.length * FRAME_STRIDE;
    const f1 = Math.min(f0 + 1, pb.steps - 1);
    const fr = pb.frames;
    pb.rolled.forEach((die, k) => {
      const o0 = f0 * stride + k * FRAME_STRIDE;
      const o1 = f1 * stride + k * FRAME_STRIDE;
      const at = (j: number) => (fr[o0 + j] ?? 0) + ((fr[o1 + j] ?? 0) - (fr[o0 + j] ?? 0)) * a;
      // Quaternion nlerp along the shorter arc (frames are 1/60 s apart, so this is plenty).
      const dot =
        (fr[o0 + 3] ?? 0) * (fr[o1 + 3] ?? 0) +
        (fr[o0 + 4] ?? 0) * (fr[o1 + 4] ?? 0) +
        (fr[o0 + 5] ?? 0) * (fr[o1 + 5] ?? 0) +
        (fr[o0 + 6] ?? 1) * (fr[o1 + 6] ?? 1);
      const sign = dot < 0 ? -1 : 1;
      const qa = (j: number) => (fr[o0 + j] ?? 0) * (1 - a) + sign * (fr[o1 + j] ?? 0) * a;
      const qx = qa(3);
      const qy = qa(4);
      const qz = qa(5);
      const qw = qa(6);
      const n = Math.hypot(qx, qy, qz, qw) || 1;
      const s = slot(die);
      s.placed = true;
      s.p = [at(0), at(1), at(2)];
      s.q = [qx / n, qy / n, qz / n, qw / n];
      applyPose(die);
    });
  };

  /** Shows the final frame, commits it, and (unless superseded) reports the roll. */
  const finish = (notify: boolean) => {
    const pb = playback.current;
    if (!pb) return;
    playback.current = null;
    showFrame(pb, pb.steps - 1, 0);
    if (notify) settled.current?.(pb.result);
  };

  const begin = (id: number, rolled: number[], goal: Face[], res: PresimResult, jump: boolean) => {
    const n = slots.current.length;
    const landed: (Face | null)[] = Array<Face | null>(n).fill(null);
    const cocked: boolean[] = Array<boolean>(n).fill(false);
    rolled.forEach((die, k) => {
      const s = slot(die);
      const from = res.landed[k] ?? 1;
      const to = goal[k] ?? from;
      s.visual = remap(from, to);
      s.face = to;
      landed[die] = from;
      cocked[die] = res.cocked[k] ?? false;
      const v = visuals.current[die];
      if (v) v.quaternion.set(s.visual[0], s.visual[1], s.visual[2], s.visual[3]);
    });
    playback.current = {
      frames: res.frames,
      steps: res.steps,
      dt: DT,
      rolled,
      start: -1,
      result: {
        rollId: id,
        faces: slots.current.map((s) => s.face),
        rolled,
        landed,
        cocked,
        attempts: res.attempts,
        presimMs: res.ms,
      },
    };
    if (jump) finish(true);
    invalidate();
  };

  const startRoll = useEffectEvent((id: number) => {
    finish(false); // a throw still in the air lands instantly, unreported
    const n = targets.length;
    slots.current = Array.from({ length: n }, (_, i) => slots.current[i] ?? newSlot());
    const wanted = indices ? new Set(indices) : null;
    const all = targets.map((_, i) => i);
    // A die that has never been placed has to be thrown, whatever `indices` says.
    const rolled = all.filter((i) => !wanted || wanted.has(i) || !slot(i).placed);
    const obstacles: DiePose[] = all
      .filter((i) => !rolled.includes(i))
      .map((i) => ({ p: slot(i).p, q: slot(i).q }));
    const goal = rolled.map((i) => targets[i] as Face);
    const token = ++seq.current;
    const jump = instant ?? prefersReducedMotion();
    if (rolled.length === 0) {
      begin(id, [], [], placedWithoutThrow(0, tray), true);
      return;
    }
    const seed = (Math.imul(id, 2654435761) ^ Date.now()) >>> 0;
    loadPresim()
      .then((m) => m.presimulateThrow({ count: rolled.length, throwSeed: seed, tray, obstacles }))
      .then(
        (res) => {
          if (alive.current && token === seq.current) begin(id, rolled, goal, res, jump);
        },
        (err: unknown) => {
          if (!alive.current || token !== seq.current) return;
          console.warn('[dice] physics unavailable; placing dice without a throw', err);
          begin(id, rolled, goal, placedWithoutThrow(rolled.length, tray), true);
        },
      );
  });

  useEffect(() => {
    startRoll(rollId);
  }, [rollId]);

  useFrame((state) => {
    const pb = playback.current;
    if (!pb) return;
    const now = performance.now() / 1000;
    if (pb.start < 0) pb.start = now;
    const f = (now - pb.start) / pb.dt;
    if (f >= pb.steps - 1) {
      finish(true);
      return;
    }
    const f0 = Math.floor(f);
    showFrame(pb, f0, f - f0);
    state.invalidate();
  });

  return (
    <group ref={ref} {...group}>
      {showTray && <TrayModel tray={tray} />}
      {targets.map((_, i) => (
        <group
          key={i}
          ref={(g) => {
            bodies.current[i] = g;
            if (g) applyPose(i);
          }}
        >
          <Die3D
            materialId={theme}
            userData={{ dieIndex: i }}
            ref={(m) => {
              visuals.current[i] = m;
              const v = slot(i).visual;
              m?.quaternion.set(v[0], v[1], v[2], v[3]);
            }}
          />
        </group>
      ))}
      {targets.map((_, i) => (
        <mesh
          key={`shadow-${i}`}
          geometry={shadow.geometry}
          renderOrder={-1}
          ref={(m) => {
            shadows.current[i] = m;
            if (m) applyPose(i);
          }}
        >
          <meshBasicMaterial
            map={shadow.map}
            color="#000000"
            transparent
            depthWrite={false}
            opacity={0}
          />
        </mesh>
      ))}
    </group>
  );
}
