import { useCallback, useEffect, useMemo, useRef, type Ref } from 'react';
import {
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type Group,
  type Mesh,
  type Texture,
} from 'three';
import { useFrame, useThree, type ThreeElements } from '@react-three/fiber';
import { throwFlight } from '@/audio/cues';
import { play, type SoundHandle } from '@/audio/engine';
import { hapticLater } from '@/audio/haptics';
import { softDiscTexture } from '@/stage/proceduralTextures';
import { Ball3D, type BallColor } from '@/three/Ball3D';
import { Coin3D } from '@/three/Coin3D';
import { preloadThrowPhysics } from './loadThrowSim';
import {
  BALL_RADIUS,
  COIN_RADIUS,
  THROW_FRAME_STRIDE,
  type ThrowKind,
  type Vec3,
} from './throwConfig';
// Types only: the Rapier chunk is loaded on demand through loadThrowSim().
import type { PresimThrowInput, PresimThrowOutput, ThrowResult } from './throwSim';

export type { ThrowReplayController } from './useThrowReplay';

/** One pre-simulated throw handed to <ThrowReplay>. A new `id` starts a new playback. */
export interface ThrowPlayback {
  id: number;
  input: PresimThrowInput;
  sim: PresimThrowOutput;
  /** Set by useThrowReplay: settles throwAndReplay's promise when the replay ends. */
  settle?: (sim: PresimThrowOutput) => void;
}

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const isMade = (r: ThrowResult): boolean => (r.kind === 'ball' ? r.hit !== null : r.made);

let shadowGeo: PlaneGeometry | null = null;
let shadowTex: Texture | null = null;

/** Seconds a missed ball/coin takes to shrink away after its replay ends. */
const MISS_FADE = 0.3;

export type ThrowReplayProps = Omit<ThreeElements['group'], 'ref'> & {
  /** What to play (from useThrowReplay, or built by hand from presimThrow). */
  playback: ThrowPlayback | null;
  /** Projectile drawn while idle (before the first throw, or after `clear()`). */
  kind?: ThrowKind;
  /** Where the idle projectile sits (e.g. in hand at the throw origin); hidden when null. */
  idle?: Vec3 | null;
  /** Called exactly once per playback, when its last frame is shown. */
  onResolved?: (result: ThrowResult, playback: ThrowPlayback) => void;
  /** Called once per playback when the outcome is decided (it enters a cup, or is a sure miss). */
  onDecided?: (result: ThrowResult, playback: ThrowPlayback) => void;
  /** Beer pong ball colour. */
  ballColor?: BallColor;
  /** Shrink a missed ball/coin away after its replay (default true); a make stays in its target. */
  hideMiss?: boolean;
  /** Skip the flight and show the end at once. Default: prefers-reduced-motion. */
  instant?: boolean;
  ref?: Ref<Group>;
};

/**
 * Plays a pre-simulated throw back at real time (frameloop="demand" friendly: it invalidates only
 * while something moves). A ball that drops in stays settled on the beer (removing the cup is the
 * view's job); a miss shrinks away. `onResolved` fires exactly once per playback.
 */
export function ThrowReplay({
  playback,
  kind,
  idle = null,
  onResolved,
  onDecided,
  ballColor = 'orange',
  hideMiss = true,
  instant,
  ref,
  ...group
}: ThrowReplayProps) {
  const invalidate = useThree((s) => s.invalidate);
  const getThree = useThree((s) => s.get);
  const panVec = useMemo(() => new Vector3(), []);
  /** The playing throw's scheduled whoosh / bounces / plop. */
  const sound = useRef<SoundHandle | null>(null);
  const body = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const state = useRef<{
    pb: ThrowPlayback;
    start: number;
    done: boolean;
    decided: boolean;
  } | null>(null);
  const cb = useRef({ onResolved, onDecided });
  useEffect(() => {
    cb.current = { onResolved, onDecided };
  });
  shadowGeo ??= new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  shadowTex ??= softDiscTexture(64, 0.3);

  useEffect(() => {
    preloadThrowPhysics();
  }, []);

  const shownKind: ThrowKind | null = playback?.input.kind ?? kind ?? null;
  const radius = shownKind === 'coin' ? COIN_RADIUS : BALL_RADIUS;

  const place = useCallback(
    (p: Vec3, q: readonly [number, number, number, number], scale: number, shadowOn: boolean) => {
      const g = body.current;
      if (g) {
        g.visible = scale > 0.001;
        g.position.set(p[0], p[1], p[2]);
        g.quaternion.set(q[0], q[1], q[2], q[3]);
        g.scale.setScalar(Math.max(scale, 0.001));
      }
      const sh = shadow.current;
      if (sh) {
        const lift = Math.max(0, p[1] - radius);
        sh.visible = shadowOn && scale > 0.001;
        sh.position.set(p[0], 0.003, p[2]);
        sh.scale.setScalar(radius * (2.6 + lift * 1.6) * scale);
        (sh.material as MeshBasicMaterial).opacity =
          0.5 * Math.min(1, Math.max(0.12, 1 - lift * 0.9));
      }
    },
    [radius],
  );

  /** Pose of frame f (fractional) of a playback. */
  const frameAt = (
    pb: ThrowPlayback,
    f: number,
  ): { p: Vec3; q: [number, number, number, number] } => {
    const fr = pb.sim.frames;
    const last = pb.sim.steps - 1;
    const f0 = Math.max(0, Math.min(last, Math.floor(f)));
    const f1 = Math.min(f0 + 1, last);
    const a = Math.min(1, Math.max(0, f - f0));
    const o0 = f0 * THROW_FRAME_STRIDE;
    const o1 = f1 * THROW_FRAME_STRIDE;
    const at = (j: number) => (fr[o0 + j] ?? 0) + ((fr[o1 + j] ?? 0) - (fr[o0 + j] ?? 0)) * a;
    const dot =
      (fr[o0 + 3] ?? 0) * (fr[o1 + 3] ?? 0) +
      (fr[o0 + 4] ?? 0) * (fr[o1 + 4] ?? 0) +
      (fr[o0 + 5] ?? 0) * (fr[o1 + 5] ?? 0) +
      (fr[o0 + 6] ?? 1) * (fr[o1 + 6] ?? 1);
    const sign = dot < 0 ? -1 : 1;
    const qa = (j: number) => (fr[o0 + j] ?? 0) * (1 - a) + sign * (fr[o1 + j] ?? 0) * a;
    const q: [number, number, number, number] = [qa(3), qa(4), qa(5), qa(6)];
    const n = Math.hypot(...q) || 1;
    return { p: [at(0), at(1), at(2)], q: [q[0] / n, q[1] / n, q[2] / n, q[3] / n] };
  };

  const report = (s: NonNullable<typeof state.current>) => {
    if (!s.decided) {
      s.decided = true;
      cb.current.onDecided?.(s.pb.sim.result, s.pb);
    }
    if (s.done) return;
    s.done = true;
    s.pb.settle?.(s.pb.sim);
    cb.current.onResolved?.(s.pb.sim.result, s.pb);
  };

  /** Stereo position of a point in this replay's space, from where it shows on screen. */
  const panOf = (x: number, y: number, z: number): number => {
    const parent = body.current?.parent;
    if (!parent) return 0;
    panVec.set(x, y, z).applyMatrix4(parent.matrixWorld).project(getThree().camera);
    return Math.max(-0.8, Math.min(0.8, panVec.x * 0.7));
  };

  // A new playback: finish (and report) the old one at once, then start the new one.
  useEffect(() => {
    const prev = state.current;
    if (prev && prev.pb !== playback) {
      sound.current?.stop(40);
      sound.current = null;
      report(prev);
    }
    if (!playback) {
      state.current = null;
      return;
    }
    if (prev?.pb === playback) return;
    state.current = { pb: playback, start: -1, done: false, decided: false };
    const first = frameAt(playback, 0);
    place(first.p, first.q, 1, true);
    const { sim, input } = playback;
    const made = isMade(sim.result);
    if (instant ?? prefersReducedMotion()) {
      state.current.start = -Infinity;
      // No flight to listen to: just the result.
      if (made) {
        play(input.kind === 'ball' ? 'ball.plop' : 'coin.ding');
        hapticLater('impactMedium', 0);
      }
    } else {
      // Release now: the replay's clock and the scheduled sounds start together.
      state.current.start = performance.now() / 1000;
      sound.current = throwFlight({
        kind: input.kind,
        frames: sim.frames,
        steps: sim.steps,
        dt: sim.dt,
        targets: input.targets,
        made,
        resolvedStep: sim.resolvedStep,
        pan: panOf,
      });
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the playback object only
  }, [playback]);

  // Idle: the projectile waits at `idle` (or is hidden) until the first / next throw.
  const ix = idle?.[0];
  const iy = idle?.[1];
  const iz = idle?.[2];
  useEffect(() => {
    if (playback) return;
    if (ix !== undefined && iy !== undefined && iz !== undefined)
      place([ix, iy, iz], [0, 0, 0, 1], 1, true);
    else place([0, -10, 0], [0, 0, 0, 1], 0, false);
    invalidate();
  }, [playback, ix, iy, iz, place, invalidate]);

  // Settle a pending promise if the replay unmounts mid-flight.
  useEffect(
    () => () => {
      sound.current?.stop(60);
      const s = state.current;
      if (s && !s.done) {
        s.done = true;
        s.pb.settle?.(s.pb.sim);
      }
    },
    [],
  );

  useFrame((three) => {
    const s = state.current;
    if (!s) return;
    const now = performance.now() / 1000;
    if (s.start === -1) s.start = now;
    const t = now - s.start;
    const { sim } = s.pb;
    const f = t / sim.dt;
    const last = sim.steps - 1;
    const made = isMade(sim.result);
    if (!s.decided && f >= sim.resolvedStep) {
      s.decided = true;
      cb.current.onDecided?.(sim.result, s.pb);
    }
    if (f < last) {
      const { p, q } = frameAt(s.pb, f);
      // Once a ball is in a cup its shadow would be on the table under the cup: drop it.
      place(p, q, 1, !(made && f >= sim.resolvedStep));
      three.invalidate();
      return;
    }
    const end = frameAt(s.pb, last);
    if (made || !hideMiss) {
      place(end.p, end.q, 1, !made);
      report(s);
      return;
    }
    // A miss: report on the last frame, then shrink it away.
    report(s);
    const k = Math.max(0, 1 - (t - last * sim.dt) / MISS_FADE);
    place(end.p, end.q, k, true);
    if (k > 0) three.invalidate();
  });

  return (
    <group ref={ref} {...group}>
      <group ref={body} visible={false}>
        {shownKind === 'coin' ? (
          <Coin3D />
        ) : shownKind === 'ball' ? (
          <Ball3D color={ballColor} />
        ) : null}
      </group>
      <mesh ref={shadow} geometry={shadowGeo} renderOrder={-1} visible={false}>
        <meshBasicMaterial
          map={shadowTex}
          color="#000000"
          transparent
          depthWrite={false}
          opacity={0}
        />
      </mesh>
    </group>
  );
}
