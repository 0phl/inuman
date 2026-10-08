import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Rules, View } from '@/core/games/liars-dice/logic';
import type { Face } from '@/core/primitives/dice';
import { DIE_SIZE } from '@/physics/diceConfig';
import { TABLE_Y } from '@/stage/tableSpace';
import { useTheme } from '@/store/theme';
import { Die3D } from '@/three/Die3D';
import { easeInOut, faceUpQuaternion, hash01, reducedMotion } from '../mexico/dice3d';
import { CUP_H, CUP_R_TOP, DiceCup, DieShadow, GlowDisc } from '../mexico/diceKit';
import type { GameViewProps } from '../types';
import { usePeeking, usePrivateView } from './privateView';
import { tagTexture, type TagTone } from './tags';

/** The cups sit on an oval, stretched toward the camera so it reads round from the fixed rig. */
const CZ = -0.45;
const RX = 0.88;
const RZ = 0.68;
const PERIMETER = 2 * Math.PI * Math.sqrt((RX * RX + RZ * RZ) / 2);
const SHAKE_S = 1.05;
const LIFT_S = 0.7;
const TAU = Math.PI * 2;

const wrapAngle = (a: number) => a - TAU * Math.round(a / TAU);

interface DieSpot {
  x: number;
  z: number;
  q: [number, number, number, number];
  face: Face;
}

/** A hand spread out where the cup stood: rows of up to three, nudged so it looks tipped out. */
function spreadHand(
  hand: readonly Face[],
  scale: number,
  seed: number,
): { spots: DieSpot[]; depth: number } {
  const n = hand.length;
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const step = DIE_SIZE * scale * 1.22;
  const spots = hand.map((face, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, n - row * cols);
    const col = i % cols;
    const j = hash01(seed * 31 + i * 7.3);
    const k = hash01(seed * 17 + i * 3.1);
    const q = faceUpQuaternion(face, (j - 0.5) * 1.1);
    return {
      x: (col - (inRow - 1) / 2) * step + (k - 0.5) * 0.03,
      z: (row - (rows - 1) / 2) * step + (j - 0.5) * 0.03,
      q: [q.x, q.y, q.z, q.w] as [number, number, number, number],
      face,
    };
  });
  return { spots, depth: rows * step };
}

interface SeatProps {
  name: string;
  count: number;
  tone: TagTone;
  outLabel: string;
  /** Dice to show under the lifted cup (the reveal, or the bidder's own peek), else null. */
  dice: readonly Face[] | null;
  lifted: boolean;
  match: ((f: Face) => boolean) | null;
  cupScale: number;
  diceScale: number;
  /** Changes once per new round (0 = no shake). */
  shakeCue: number;
  delay: number;
  theme: string;
  seed: number;
  ref?: Ref<Group>;
}

/** One player's place: an upturned leather cup over their dice, a name/count tag in front. */
function Seat({
  name,
  count,
  tone,
  outLabel,
  dice,
  lifted,
  match,
  cupScale: cs,
  diceScale: ds,
  shakeCue,
  delay,
  theme,
  seed,
  ref,
}: SeatProps) {
  const invalidate = useThree((s) => s.invalidate);
  const cup = useRef<Group>(null);
  const diceGroup = useRef<Group>(null);
  const out = tone === 'out' && !dice;
  const anim = useRef({ lift: lifted ? 1 : 0, liftT0: -1, shakeT0: -2 });
  const hand = useMemo(() => (dice ? spreadHand(dice, ds, seed) : null), [dice, ds, seed]);
  const back = (hand?.depth ?? DIE_SIZE) / 2 + CUP_R_TOP * cs + 0.07;

  const tex = useMemo(
    () => tagTexture(name, count, tone, outLabel, invalidate),
    [name, count, tone, outLabel, invalidate],
  );
  useEffect(() => () => tex.dispose(), [tex]);

  useEffect(() => {
    if (shakeCue === 0 || reducedMotion()) return;
    anim.current.shakeT0 = -1;
    invalidate();
  }, [shakeCue, invalidate]);

  useEffect(() => {
    anim.current.liftT0 = -1;
    invalidate();
  }, [lifted, invalidate]);

  useFrame((state, rawDt) => {
    const g = cup.current;
    if (!g) return;
    const a = anim.current;
    const now = performance.now() / 1000;
    const dt = Math.min(rawDt, 0.05);
    let busy = false;

    // Lift toward the target; going up waits for this seat's turn in the reveal stagger.
    const target = lifted ? 1 : 0;
    if (a.lift !== target) {
      if (a.liftT0 < 0) a.liftT0 = now;
      const waited = !lifted || now - a.liftT0 >= delay;
      if (waited) {
        const rate = reducedMotion() ? 8 : 1 / LIFT_S;
        a.lift =
          target > a.lift ? Math.min(1, a.lift + dt * rate) : Math.max(0, a.lift - dt * rate * 1.6);
      }
      busy = true;
    }
    const e = easeInOut(a.lift);
    let x = 0;
    let y = CUP_H * cs * (1 - e) + Math.sin(Math.PI * e) * 0.42 * cs;
    const z = -back * e;
    // Upturned (π) → upright behind the dice (2π): it tips away from the camera, never toward it.
    let rx = Math.PI + Math.PI * e;
    let rz = 0;

    if (a.shakeT0 !== -2) {
      if (a.shakeT0 < 0) a.shakeT0 = now;
      const t = now - a.shakeT0 - delay * 0.5;
      if (t < SHAKE_S) {
        if (t > 0) {
          const env = Math.sin((Math.PI * t) / SHAKE_S);
          rz = Math.sin(t * 34) * 0.16 * env;
          rx += Math.cos(t * 29) * 0.1 * env;
          y += Math.abs(Math.sin(t * 26)) * 0.06 * env * cs;
          x = Math.sin(t * 21) * 0.035 * env;
        }
        busy = true;
      } else {
        a.shakeT0 = -2;
      }
    }

    if (out) {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
    } else {
      g.position.set(x, y, z);
      g.rotation.set(rx, 0, rz);
    }
    if (diceGroup.current) diceGroup.current.visible = a.lift > 0.55;
    if (busy) state.invalidate();
  });

  const tagW = 0.74 * Math.min(1, cs * 1.05);
  return (
    <group ref={ref}>
      {tone === 'turn' && (
        <GlowDisc radius={0.38 * cs} opacity={0.5} position-y={TABLE_Y + 0.003} />
      )}
      <DiceCup ref={cup} scale={cs} />
      {hand && (
        <group ref={diceGroup}>
          {hand.spots.map((s, i) => (
            <group key={i} position={[s.x, TABLE_Y, s.z]}>
              {match?.(s.face) && (
                <GlowDisc radius={DIE_SIZE * ds * 1.45} opacity={0.9} position-y={0.003} />
              )}
              <Die3D
                materialId={theme}
                size={DIE_SIZE * ds}
                position-y={(DIE_SIZE * ds) / 2}
                quaternion={s.q}
              />
              <DieShadow size={ds} position-y={0.004} opacity={0.45} />
            </group>
          ))}
        </group>
      )}
      <mesh rotation-x={-Math.PI / 2 + 0.7} position={[0, 0.05, CUP_R_TOP * cs + 0.24]}>
        <planeGeometry args={[tagW, tagW / 4]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Liar's Dice: one leather cup per seat on an oval. The table turns so whoever bids next sits
 * nearest the camera. Each new round shakes every cup; a call lifts them all, one after another,
 * and spreads each hand out (dice that count toward the bid glow). Hidden dice never reach this
 * scene, except the current bidder's own hand while they peek (their cup tips back for them).
 */
export default function LiarsDiceScene({ view, rules, players }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const theme = useTheme((s) => s.theme.diceMaterialId);
  const invalidate = useThree((s) => s.invalidate);
  const peeking = usePeeking(view);
  const mine = usePrivateView<View>(peeking ? view.current : null)?.mine ?? null;
  const n = Math.max(1, view.order.length);
  const ringTarget = (-view.turn * TAU) / n;
  const ring = useRef(ringTarget);
  const seats = useRef<(Group | null)[]>([]);
  // A game that starts here shakes; a resumed round doesn't shake again.
  const [mountRoll] = useState(() =>
    view.phase === 'bidding' && view.bids.length === 0 ? -1 : view.roll.id,
  );
  const shakeCue = view.roll.id === mountRoll ? 0 : view.roll.id;

  useEffect(() => invalidate(), [ringTarget, invalidate]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const diff = wrapAngle(ringTarget - ring.current);
    if (Math.abs(diff) > 1e-4) {
      ring.current += reducedMotion() ? diff : diff * Math.min(1, dt * 4.5);
      state.invalidate();
    } else ring.current = ringTarget;
    for (let i = 0; i < n; i++) {
      const g = seats.current[i];
      if (!g) continue;
      const phi = Math.PI / 2 + (i * TAU) / n + ring.current;
      g.position.set(RX * Math.cos(phi), 0, CZ + RZ * Math.sin(phi));
    }
  });

  const chord = PERIMETER / n;
  const cs = Math.min(1.12, chord / 0.72);
  const ds = Math.min(0.8, chord / (3.6 * DIE_SIZE));
  const reveal = view.phase === 'reveal' ? view.reveal : null;
  const bid = reveal?.bid ?? null;
  const match = bid
    ? (f: Face) => f === bid.face || (r.onesWild && bid.face !== 1 && f === 1)
    : null;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  return (
    <group>
      {view.order.map((id, i) => {
        const shown = reveal ? (reveal.hands[i] ?? []) : peeking && i === view.turn ? mine : null;
        const dice = shown && shown.length > 0 ? shown : null;
        const k = (i - view.turn + n) % n;
        const tone: TagTone =
          (view.counts[i] ?? 0) === 0 ? 'out' : view.current === id ? 'turn' : 'idle';
        return (
          <Seat
            key={id}
            ref={(g) => {
              seats.current[i] = g;
            }}
            name={nameOf(id)}
            count={view.counts[i] ?? 0}
            tone={tone}
            outLabel={t('ld.hud.out')}
            dice={dice}
            lifted={dice !== null}
            match={match}
            cupScale={cs}
            diceScale={ds}
            shakeCue={shakeCue}
            delay={reveal ? Math.min(k, 6) * 0.14 : k * 0.06}
            theme={theme}
            seed={view.round * 13 + i}
          />
        );
      })}
    </group>
  );
}
