import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Shape,
  type BufferGeometry,
  type Group,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { useFrame, useThree } from '@react-three/fiber';
import type { Rules, View } from '@/core/games/truth-or-dare/logic';
import { BlobShadow } from '@/three/BlobShadow';
import { brassMaterial, narraMaterial, reducedMotion } from '../mexico/dice3d';
import { settleOnce } from '../spin-the-bottle/settle';
import { angleAt, planSpin, type SpinPlan } from '../spin-the-bottle/spin';
import type { GameViewProps } from '../types';
import { SEG, SEGMENTS, flapAt, landingFor, wheelTexture } from './wheel';

/**
 * The wheel stands on the felt's centre line, leaning back so it faces the camera: its face fills
 * the open table between the turn header and the prompt card.
 */
const BASE_Z = 0.48;
const R = 0.64;
const POST_H = R + 0.1;
const LEAN = 0.5;
const THICK = 0.045;
const WHEEL_SECONDS = 3.8;
const NUDGE_SECONDS = 1.1;
const REST_PSI = -SEG * 0.5;

interface Anim {
  key: string;
  plan: SpinPlan;
  t0: number;
  /** Wheel-mode spins report SETTLED when they land; player-mode nudges don't. */
  settle: number | null;
}

interface WheelParts {
  face: BufferGeometry;
  back: BufferGeometry;
  rim: BufferGeometry;
  pegs: BufferGeometry;
  hub: BufferGeometry;
  pointer: BufferGeometry;
  backMat: MeshStandardMaterial;
}

let parts: WheelParts | null = null;

function wheelParts(): WheelParts {
  if (parts) return parts;
  const pegList: BufferGeometry[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const a = k * SEG;
    const r = R * 0.93;
    pegList.push(
      new CylinderGeometry(0.011, 0.011, 0.05, 10)
        .rotateX(Math.PI / 2)
        .translate(Math.cos(a) * r, Math.sin(a) * r, THICK / 2 + 0.022),
    );
  }
  const pegs = mergeGeometries(pegList) ?? new CylinderGeometry(0, 0, 0);
  pegList.forEach((g) => g.dispose());
  // The pointer hangs from its hinge (the origin) and points down at the rim.
  const tri = new Shape();
  tri.moveTo(-0.05, -0.01);
  tri.lineTo(0.05, -0.01);
  tri.lineTo(0, -0.15);
  tri.closePath();
  const pointer = new ExtrudeGeometry(tri, {
    depth: 0.018,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  parts = {
    face: new CircleGeometry(R, 64).translate(0, 0, THICK / 2 + 0.001),
    back: new CircleGeometry(R, 32).rotateY(Math.PI).translate(0, 0, -THICK / 2),
    rim: new CylinderGeometry(R, R, THICK, 64, 1, true).rotateX(Math.PI / 2),
    pegs,
    hub: new CylinderGeometry(0.07, 0.078, 0.05, 28).rotateX(Math.PI / 2),
    pointer,
    backMat: new MeshStandardMaterial({ color: '#2a170c', roughness: 0.7 }),
  };
  return parts;
}

/** Wheel angle where the current state has it resting (no animation). */
function restingPsi(view: View, rules: Rules): number {
  if (rules.choice === 'wheel' && view.wheel?.settled)
    return landingFor(view.wheel.kind, view.wheel.id);
  if (view.phase === 'prompt' && view.prompt) return landingFor(view.prompt.kind, view.round);
  return REST_PSI;
}

/**
 * Truth or Dare: a perya prize wheel on a narra stand in the middle of the table. In wheel mode a
 * SPIN_WHEEL turns it (analytic, constant deceleration) onto a segment of the kind the reducer
 * picked, then the scene reports SETTLED. In player mode the wheel just swings round to whatever
 * the player chose.
 */
export default function TruthOrDareScene({ view, rules, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const invalidate = useThree((s) => s.invalidate);
  const p = wheelParts();
  const wheel = useRef<Group>(null);
  const flapper = useRef<Group>(null);
  const [startPsi] = useState(() => restingPsi(view, r));
  const psi = useRef(startPsi);
  const anim = useRef<Anim | null>(null);
  // A prompt already on the table when the scene mounted (a reload) isn't nudged again.
  const [mountRound] = useState(() => (view.phase === 'prompt' ? view.round : -1));

  const truth = t('tod.hud.truth');
  const dare = t('tod.hud.dare');
  const face = useMemo(() => wheelTexture({ truth, dare }, invalidate), [truth, dare, invalidate]);
  useEffect(() => () => face.dispose(), [face]);
  // Painted like the plaques: unlit and outside tone mapping, so the reds and greens stay true
  // under the bar's warm light.
  const faceMat = useMemo(
    () => new MeshBasicMaterial({ map: face, color: '#e6e0d6', toneMapped: false }),
    [face],
  );
  useEffect(() => () => faceMat.dispose(), [faceMat]);

  const start = (
    key: string,
    to: number,
    turns: number,
    seconds: number,
    settle: number | null,
  ) => {
    const short = reducedMotion();
    // Clockwise: plan on negated angles so the wheel's angle decreases.
    const plan = planSpin(-psi.current, -to, short ? 0 : turns, short ? 0.5 : seconds);
    anim.current = { key, plan, t0: -1, settle };
    invalidate();
  };

  const wheelId = view.wheel?.id ?? 0;
  const wheelKind = view.wheel?.kind ?? 'truth';
  const spinning = r.choice === 'wheel' && view.wheel !== null && !view.wheel.settled;
  useEffect(() => {
    if (!spinning || anim.current?.key === `w${wheelId}`) return;
    const turns = 3 + Math.round(((wheelId * 7) % 3) / 2);
    start(`w${wheelId}`, landingFor(wheelKind, wheelId), turns, WHEEL_SECONDS, wheelId);
    // `start` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, wheelId, wheelKind]);

  const promptKind = view.phase === 'prompt' ? (view.prompt?.kind ?? null) : null;
  const round = view.round;
  useEffect(() => {
    if (r.choice !== 'player' || !promptKind || round === mountRound) return;
    if (anim.current?.key === `p${round}`) return;
    start(`p${round}`, landingFor(promptKind, round), 1, NUDGE_SECONDS, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.choice, promptKind, round, mountRound]);

  useFrame((state) => {
    const a = anim.current;
    const g = wheel.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.t0 < 0) a.t0 = now;
    const tt = now - a.t0;
    const value = -angleAt(a.plan, tt);
    psi.current = value;
    g.rotation.z = value;
    if (flapper.current)
      flapper.current.rotation.z = tt < a.plan.duration ? flapAt(value) * 0.55 : 0;
    if (tt < a.plan.duration) {
      state.invalidate();
      return;
    }
    anim.current = null;
    const id = a.settle;
    if (id !== null) {
      settleOnce('tod', id, () =>
        dispatch({ type: 'GAME', action: { type: 'SETTLED', wheelId: id } }),
      );
    }
  });

  const narra = narraMaterial();
  const brass = brassMaterial();
  return (
    <group position={[0, 0, BASE_Z]}>
      <BlobShadow position={[0, 0.0025, -0.12]} scale={[0.95, 1, 0.55]} opacity={0.75} />
      {/* Plinth */}
      <mesh position={[0, 0.026, 0]} material={p.backMat}>
        <boxGeometry args={[0.62, 0.052, 0.3]} />
      </mesh>
      {/* Brass nosing along the front edge */}
      <mesh position={[0, 0.047, 0.152]} material={brass}>
        <boxGeometry args={[0.64, 0.014, 0.014]} />
      </mesh>
      <group position={[0, 0.06, -0.02]} rotation-x={-LEAN}>
        {/* Post and a kickstand brace behind the wheel */}
        <mesh position={[0, POST_H / 2, -THICK / 2 - 0.04]} material={narra}>
          <boxGeometry args={[0.08, POST_H, 0.06]} />
        </mesh>
        <group position={[0, POST_H, 0]}>
          <group ref={wheel} rotation-z={startPsi}>
            <mesh geometry={p.face} material={faceMat} />
            <mesh geometry={p.back} material={p.backMat} />
            <mesh geometry={p.rim} material={brass} />
            <mesh geometry={p.pegs} material={brass} />
          </group>
          <mesh geometry={p.hub} material={brass} position-z={THICK / 2 + 0.025} />
          <group ref={flapper} position={[0, R + 0.1, THICK / 2 + 0.02]}>
            <mesh geometry={p.pointer} material={brass} />
          </group>
          {/* The flapper's bracket */}
          <mesh position={[0, R + 0.115, 0.0]} material={narra}>
            <boxGeometry args={[0.12, 0.06, THICK + 0.05]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
