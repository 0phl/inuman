import { useEffect, useRef } from 'react';
import type { Group, Mesh, MeshBasicMaterial } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { outcome } from '@/audio/cues';
import { play } from '@/audio/engine';
import type { View } from '@/core/games/mexico/logic';
import { DiceReplay, type DiceSettleResult } from '@/physics/DiceReplay';
import type { TraySpec } from '@/physics/diceConfig';
import { TABLE_Y } from '@/stage/tableSpace';
import { useTheme } from '@/store/theme';
import type { GameViewProps } from '../types';
import { clamp01, easeInOut, easeOut } from './dice3d';
import { CUP_H } from './diceCup';
import { DiceCup, DiceTray, DieShadow } from './diceKit';
import { useThrowGate } from './throwGate';

type V3 = readonly [number, number, number];

/** A compact tray for two dice, nudged left so the leather cup can stand beside it. */
const TRAY: TraySpec = { width: 1.6, depth: 1.3, wallHeight: 0.2, backHeight: 0.42 };
const TRAY_POS: V3 = [-0.2, TABLE_Y, -0.02];
const CUP_REST: V3 = [0.9, TABLE_Y, -0.08];
/**
 * Where the cup's base hangs while it pours: tipped by POUR_TILT, its mouth sits just above the
 * tray's near edge, where DiceReplay's throws start.
 */
const CUP_POUR: V3 = [TRAY_POS[0] + 0.06, TABLE_Y + 0.8, TRAY_POS[2] + TRAY.depth / 2 + 0.36];
const POUR_TILT = -2.05;
/** Scoop and shake before the dice leave the cup (ms). */
const LEAD_MS = 520;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): [number, number, number] => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/**
 * The leather cup: on every throw it lifts, shakes on its way over the tray, tips the dice out and
 * goes back to its spot. `cue` changes once per throw (never on mount).
 */
function ThrowingCup({ cue, lead }: { cue: number; lead: number }) {
  const cup = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<{ start: number } | null>(null);

  useEffect(() => {
    if (cue === 0) return;
    anim.current = { start: -1 };
    invalidate();
    // Scoop the dice up, rattle them on the way over (the pour itself is DiceReplay's throw), and
    // set the cup back down on its spot.
    const tipStart = lead - 0.14;
    play('dice.grab', { gain: 0.8 });
    play('dice.shake', { delay: 0.12, loop: true, duration: Math.max(0.15, tipStart - 0.12) });
    play('cup.slam', { delay: lead + 0.9, gain: 0.4 });
  }, [cue, lead, invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = cup.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.start < 0) a.start = now;
    const t = now - a.start;
    const lift: V3 = [CUP_REST[0], CUP_REST[1] + 0.26, CUP_REST[2]];
    const tipStart = lead - 0.14;
    const tipEnd = lead + 0.2;
    const back = tipEnd + 0.08;
    const end = back + 0.62;
    let pos: [number, number, number];
    let rx = 0;
    let rz = 0;
    if (t < 0.16) {
      pos = lerp3(CUP_REST, lift, easeOut(t / 0.16));
    } else if (t < tipStart) {
      const k = (t - 0.16) / (tipStart - 0.16);
      pos = lerp3(lift, CUP_POUR, easeInOut(k));
      // The shake: quick wobbles that settle as it lines up over the tray.
      const env = Math.sin(Math.PI * k);
      rx = Math.sin(t * 46) * 0.2 * env;
      rz = Math.cos(t * 39) * 0.16 * env;
      pos[1] += Math.abs(Math.sin(t * 30)) * 0.05 * env;
    } else if (t < back) {
      pos = [...CUP_POUR];
      rx = POUR_TILT * easeInOut(clamp01((t - tipStart) / (tipEnd - tipStart)));
    } else {
      const k = easeInOut(clamp01((t - back) / (end - back)));
      pos = lerp3(CUP_POUR, CUP_REST, k);
      pos[1] += Math.sin(Math.PI * k) * 0.12;
      rx = POUR_TILT * (1 - k);
    }
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.set(rx, 0, rz);
    const sh = shadow.current;
    if (sh) {
      sh.position.set(pos[0], TABLE_Y + 0.003, pos[2] - Math.sin(-rx) * CUP_H * 0.4);
      (sh.material as MeshBasicMaterial).opacity =
        0.62 * Math.max(0.2, 1 - (pos[1] - TABLE_Y) * 1.1);
    }
    if (t < end) state.invalidate();
    else {
      anim.current = null;
      g.position.set(...CUP_REST);
      g.rotation.set(0, 0, 0);
    }
  });

  return (
    <>
      <DiceCup ref={cup} position={CUP_REST} />
      <DieShadow
        ref={shadow}
        position={[CUP_REST[0], TABLE_Y + 0.003, CUP_REST[2]]}
        size={1.25}
        opacity={0.62}
      />
    </>
  );
}

/**
 * Mexico: two dice in a felt tray and a stitched leather cup. Every ROLL scoops the dice into the
 * cup, shakes and pours them; DiceReplay lands them on the reducer's faces and SETTLED is
 * dispatched when they stop. Nothing is scored before that.
 */
export default function MexicoScene({ view, dispatch }: GameViewProps<View>) {
  const dice = useTheme((s) => s.theme.diceMaterialId);
  const roll = view.roll;
  const gate = useThrowGate(roll, LEAD_MS);

  const onSettled = (r: DiceSettleResult) => {
    if (!roll || roll.settled || r.rollId !== roll.id) return;
    dispatch({ type: 'GAME', action: { type: 'SETTLED', rollId: r.rollId } });
  };

  // A Mexico (2-1) rings out; a finished round gets the losers' trombone.
  const mexicos = view.mexicos;
  const roundOver = view.phase === 'roundOver';
  const seen = useRef({ mexicos, roundOver });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { mexicos, roundOver };
    if (mexicos > prev.mexicos) outcome('streak');
    if (roundOver && !prev.roundOver)
      play('game.lose', { delay: mexicos > prev.mexicos ? 0.7 : 0.25 });
  }, [mexicos, roundOver]);

  return (
    <group>
      <DiceTray tray={TRAY} position={TRAY_POS} />
      {/* A fresh DiceReplay per throw: the previous dice leave with the cup. */}
      {roll && gate.rollId !== 0 && (
        <DiceReplay
          key={gate.rollId}
          targets={roll.faces}
          rollId={gate.rollId}
          tray={TRAY}
          showTray={false}
          theme={dice}
          instant={gate.instant}
          onSettled={onSettled}
          visible={!gate.leading}
          position={TRAY_POS}
        />
      )}
      <ThrowingCup cue={gate.cue} lead={LEAD_MS / 1000} />
    </group>
  );
}
