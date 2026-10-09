import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  LatheGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Vector2,
  type Group,
  type InstancedMesh,
  type Mesh,
  type Texture,
} from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import { cardFlight } from '@/audio/cues';
import { play } from '@/audio/engine';
import { haptic, hapticLater } from '@/audio/haptics';
import { duck } from '@/audio/music';
import type { View } from '@/core/games/kings-cup/logic';
import type { Card } from '@/core/primitives/deck';
import { useTheme } from '@/store/theme';
import { BlobShadow } from '@/three/BlobShadow';
import { Card3D } from '@/three/Card3D';
import { CARD_T, cardGeometries } from '@/three/cardGeometry';
import { cardBackTexture, cardMaterial } from '@/three/cardTextures';
import type { GameViewProps } from '../types';

const DECK_SIZE = 52;

// The ring is an oval stretched toward the camera so it reads as a circle from the fixed 50° rig.
const CX = 0;
const CZ = -0.24;
const RX = 0.84;
const RZ = 1.0;
const RING_SCALE = 0.56;
/** Per-slot lift so overlapping ring cards never share a depth. */
const RING_STEP = 0.00045;

const CUP_Z = CZ - 0.16;
const CUP_H = 0.44;
const CUP_R_BOT = 0.135;
const CUP_R_TOP = 0.19;
const INNER_BOT = 0.02;

/** The drawn card lands face up between the cup and the players. */
const LAND_X = CX;
const LAND_Z = CZ + 0.42;
const LAND_SCALE = 0.64;
const PILE_BASE = 0.017;
const PILE_STEP = 0.0045;

const FLIGHT_SECONDS = 0.85;
const ARC_HEIGHT = 0.78;
/** Kings pour in once the card has landed. */
const POUR_DELAY_MS = 750;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Slot {
  x: number;
  y: number;
  z: number;
  /** Long axis pointing away from the cup. */
  yaw: number;
}

/** 52 fixed places around the cup, fanned so each card tucks over the next. */
const SLOTS: Slot[] = Array.from({ length: DECK_SIZE }, (_, k) => {
  const phi = 0.4 + (k / DECK_SIZE) * Math.PI * 2;
  const dx = RX * Math.cos(phi);
  const dz = RZ * Math.sin(phi);
  // Tent-shaped stacking: integers on one half, half-steps on the other, so no two cards tie.
  const lift = Math.min(k + 1, DECK_SIZE + 0.5 - k) * RING_STEP;
  return { x: CX + dx, y: lift + (CARD_T * RING_SCALE) / 2, z: CZ + dz, yaw: Math.atan2(dx, dz) };
});

/** Which slot each successive draw comes from: scattered, like hands reaching in from all sides. */
const DRAW_ORDER: number[] = (() => {
  const a = Array.from({ length: DECK_SIZE }, (_, i) => i);
  let s = 0x2f6b1d;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = a[i] as number;
    a[i] = a[j] as number;
    a[j] = tmp;
  }
  return a;
})();

const slotOfDraw = (n: number): Slot => SLOTS[DRAW_ORDER[n] ?? 0] as Slot;

const edgeMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

// ---------------------------------------------------------------- ring

let ringShadowTex: Texture | null = null;
let ringShadowGeo: PlaneGeometry | null = null;

/** A soft annulus under the ring of cards. */
function ringShadow() {
  if (!ringShadowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0.38, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.84, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.98, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    }
    ringShadowTex = new CanvasTexture(c);
  }
  ringShadowGeo ??= new PlaneGeometry(2 * (RX + 0.42), 2 * (RZ + 0.42)).rotateX(-Math.PI / 2);
  return { map: ringShadowTex, geometry: ringShadowGeo };
}

/** The face-down circle: two instanced meshes (top + paper edge) for all 52 cards. */
function Ring({ count, back }: { count: number; back: string }) {
  const geo = cardGeometries();
  const top = useRef<InstancedMesh>(null);
  const edge = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const topMat = useMemo(() => cardMaterial(cardBackTexture(back)), [back]);
  const shadow = ringShadow();
  useEffect(() => () => topMat.dispose(), [topMat]);

  useLayoutEffect(() => {
    const meshes = [top.current, edge.current];
    if (meshes.some((m) => !m)) return;
    const d = new Object3D();
    let n = 0;
    for (let i = DECK_SIZE - count; i < DECK_SIZE; i++) {
      const s = slotOfDraw(i);
      d.position.set(s.x, s.y, s.z);
      d.rotation.set(0, s.yaw, 0);
      d.scale.setScalar(RING_SCALE);
      d.updateMatrix();
      for (const m of meshes) m?.setMatrixAt(n, d.matrix);
      n++;
    }
    for (const m of meshes) {
      if (!m) continue;
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    invalidate();
  }, [count, topMat, invalidate]);

  return (
    <group>
      <mesh geometry={shadow.geometry} position={[CX, 0.0024, CZ]} renderOrder={-1}>
        <meshBasicMaterial
          map={shadow.map}
          color="#000000"
          transparent
          depthWrite={false}
          opacity={0.12 + 0.38 * (count / DECK_SIZE)}
        />
      </mesh>
      <instancedMesh ref={top} args={[geo.front, topMat, DECK_SIZE]} frustumCulled={false} />
      <instancedMesh ref={edge} args={[geo.edge, edgeMaterial, DECK_SIZE]} frustumCulled={false} />
    </group>
  );
}

// ---------------------------------------------------------------- the King's Cup

/** Inner wall radius at height y (the liquid fills to it). */
const innerRadius = (y: number) => {
  const r0 = CUP_R_BOT - 0.008;
  const r1 = CUP_R_TOP - 0.006;
  return r0 + ((r1 - r0) * (y - INNER_BOT)) / (CUP_H - 0.01 - INNER_BOT);
};

/** Liquid height for a number of kings poured (0 = dry). The fourth fills it to just under the rim. */
const levelFor = (kings: number) =>
  INNER_BOT + (Math.min(Math.max(kings, 0), 4) / 4) * (CUP_H - 0.07 - INNER_BOT);

function cupGeometries() {
  const outerR = (y: number) => CUP_R_BOT + ((CUP_R_TOP - CUP_R_BOT) * y) / CUP_H;
  const v = (r: number, y: number) => new Vector2(r, y);
  // Party cup: flat foot, two moulded steps, rolled lip.
  const outer = [
    v(0.0001, 0.002),
    v(CUP_R_BOT - 0.012, 0),
    v(CUP_R_BOT, 0.01),
    v(outerR(0.12), 0.12),
    v(outerR(0.12) + 0.005, 0.128),
    v(outerR(0.29) + 0.005, 0.29),
    v(outerR(0.29) + 0.009, 0.298),
    v(CUP_R_TOP + 0.009, CUP_H - 0.004),
    v(CUP_R_TOP + 0.013, CUP_H + 0.004),
    v(CUP_R_TOP + 0.009, CUP_H + 0.012),
    v(CUP_R_TOP + 0.001, CUP_H + 0.012),
    v(CUP_R_TOP - 0.004, CUP_H + 0.004),
  ];
  const inner = [
    v(CUP_R_TOP - 0.004, CUP_H + 0.004),
    v(CUP_R_TOP - 0.006, CUP_H - 0.01),
    v(CUP_R_BOT - 0.008, INNER_BOT),
    v(0.0001, INNER_BOT),
  ];
  return {
    outer: new LatheGeometry(outer, 40),
    inner: new LatheGeometry(inner, 40),
    liquid: new CircleGeometry(1, 40).rotateX(-Math.PI / 2),
    foam: new RingGeometry(0.82, 1, 40, 1).rotateX(-Math.PI / 2),
  };
}

/** Emission as a fraction of the cup colour (see KingsCup). */
const CUP_SELF_LIGHT = 0.32;

function KingsCup({ kings }: { kings: number }) {
  const cupColor = useTheme((s) => s.theme.cupColor);
  const invalidate = useThree((s) => s.invalidate);
  const geos = useMemo(() => cupGeometries(), []);
  const outerMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: cupColor,
        // The pendant lights the cup from straight above, so its walls only catch grazing light
        // and a red cup read dark maroon. A share of its own colour as emission stands in for the
        // bounce off the felt and the room, and keeps any theme colour reading as itself.
        emissive: cupColor,
        emissiveIntensity: CUP_SELF_LIGHT,
        roughness: 0.38,
        metalness: 0,
        envMapIntensity: 0.9,
      }),
    [cupColor],
  );
  const innerMat = useMemo(
    () => new MeshStandardMaterial({ color: '#f1ebe0', roughness: 0.55, side: DoubleSide }),
    [],
  );
  const liquidMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#8f520e',
        emissive: '#2a1203',
        roughness: 0.12,
        metalness: 0.05,
        envMapIntensity: 1.4,
      }),
    [],
  );
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  useEffect(() => () => outerMat.dispose(), [outerMat]);
  useEffect(() => () => innerMat.dispose(), [innerMat]);
  const foamMat = useMemo(
    () => new MeshStandardMaterial({ color: '#f4e7c6', roughness: 0.95 }),
    [],
  );
  useEffect(() => () => liquidMat.dispose(), [liquidMat]);
  useEffect(() => () => foamMat.dispose(), [foamMat]);

  const liquid = useRef<Group>(null);
  // Where the surface is now and where it is heading; a resumed game starts already filled.
  const level = useRef({ now: levelFor(kings), target: levelFor(kings) });
  const poured = useRef(kings);

  useEffect(() => {
    const t = window.setTimeout(
      () => {
        level.current.target = levelFor(kings);
        invalidate();
      },
      reducedMotion() ? 0 : POUR_DELAY_MS,
    );
    return () => window.clearTimeout(t);
  }, [kings, invalidate]);

  // A king: everyone's pour glugs into the cup as the level rises (the fourth one is the big one).
  useEffect(() => {
    if (kings <= poured.current) {
      poured.current = kings;
      return;
    }
    poured.current = kings;
    const delay = reducedMotion() ? 0 : POUR_DELAY_MS / 1000;
    play('pour.beer', { delay, gain: kings >= 4 ? 1 : 0.85 });
    hapticLater(kings >= 4 ? 'impactHeavy' : 'impactMedium', delay * 1000);
    if (kings >= 4) {
      duck(-6, 2200);
      play('game.sting', { delay: delay + 0.6 });
    }
  }, [kings]);

  useFrame((state, dt) => {
    const m = liquid.current;
    if (!m) return;
    const l = level.current;
    if (Math.abs(l.now - l.target) > 0.0004) {
      easing.damp(l, 'now', l.target, 0.35, Math.min(dt, 0.05));
      state.invalidate();
    } else {
      l.now = l.target;
    }
    m.visible = l.now > INNER_BOT + 0.004;
    m.position.y = l.now;
    const r = innerRadius(l.now) - 0.002;
    m.scale.set(r, 1, r);
  });

  return (
    <group position={[CX, 0, CUP_Z]}>
      <BlobShadow position={[0.02, 0.0026, 0.04]} scale={[0.46, 1, 0.36]} opacity={0.7} />
      <mesh geometry={geos.outer} material={outerMat} />
      <mesh geometry={geos.inner} material={innerMat} />
      {/* Everyone's pour: a murky amber surface with a foam collar against the wall. */}
      <group ref={liquid} visible={false}>
        <mesh geometry={geos.liquid} material={liquidMat} />
        <mesh geometry={geos.foam} material={foamMat} position-y={0.0015} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- face-up pile

/** Small deterministic "dropped by hand" offsets so the pile doesn't look machine-stacked. */
function restPose(card: Card, index: number): { x: number; z: number; yaw: number } {
  const a = Math.sin(card * 12.9898 + index * 78.233) * 43758.5453;
  const r = a - Math.floor(a);
  const b = Math.sin(card * 39.3468 + index * 11.135) * 24634.6345;
  const q = b - Math.floor(b);
  return { x: (r - 0.5) * 0.05, z: (q - 0.5) * 0.04, yaw: (r - 0.5) * 0.2 };
}

/** Faces are point-symmetric, so the landing yaw can be any half-turn of the rest yaw: pick the nearest. */
const nearestYaw = (from: number, rest: number) =>
  rest + Math.round((from - rest) / Math.PI) * Math.PI;

interface PileCardProps {
  card: Card;
  index: number;
  level: number;
  back: string;
  /** When set, the card is pulled out of this ring slot, flipped and landed on the pile. */
  from: Slot | null;
}

function PileCard({ card, index, level, back, from }: PileCardProps) {
  const group = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const rest = useMemo(() => restPose(card, index), [card, index]);
  const restY = PILE_BASE + level * PILE_STEP + (CARD_T * LAND_SCALE) / 2;
  const restX = LAND_X + rest.x;
  const restZ = LAND_Z + rest.z;
  // Only decided at mount: a resumed game shows the pile still, a fresh draw animates.
  const anim = useRef(
    from === null
      ? null
      : {
          from,
          yawTo: nearestYaw(from.yaw, rest.yaw),
          start: -1,
          duration: reducedMotion() ? 0.15 : FLIGHT_SECONDS,
        },
  );

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    invalidate();
    // Pulled out of the ring, flipped over the cup, down in front of the players.
    cardFlight(a.duration, { pan: Math.max(-0.5, Math.min(0.5, a.from.x * 0.5)) });
    haptic('select');
  }, [invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = group.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.start < 0) a.start = now;
    const raw = Math.min((now - a.start) / a.duration, 1);
    const e = easing.cubic.inOut(raw);
    const x = a.from.x + (restX - a.from.x) * e;
    const z = a.from.z + (restZ - a.from.z) * e;
    const y = a.from.y + (restY - a.from.y) * e + Math.sin(Math.PI * raw) * ARC_HEIGHT;
    g.position.set(x, y, z);
    g.rotation.set(0, a.from.yaw + (a.yawTo - a.from.yaw) * e, Math.PI * (1 - e));
    g.scale.setScalar(RING_SCALE + (LAND_SCALE - RING_SCALE) * e);
    if (shadow.current) {
      shadow.current.position.set(x, 0.0028, z);
      const m = shadow.current.material as MeshBasicMaterial;
      m.opacity = 0.5 * (1 - Math.min((y - restY) / ARC_HEIGHT, 1) * 0.8);
    }
    if (raw < 1) state.invalidate();
    else anim.current = null;
  });

  const moving = from !== null;
  const pos: [number, number, number] = moving ? [from.x, from.y, from.z] : [restX, restY, restZ];
  const rot: [number, number, number] = moving ? [0, from.yaw, Math.PI] : [0, rest.yaw, 0];
  return (
    <>
      <Card3D
        ref={group}
        card={card}
        back={back}
        position={pos}
        rotation={rot}
        scale={moving ? RING_SCALE : LAND_SCALE}
      />
      {level === 0 || moving ? (
        <BlobShadow
          ref={shadow}
          position={[pos[0], 0.0028, pos[2]]}
          scale={LAND_SCALE}
          opacity={0.5}
        />
      ) : null}
    </>
  );
}

/**
 * Kings Cup: the deck fanned face down in a circle around the King's Cup. Each draw pulls a card
 * out of the circle, flips it and lands it face up in front of the cup; every king drawn pours a
 * little more into the cup.
 */
export default function KingsCupScene({ view }: GameViewProps<View>) {
  const back = useTheme((s) => s.theme.cardBack);
  // Cards already drawn when the scene mounted (e.g. after a reload) are not animated again.
  const [mountDrawn] = useState(view.drawn.length);
  const drawn = view.drawn.length;
  const fresh = drawn > mountDrawn;

  const visible = view.drawn.slice(-3);
  const offset = drawn - visible.length;

  return (
    <group>
      <Ring count={view.deckCount} back={back} />
      <KingsCup kings={view.kingsDrawn} />
      {visible.map((card, i) => {
        const index = offset + i;
        const isTop = i === visible.length - 1;
        return (
          <PileCard
            key={`${index}:${card}`}
            card={card}
            index={index}
            level={i}
            back={back}
            from={isTop && fresh ? slotOfDraw(index) : null}
          />
        );
      })}
    </group>
  );
}
