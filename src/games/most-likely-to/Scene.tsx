import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Color,
  CylinderGeometry,
  MeshStandardMaterial,
  Object3D,
  type Group,
  type InstancedMesh,
  type Texture,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import type { Result, View } from '@/core/games/most-likely-to/logic';
import { BlobShadow } from '@/three/BlobShadow';
import { cardGeometries, CARD_H } from '@/three/cardGeometry';
import { reducedMotion } from '../mexico/dice3d';
import { promptBackTexture, SIGN_FONT } from '../never-have-i-ever/textures';
import { Nameplate } from '../spin-the-bottle/seatKit';
import { ovalSeats, plateWidthFor, type PlateTone } from '../spin-the-bottle/seats';
import type { GameViewProps } from '../types';
import { capTexture, mltFaceTexture } from './textures';

/** The tent card stands at the back; the players' plaques curve round in front of it like a smile. */
const TENT_Z = -1.08;
const TENT_SCALE = 0.74;
const TILT = (64 * Math.PI) / 180;
const PANEL_H = CARD_H * TENT_SCALE;
const ARC_CZ = -1.05;
const ARC_RX = 0.95;
const ARC_RZ = 0.62;
const ARC_SPAN = (200 * Math.PI) / 180;
const SPIN_SECONDS = 0.8;
const HOP = 0.12;

/** Bottle caps: one per vote, stacked in front of the plaque they were cast for. */
const CAP_R = 0.092;
const CAP_H = 0.03;
const CAP_GAP = 0.003;
const CAP_FRONT = 0.2;
const CAP_DROP = 0.75;
const CAP_FALL_S = 0.42;
const CAP_STAGGER_S = 0.11;
const CAP_TOP = new Color('#f0b847');
const CAP_REST = new Color('#d8432a');
const MOST_GLOW = '#ff7a4d';

const edgeMaterial = new MeshStandardMaterial({ color: '#d9c9a6', roughness: 0.8 });

/** Waits for the sign font so the canvas lettering isn't stuck on the fallback face. */
function useSignFont(): boolean {
  const [ready, setReady] = useState(() => {
    try {
      return typeof document === 'undefined' || !document.fonts || document.fonts.check(SIGN_FONT);
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (ready || !document.fonts) return;
    let live = true;
    const done = () => {
      if (live) setReady(true);
    };
    document.fonts.load(SIGN_FONT).then(done, done);
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

function Panel({ face }: { face: Texture }) {
  const geo = cardGeometries();
  const back = useMemo(
    () =>
      new MeshStandardMaterial({ map: promptBackTexture(), roughness: 0.5, envMapIntensity: 0.7 }),
    [],
  );
  useEffect(() => () => back.dispose(), [back]);
  const half = PANEL_H / 2;
  return (
    <group
      position={[0, half * Math.sin(TILT) + 0.002, half * Math.cos(TILT)]}
      rotation={[TILT, 0, 0]}
      scale={TENT_SCALE}
    >
      <mesh geometry={geo.front}>
        <meshStandardMaterial map={face} roughness={0.42} envMapIntensity={0.9} />
      </mesh>
      <mesh geometry={geo.back} material={back} />
      <mesh geometry={geo.edge} material={edgeMaterial} />
    </group>
  );
}

/** A folded table-tent card; a new round hops and spins it a half turn to the next card. */
function TentCard({ round, fontReady }: { round: number; fontReady: boolean }) {
  const spin = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const [shown, setShown] = useState(round);
  const anim = useRef<{ start: number; duration: number } | null>(null);
  const near = mltFaceTexture(shown, fontReady);
  const far = mltFaceTexture(round, fontReady);

  useEffect(() => {
    if (round === shown) return;
    anim.current = { start: -1, duration: reducedMotion() ? 0.15 : SPIN_SECONDS };
    invalidate();
  }, [round, shown, invalidate]);

  useLayoutEffect(() => {
    const g = spin.current;
    if (!g) return;
    g.rotation.y = 0;
    g.position.y = 0;
    invalidate();
  }, [shown, invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = spin.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.start < 0) a.start = now;
    const raw = Math.min((now - a.start) / a.duration, 1);
    g.rotation.y = Math.PI * easing.cubic.inOut(raw);
    g.position.y = Math.sin(Math.PI * raw) * HOP;
    if (raw < 1) {
      state.invalidate();
    } else {
      anim.current = null;
      setShown(round);
    }
  });

  return (
    <group position={[0, 0, TENT_Z]}>
      <BlobShadow position={[0, 0.0026, 0]} scale={[0.55, 1, 0.52]} opacity={0.6} />
      <group ref={spin}>
        <Panel face={near} />
        <group rotation={[0, Math.PI, 0]}>
          <Panel face={far} />
        </group>
      </group>
    </group>
  );
}

interface CapSlot {
  x: number;
  z: number;
  level: number;
  /** Seconds after the reveal before this cap drops. */
  delay: number;
  top: boolean;
}

let capGeo: CylinderGeometry | null = null;
let capMat: MeshStandardMaterial | null = null;

/** A crown cork: a squat cylinder whose rim is crimped into 21 teeth. */
function capParts() {
  if (!capGeo) {
    const g = new CylinderGeometry(CAP_R * 0.94, CAP_R, CAP_H, 42, 1);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < CAP_R * 0.5) continue;
      const k = 1 + 0.07 * Math.max(0, Math.cos(Math.atan2(z, x) * 21));
      pos.setXYZ(i, x * k, pos.getY(i), z * k);
    }
    g.computeVertexNormals();
    capGeo = g;
  }
  capMat ??= new MeshStandardMaterial({
    map: capTexture(),
    metalness: 0.55,
    roughness: 0.35,
    envMapIntensity: 1.1,
  });
  return { geometry: capGeo, material: capMat };
}

/** Every cap of a reveal in one instanced draw; they rain down one by one onto their stacks. */
function CapStacks({ slots, animate }: { slots: CapSlot[]; animate: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const { geometry, material } = capParts();
  const t0 = useRef(-1);
  const dummy = useMemo(() => new Object3D(), []);
  const max = Math.max(slots.length, 1);

  const place = (elapsed: number): boolean => {
    const m = mesh.current;
    if (!m) return false;
    let busy = false;
    slots.forEach((s, i) => {
      const rest = s.level * (CAP_H + CAP_GAP) + CAP_H / 2;
      const raw = animate ? (elapsed - s.delay) / CAP_FALL_S : 1;
      if (raw < 1) busy = true;
      const t = Math.min(Math.max(raw, 0), 1);
      dummy.position.set(s.x, rest + CAP_DROP * (1 - t * t), s.z);
      dummy.rotation.set(0, i * 1.7, 0);
      dummy.scale.setScalar(raw <= 0 ? 0.0001 : 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, s.top ? CAP_TOP : CAP_REST);
    });
    m.count = slots.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    return busy;
  };

  useLayoutEffect(() => {
    t0.current = -1;
    place(0);
    invalidate();
    // `place` reads the current slots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, animate, invalidate]);

  useFrame((state) => {
    if (!animate) return;
    const now = performance.now() / 1000;
    if (t0.current < 0) t0.current = now;
    if (place(now - t0.current)) state.invalidate();
  });

  return (
    <instancedMesh key={max} ref={mesh} args={[geometry, material, max]} frustumCulled={false} />
  );
}

/** Seats along the smile; past ten players every other seat steps in so the plaques don't touch. */
function seatLayout(n: number) {
  const seats = ovalSeats(n, { cz: ARC_CZ, rx: ARC_RX, rz: ARC_RZ, span: ARC_SPAN });
  const stagger = n > 10;
  const arc = ARC_SPAN * Math.sqrt((ARC_RX * ARC_RX + ARC_RZ * ARC_RZ) / 2);
  const width = plateWidthFor(stagger ? Math.ceil(n / 2) : n, arc, 0.5, 0.28);
  return {
    width,
    seats: seats.map((s, i) => {
      if (!stagger || i % 2 === 0) return s;
      const k = 0.78;
      return { ...s, x: s.x * k, z: ARC_CZ + (s.z - ARC_CZ) * k };
    }),
  };
}

/** Cap slots for a revealed tally: stacks in front of each plaque, dropped seat by seat. */
function capSlots(
  result: Result,
  order: readonly string[],
  seats: readonly { x: number; z: number }[],
): CapSlot[] {
  const out: CapSlot[] = [];
  (result.tally ?? []).forEach((count, i) => {
    const s = seats[i];
    const id = order[i];
    if (!s || id === undefined) return;
    const top = result.picked.includes(id);
    for (let level = 0; level < count; level++) {
      out.push({
        x: s.x,
        z: s.z + CAP_FRONT,
        level,
        delay: 0.25 + out.length * CAP_STAGGER_S,
        top,
      });
    }
  });
  return out;
}

/**
 * Most Likely To: a MOST / LIKELY / TO tent card at the back with everyone's plaque curved round
 * in front of it. Secret votes stay off the table until the reveal, when each vote drops as a
 * bottle cap onto the stack in front of whoever got it; the most-voted plaques light up.
 */
export default function MostLikelyToScene({ view, players }: GameViewProps<View>) {
  const fontReady = useSignFont();
  const n = view.order.length;
  const { seats, width } = useMemo(() => seatLayout(n), [n]);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';

  // Reveal: caps rain down unless the reveal was already showing when the scene mounted.
  const [mountReveal] = useState(() => (view.phase === 'reveal' ? view.last : null));
  const reveal = view.phase === 'reveal' && view.last?.tally ? view.last : null;
  const slots = useMemo(
    () => (reveal ? capSlots(reveal, view.order, seats) : []),
    [reveal, view.order, seats],
  );
  const animateCaps = reveal !== null && reveal !== mountReveal;
  const dropSeconds = slots.length ? (slots[slots.length - 1]?.delay ?? 0) + CAP_FALL_S : 0;

  // The most-voted plaques light up once their caps have landed.
  const [litFor, setLitFor] = useState<Result | null>(mountReveal);
  useEffect(() => {
    if (!reveal) return;
    const id = window.setTimeout(
      () => setLitFor(reveal),
      animateCaps && !reducedMotion() ? dropSeconds * 1000 : 0,
    );
    return () => window.clearTimeout(id);
  }, [reveal, animateCaps, dropSeconds]);

  // Point mode: whoever the table just pointed at glows for a moment as the next card comes up.
  const [mountLast] = useState(view.last);
  const [flashDone, setFlashDone] = useState<Result | null>(null);
  const pointed =
    !reveal && view.last && view.last.tally === null && view.last !== mountLast ? view.last : null;
  useEffect(() => {
    if (!pointed) return;
    const id = window.setTimeout(() => setFlashDone(pointed), 2600);
    return () => window.clearTimeout(id);
  }, [pointed]);

  const voter = view.phase === 'vote' ? view.voter : null;
  const lit =
    reveal && litFor === reveal
      ? reveal.picked
      : pointed && flashDone !== pointed
        ? pointed.picked
        : [];
  const reader = view.order[view.reader];

  return (
    <group>
      <TentCard round={view.round} fontReady={fontReady} />
      {view.order.map((id, i) => {
        const s = seats[i];
        if (!s) return null;
        const hot = lit.includes(id);
        const tone: PlateTone = hot
          ? 'picked'
          : (voter ?? (view.phase === 'read' ? reader : null)) === id
            ? 'turn'
            : 'idle';
        return (
          <Nameplate
            key={id}
            name={nameOf(id)}
            tone={tone}
            width={width}
            glow={hot ? MOST_GLOW : null}
            position={[s.x, 0, s.z]}
            rotation-y={-Math.cos(s.phi) * 0.25}
          />
        );
      })}
      {slots.length > 0 && <CapStacks slots={slots} animate={animateCaps} />}
    </group>
  );
}
