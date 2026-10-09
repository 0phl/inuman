import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { play, type SoundHandle } from '@/audio/engine';
import { hapticLater } from '@/audio/haptics';
import type { View } from '@/core/games/spin-the-bottle/logic';
import { BlobShadow } from '@/three/BlobShadow';
import { reducedMotion } from '../mexico/dice3d';
import type { GameViewProps } from '../types';
import { BOTTLE_R, bottleParts } from './bottle';
import { Nameplate } from './seatKit';
import { ovalSeats, plateWidthFor, type PlateTone } from './seats';
import { settleOnce } from './settle';
import { angleAt, durationFor, planSpin, wedgeOffset, wrap, type SpinPlan } from './spin';

/** The bottle spins on the felt's centre line, a little back so the HUD never hides it. */
const CZ = -0.24;
const RX = 0.9;
const RZ = 0.84;
const PERIMETER = 2 * Math.PI * Math.sqrt((RX * RX + RZ * RZ) / 2);
/** Before the first spin the neck points off between seats, at nobody. */
const REST_YAW = 0.95;
const PICKED_GLOW = '#ff7a4d';
const TURN_GLOW = '#f3c977';

interface Anim {
  id: number;
  plan: SpinPlan;
  t0: number;
  /** A recorded spin, flick to stop, timed so it stops when the bottle does. */
  sound: SoundHandle | null;
}

/** Each recorded spin runs on this long after the bottle stops (its faded tail; recipes.json). */
const SPIN_TAIL_S = 0.35;

/** Where the neck points at rest after a spin: the target's seat, nudged inside its wedge. */
function landingYaw(yaws: readonly number[], seat: number, spinId: number): number {
  return (yaws[seat] ?? 0) + wedgeOffset(yaws, seat, spinId * 7.31 + 0.5);
}

/**
 * Spin the Bottle: name plaques in a ring around an amber beer bottle lying on the felt. A SPIN
 * is animated analytically (constant deceleration onto the seat the reducer picked), then the scene
 * reports SETTLED; the picked plaque turns chili red with a glow under it.
 */
export default function SpinTheBottleScene({ view, players, dispatch }: GameViewProps<View>) {
  const invalidate = useThree((s) => s.invalidate);
  const n = view.order.length;
  const seats = useMemo(() => ovalSeats(n, { cz: CZ, rx: RX, rz: RZ }), [n]);
  // The bottle's yaw that points its neck at each seat (neck = local +X).
  const yaws = useMemo(() => seats.map((s) => Math.atan2(-(s.z - CZ), s.x)), [seats]);
  const plateW = plateWidthFor(n, PERIMETER, 0.56, 0.3);
  const bottle = useRef<Group>(null);
  const yaw = useRef<number | null>(null);
  const anim = useRef<Anim | null>(null);
  const parts = bottleParts();

  const spin = view.spin;
  const spinId = spin?.id ?? 0;
  const spinning = spin !== null && !spin.settled;
  const targetSeat = spin ? view.order.indexOf(spin.target) : -1;
  const turns = spin?.extraTurns ?? 2;
  const power = spin?.power ?? 0.5;

  // A new, unsettled spin: plan it from wherever the neck points now.
  useEffect(() => {
    if (!spinning || anim.current?.id === spinId) return;
    const from = yaw.current ?? REST_YAW;
    const to = landingYaw(yaws, Math.max(targetSeat, 0), spinId);
    const short = reducedMotion();
    const plan = short ? planSpin(from, to, 0, 0.6) : planSpin(from, to, turns, durationFor(power));
    const T = plan.duration;
    // A real spin whose length fits this one (a soft flick gets a short take, a hard one a long
    // take), so its last knocks land as the bottle stops. Reduced motion: just the stop.
    const sound = short ? null : play('bottle.spin', { fit: T + SPIN_TAIL_S });
    if (short) play('bottle.stop', { delay: Math.max(0, T - 0.25) });
    anim.current?.sound?.stop(80);
    anim.current = { id: spinId, plan, t0: performance.now() / 1000, sound };
    // Then the pick lands with a ding.
    play('bottle.select', { delay: T + 0.2 });
    hapticLater('impactMedium', (T + 0.2) * 1000);
    invalidate();
  }, [spinning, spinId, targetSeat, turns, power, yaws, invalidate]);

  // Leaving mid-spin: don't leave the spin sounding.
  useEffect(() => {
    const a = anim;
    return () => a.current?.sound?.stop(80);
  }, []);

  // At rest (no spin yet, or a settled one): point where it landed.
  useLayoutEffect(() => {
    if (spinning || anim.current) return;
    const g = bottle.current;
    const rest = spin ? landingYaw(yaws, Math.max(targetSeat, 0), spinId) : REST_YAW;
    yaw.current = wrap(rest);
    if (g) g.rotation.y = yaw.current;
    invalidate();
  }, [spin, spinning, spinId, targetSeat, yaws, invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = bottle.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.t0 < 0) a.t0 = now;
    const t = now - a.t0;
    const th = angleAt(a.plan, t);
    g.rotation.y = th;
    yaw.current = wrap(th);
    if (t < a.plan.duration) {
      state.invalidate();
      return;
    }
    // The recording's own tail plays out (it was timed to end here).
    anim.current = null;
    settleOnce('stb', a.id, () =>
      dispatch({ type: 'GAME', action: { type: 'SETTLED', spinId: a.id } }),
    );
  });

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const spinnerId = view.order[view.spinner];
  const landed = spin !== null && spin.settled && view.phase !== 'spin';

  return (
    <group>
      <group position={[0, BOTTLE_R + 0.001, CZ]}>
        <group ref={bottle} rotation-y={REST_YAW}>
          <BlobShadow
            position={[0.03, 0.0025 - BOTTLE_R, 0.02]}
            scale={[0.95, 1, 0.24]}
            opacity={0.75}
          />
          <mesh geometry={parts.glass} material={parts.glassMat} />
          <mesh geometry={parts.label} material={parts.labelMat} />
          <mesh geometry={parts.foil} material={parts.foilMat} />
        </group>
      </group>
      {view.order.map((id, i) => {
        const s = seats[i];
        if (!s) return null;
        const picked = landed && i === targetSeat;
        const turn = !landed && id === spinnerId;
        const tone: PlateTone = picked ? 'picked' : turn ? 'turn' : 'idle';
        return (
          <Nameplate
            key={id}
            name={nameOf(id)}
            tone={tone}
            width={plateW}
            glow={picked ? PICKED_GLOW : turn && !spinning ? TURN_GLOW : null}
            position={[s.x, 0, s.z]}
            // Seats along the sides turn a touch toward the bottle.
            rotation-y={-Math.cos(s.phi) * 0.22}
          />
        );
      })}
    </group>
  );
}
