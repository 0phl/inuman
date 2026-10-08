import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Group,
  type Mesh,
} from 'three';
import { useFrame, useThree, type ThreeElements } from '@react-three/fiber';
import type { PlayerId } from '@/core/engine/types';
import type { LastAnswer, View } from '@/core/games/ride-the-bus/logic';
import type { Card } from '@/core/primitives/deck';
import { useTheme } from '@/store/theme';
import { BlobShadow } from '@/three/BlobShadow';
import { Card3D } from '@/three/Card3D';
import { Deck3D } from '@/three/Deck3D';
import { CARD_H, CARD_T, CARD_W, cardGeometries, deckHeight } from '@/three/cardGeometry';
import { cardBackTexture, cardMaterial } from '@/three/cardTextures';
import { clamp01, easeInOut, easeOut, reducedMotion } from '../mexico/dice3d';
import { GlowDisc } from '../mexico/diceKit';
import { Nameplate } from '../spin-the-bottle/seatKit';
import { ovalSeats, type PlateTone } from '../spin-the-bottle/seats';
import type { GameViewProps } from '../types';
import { atlasFaceMaterial } from './atlas';
import { slotTexture } from './slots';

type V3 = [number, number, number];

/** The four spots of a deal hand or a bus run, across the near half of the felt. */
const HAND_Z = 0.5;
const HAND_SCALE = 0.6;
const HAND_DX = 0.47;
const DECK: V3 = [0, 0.001, -0.4];
const DECK_SCALE = 0.62;
/** Everyone's seat: a U round the back of the table, open toward the camera. */
const SEAT_CZ = -0.38;
const SEAT_RX = 0.92;
const SEAT_RZ = 0.82;
/** Pyramid rows from the bottom (nearest) up; x spacing; card size. */
const PYR_Z = [0.74, 0.31, -0.12, -0.55] as const;
const PYR_DX = 0.37;
const PYR_SCALE = 0.48;

const FLY_S = 0.72;
const ARC = 0.5;
const FLIP_S = 0.6;
const HOLD_MS = 1700;
const CRASH_HOLD_S = 0.75;
const CRASH_SWEEP_S = 0.85;
const CRASH_MS = Math.round((FLY_S + CRASH_HOLD_S + CRASH_SWEEP_S) * 1000) + 150;
const MATCH_MS = 2700;
const RIGHT = '#7ee08a';
const WRONG = '#ff5a3c';
const MATCH_GLOW = '#f3c977';

const handX = (i: number) => (i - 1.5) * HAND_DX;
/** Stable empty list, so "no bus yet" never reads as a change. */
const NO_CARDS: Card[] = [];

function pyramidPos(i: number): V3 {
  let start = 0;
  for (let r = 0; r < 4; r++) {
    const count = 4 - r;
    if (i < start + count) {
      const j = i - start;
      return [(j - (count - 1) / 2) * PYR_DX, 0.004 + r * 0.002, PYR_Z[r] as number];
    }
    start += count;
  }
  return [0, 0.004, 0];
}

function seatLayout(n: number) {
  const span = n <= 1 ? 0 : Math.min(Math.PI + 0.35, (n - 1) * 0.62);
  const seats = ovalSeats(n, {
    cz: SEAT_CZ,
    rx: SEAT_RX,
    rz: SEAT_RZ,
    span,
    centre: Math.PI * 1.5,
  });
  const chord = n <= 1 ? 1 : (span / (n - 1)) * Math.sqrt((SEAT_RX ** 2 + SEAT_RZ ** 2) / 2);
  return {
    seats,
    plate: Math.min(0.42, Math.max(0.26, chord * 0.92)),
    fan: Math.min(0.3, Math.max(0.2, chord * 0.62)),
  };
}

// ---------------------------------------------------------------- small cards

let slotGeo: PlaneGeometry | null = null;

/** An empty spot on the felt: dashed outline and its question number. */
function Slot({ n, active, position }: { n: number; active: boolean; position: V3 }) {
  slotGeo ??= new PlaneGeometry(CARD_W, CARD_H).rotateX(-Math.PI / 2);
  const mat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: slotTexture(n, active),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [n, active],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh
      geometry={slotGeo}
      material={mat}
      position={position}
      scale={HAND_SCALE}
      renderOrder={-1}
    />
  );
}

/** A small face-up card that never turns over: one mesh with its atlas face. */
function FlatCard({
  card,
  ref,
  ...group
}: { card: Card; ref?: Ref<Group> } & Omit<ThreeElements['group'], 'ref'>) {
  const geo = cardGeometries();
  return (
    <group ref={ref} {...group}>
      <mesh geometry={geo.front} material={atlasFaceMaterial(card)} />
    </group>
  );
}

/** Fan layout: card k of `count`, nudged sideways and splayed a little. */
function fanPose(k: number, count: number, scale: number): { x: number; y: number; yaw: number } {
  const off = k - (count - 1) / 2;
  return { x: off * scale * 0.29, y: 0.002 + k * 0.0016, yaw: -off * 0.13 };
}

/** A pyramid match leaving a hand: it lifts and glows, then flies to the pyramid card and is gone. */
function LeavingCard({ card, from, to, scale }: { card: Card; from: V3; to: V3; scale: number }) {
  const group = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const t0 = useRef(-1);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const now = performance.now() / 1000;
    if (t0.current < 0) t0.current = now;
    const t = now - t0.current;
    const quick = reducedMotion();
    const lift = easeOut(clamp01((t - 0.5) / 0.35));
    const fly = easeInOut(clamp01((t - (quick ? 1.2 : 1.75)) / 0.5));
    const x = from[0] + (to[0] - from[0]) * fly;
    const z = from[2] + (to[2] - from[2]) * fly;
    const y = from[1] + lift * 0.1 + Math.sin(Math.PI * fly) * 0.3;
    g.position.set(x, y, z);
    g.scale.setScalar(scale * (1 + 0.25 * lift) * (1 - fly * 0.85));
    g.visible = fly < 1;
    if (glow.current) {
      glow.current.position.set(from[0], 0.003, from[2]);
      glow.current.visible = lift > 0 && fly < 0.4;
    }
    if (t < 2.4) state.invalidate();
  });
  return (
    <>
      <GlowDisc
        ref={glow}
        radius={scale * 0.75}
        color={MATCH_GLOW}
        opacity={0.95}
        visible={false}
      />
      <FlatCard ref={group} card={card} position={from} scale={scale} />
    </>
  );
}

function SeatFan({
  name,
  tone,
  glow,
  seat,
  cards,
  leaving,
  leaveTo,
  plate,
  fan,
  showCards,
}: {
  name: string;
  tone: PlateTone;
  glow: string | null;
  seat: { x: number; z: number; phi: number };
  cards: readonly Card[];
  leaving: readonly Card[];
  leaveTo: V3;
  plate: number;
  fan: number;
  showCards: boolean;
}) {
  const yaw = -Math.cos(seat.phi) * 0.3;
  const fx = seat.x;
  const fz = seat.z - 0.06;
  const all = showCards ? [...cards, ...leaving] : [];
  return (
    <group>
      <Nameplate
        name={name}
        tone={tone}
        width={plate}
        glow={glow}
        position={[seat.x, 0, seat.z + fan * 0.62 + 0.04]}
        rotation-y={yaw}
      />
      {all.length > 0 && (
        <BlobShadow position={[fx, 0.0022, fz]} scale={[fan * 1.3, 1, fan * 0.85]} opacity={0.45} />
      )}
      {all.map((card, k) => {
        const p = fanPose(k, all.length, fan);
        const pos: V3 = [fx + p.x, p.y, fz];
        if (k >= cards.length) {
          return (
            <LeavingCard key={`out:${card}`} card={card} from={pos} to={leaveTo} scale={fan} />
          );
        }
        return (
          <FlatCard key={card} card={card} position={pos} rotation-y={yaw + p.yaw} scale={fan} />
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------- the hand row

/** Lands a big card in its spot: from the deck top, flipping over in an arc; then the right/wrong flash. */
function HandCard({
  card,
  slot,
  back,
  fly,
  deckTop,
  flash,
}: {
  card: Card;
  slot: number;
  back: string;
  fly: boolean;
  deckTop: number;
  flash: boolean | null;
}) {
  const group = useRef<Group>(null);
  const glow = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const restY = (CARD_T * HAND_SCALE) / 2 + 0.002;
  const to: V3 = [handX(slot), restY, HAND_Z];
  const [anim] = useState(() => (fly ? { dur: reducedMotion() ? 0.2 : FLY_S } : null));
  const t0 = useRef(-1);
  const [from] = useState<V3>(() => [DECK[0], deckTop, DECK[2]]);
  const done = useRef(!fly);
  useEffect(() => invalidate(), [invalidate]);

  useFrame((state) => {
    const g = group.current;
    if (!anim || !g) return;
    const now = performance.now() / 1000;
    if (t0.current < 0) t0.current = now;
    const t = now - t0.current;
    const raw = clamp01(t / anim.dur);
    const e = easeInOut(raw);
    if (!done.current) {
      g.position.set(
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e + Math.sin(Math.PI * raw) * ARC,
        from[2] + (to[2] - from[2]) * e,
      );
      g.rotation.set(0, 0, Math.PI * (1 - e));
      g.scale.setScalar(DECK_SCALE + (HAND_SCALE - DECK_SCALE) * e);
      if (raw >= 1) done.current = true;
    }
    const m = glow.current;
    if (m && flash !== null) {
      const f = clamp01((t - anim.dur) / 1.4);
      m.visible = t >= anim.dur && f < 1;
      (m.material as MeshBasicMaterial).opacity = 0.95 * (1 - f) * (1 - f);
    }
    if (t < anim.dur + 1.45) state.invalidate();
  });

  return (
    <>
      {flash !== null && (
        <GlowDisc
          ref={glow}
          radius={0.5}
          color={flash ? RIGHT : WRONG}
          opacity={0.95}
          position={[to[0], 0.003, to[2]]}
          visible={false}
        />
      )}
      <BlobShadow position={[to[0], 0.0025, to[2]]} scale={HAND_SCALE} opacity={0.5} />
      <Card3D
        ref={group}
        card={card}
        back={back}
        position={fly ? from : to}
        rotation={fly ? [0, 0, Math.PI] : [0, 0, 0]}
        scale={fly ? DECK_SCALE : HAND_SCALE}
      />
    </>
  );
}

/** A failed bus run: the wrong card lands, then the whole run drives off the table to the left. */
function CrashRow({
  cards,
  back,
  deckTop,
}: {
  cards: readonly Card[];
  back: string;
  deckTop: number;
}) {
  const row = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const t0 = useRef(-1);
  useEffect(() => invalidate(), [invalidate]);
  useFrame((state) => {
    const g = row.current;
    if (!g) return;
    const now = performance.now() / 1000;
    if (t0.current < 0) t0.current = now;
    const t = now - t0.current;
    // Reduced motion: the run just clears once the wrong card is down.
    const s = reducedMotion()
      ? t > 0.6
        ? 1
        : 0
      : clamp01((t - FLY_S - CRASH_HOLD_S) / CRASH_SWEEP_S);
    const e = s * s * s;
    // A little lurch back first, like a jeep pulling out, then away it goes.
    g.position.x = -Math.sin(Math.min(s, 0.25) * Math.PI * 4) * 0.06 - e * 3.2;
    g.rotation.y = e * 0.25;
    g.visible = s < 1;
    if (s < 1) state.invalidate();
  });
  const wrong = cards.length - 1;
  return (
    <group ref={row}>
      {cards.map((card, i) => (
        <HandCard
          key={`${i}:${card}`}
          card={card}
          slot={i}
          back={back}
          fly={i === wrong}
          deckTop={deckTop}
          flash={i === wrong ? false : null}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- pyramid

function PyramidCard({
  index,
  card,
  backMat,
  dealDelay,
  glow,
}: {
  index: number;
  card: Card | null;
  backMat: MeshStandardMaterial;
  dealDelay: number | null;
  glow: boolean;
}) {
  const geo = cardGeometries();
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const pos = pyramidPos(index);
  const restY = pos[1] + (CARD_T * PYR_SCALE) / 2;
  const [mountCard] = useState(card);
  const anim = useRef<{ t0: number; kind: 'deal' | 'flip'; delay: number } | null>(
    dealDelay !== null ? { t0: -1, kind: 'deal', delay: dealDelay } : null,
  );
  const flipped = card !== null && mountCard === null;
  useEffect(() => {
    if (!flipped) return;
    anim.current = { t0: -1, kind: 'flip', delay: 0 };
    invalidate();
  }, [flipped, invalidate]);
  useEffect(() => invalidate(), [invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = group.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.t0 < 0) a.t0 = now;
    const t = now - a.t0 - a.delay;
    const quick = reducedMotion();
    if (a.kind === 'deal') {
      const raw = clamp01(t / (quick ? 0.1 : 0.4));
      g.visible = t >= 0;
      g.position.y = restY + (1 - easeOut(raw)) * 0.9;
      g.rotation.set(0, (1 - raw) * 0.6, Math.PI);
      if (raw < 1) state.invalidate();
      else anim.current = null;
      return;
    }
    const raw = clamp01(t / (quick ? 0.15 : FLIP_S));
    const e = easeInOut(raw);
    g.position.y = restY + Math.sin(Math.PI * raw) * 0.32;
    g.rotation.set(0, 0, Math.PI * (1 - e));
    if (raw < 1) state.invalidate();
    else anim.current = null;
  });

  const front = card === null ? backMat : atlasFaceMaterial(card);
  const faceUp = card !== null && !flipped;
  return (
    <>
      {glow && (
        <GlowDisc
          radius={0.36}
          color={MATCH_GLOW}
          opacity={0.85}
          position={[pos[0], 0.003, pos[2]]}
        />
      )}
      <BlobShadow position={[pos[0], 0.0024, pos[2]]} scale={PYR_SCALE} opacity={0.45} />
      <group
        ref={group}
        position={[pos[0], restY, pos[2]]}
        rotation={[0, 0, faceUp ? 0 : Math.PI]}
        scale={PYR_SCALE}
        visible={dealDelay === null}
      >
        <mesh geometry={geo.front} material={front} />
        <mesh geometry={geo.back} material={backMat} />
        <mesh geometry={geo.edge} material={edgeMaterial} />
      </group>
    </>
  );
}

const edgeMaterial = new MeshStandardMaterial({ color: '#efe6d2', roughness: 0.8 });

// ---------------------------------------------------------------- the scene

interface Seen {
  last: LastAnswer | null;
  hands: Card[][];
  busCards: Card[];
  flipped: number;
}

/**
 * Ride the Bus. Deal: whoever is answering has their four spots across the near felt; each
 * answer flies a card off the deck and flips it into the next spot, flashing green or red. Every
 * other hand sits face up in a little fan by its owner's plaque round the back. Pyramid: ten cards
 * face down, 4-3-2-1; each FLIP turns one, and the matching cards in everyone's hands light up
 * and fly to it. Bus: the rider's run fills the same four spots; a miss lands the wrong card and
 * the whole run drives off the table.
 */
export default function RideTheBusScene({ view, players }: GameViewProps<View>) {
  const back = useTheme((s) => s.theme.cardBack);
  const n = view.order.length;
  const layout = useMemo(() => seatLayout(n), [n]);
  const nameOf = (id: PlayerId) => players.find((p) => p.id === id)?.name ?? '?';
  const backMat = useMemo(() => cardMaterial(cardBackTexture(back)), [back]);
  useEffect(() => () => backMat.dispose(), [backMat]);

  // What was on the table before this update, to tell which change just happened.
  const busCards = view.bus?.cards ?? NO_CARDS;
  const [seen, setSeen] = useState<Seen>(() => ({
    last: view.last,
    hands: view.hands,
    busCards,
    flipped: view.flipped,
  }));
  const [mountLast] = useState(view.last);
  const [mountPyramid] = useState(view.pyramid.length > 0);
  const [held, setHeld] = useState<LastAnswer | null>(null);
  const [crash, setCrash] = useState<{ last: LastAnswer; cards: Card[] } | null>(null);
  const [match, setMatch] = useState<{ flipped: number; removed: Card[][] } | null>(null);

  if (
    view.last !== seen.last ||
    view.hands !== seen.hands ||
    view.flipped !== seen.flipped ||
    busCards !== seen.busCards
  ) {
    const last = view.last;
    if (last && last !== seen.last) {
      // A deal hand that just got its 4th card stays up a moment before the next player's spots.
      if (last.phase === 'deal' && (view.phase !== 'deal' || view.current !== last.player)) {
        setHeld(last);
      }
      if (last.phase === 'bus' && !last.correct)
        setCrash({ last, cards: [...seen.busCards, last.card] });
    }
    if (view.flipped > seen.flipped) {
      const removed = seen.hands.map((h, i) => h.filter((c) => !(view.hands[i] ?? []).includes(c)));
      setMatch({ flipped: view.flipped, removed });
    }
    setSeen({ last: view.last, hands: view.hands, busCards, flipped: view.flipped });
  }

  useEffect(() => {
    if (!held) return;
    const id = window.setTimeout(() => setHeld(null), HOLD_MS);
    return () => window.clearTimeout(id);
  }, [held]);
  useEffect(() => {
    if (!crash) return;
    const id = window.setTimeout(() => setCrash(null), CRASH_MS);
    return () => window.clearTimeout(id);
  }, [crash]);
  useEffect(() => {
    if (!match) return;
    const id = window.setTimeout(() => setMatch(null), MATCH_MS);
    return () => window.clearTimeout(id);
  }, [match]);

  const phase = view.phase;
  const riding = phase === 'bus' || (phase === 'over' && view.bus !== null);
  // Whose spots are across the near felt.
  const owner: PlayerId | null = held
    ? held.player
    : phase === 'deal'
      ? view.current
      : riding
        ? (view.bus?.rider ?? null)
        : null;
  const ownerSeat = owner ? view.order.indexOf(owner) : -1;
  const rowCards: readonly Card[] = riding && !held ? busCards : (view.hands[ownerSeat] ?? []);
  const showRow = owner !== null && !crash;
  const showPyramid =
    !held && view.pyramid.length > 0 && (phase === 'pyramid' || phase === 'board');
  const showDeck = !showPyramid && phase !== 'over' && view.deckCount > 0;
  const deckTop = deckHeight(view.deckCount + 1) * DECK_SCALE + CARD_T;
  const fresh = view.last !== null && view.last !== mountLast;
  const lastCard = view.last?.card;
  const flippedIdx = match ? match.flipped - 1 : -1;
  const leaveTo: V3 = flippedIdx >= 0 ? pyramidPos(flippedIdx) : [0, 0, 0];
  const rider = view.bus?.rider ?? null;

  return (
    <group>
      {showDeck && (
        <group position={DECK} scale={DECK_SCALE}>
          <Deck3D count={view.deckCount} back={back} />
          <BlobShadow position={[0, 0.002, 0]} opacity={0.6} />
        </group>
      )}

      {showRow && (
        <group>
          {[0, 1, 2, 3].map((i) =>
            rowCards[i] === undefined ? (
              <Slot
                key={`slot${i}`}
                n={i + 1}
                active={i === rowCards.length && !held && (phase === 'deal' || phase === 'bus')}
                position={[handX(i), 0.003, HAND_Z]}
              />
            ) : null,
          )}
          {rowCards.map((card, i) => {
            const newest =
              fresh &&
              i === rowCards.length - 1 &&
              card === lastCard &&
              view.last?.player === owner;
            return (
              <HandCard
                key={`${owner}:${i}:${card}`}
                card={card}
                slot={i}
                back={back}
                fly={newest}
                deckTop={deckTop}
                flash={newest ? (view.last?.correct ?? null) : null}
              />
            );
          })}
        </group>
      )}
      {crash && (
        <CrashRow key={crash.cards.join(',')} cards={crash.cards} back={back} deckTop={deckTop} />
      )}

      {showPyramid &&
        view.pyramid.map((p, i) => (
          <PyramidCard
            key={i}
            index={i}
            card={p.card}
            backMat={backMat}
            dealDelay={mountPyramid ? null : i * 0.07}
            glow={i === flippedIdx && (match?.removed.some((r) => r.length > 0) ?? false)}
          />
        ))}

      {view.order.map((id, i) => {
        const s = layout.seats[i];
        if (!s) return null;
        const leaving = match?.removed[i] ?? [];
        const isOwner = i === ownerSeat && showRow;
        const tone: PlateTone =
          leaving.length > 0
            ? 'picked'
            : (phase === 'deal' && id === (held?.player ?? view.current)) || id === rider
              ? 'turn'
              : 'idle';
        return (
          <SeatFan
            key={id}
            name={nameOf(id)}
            tone={tone}
            glow={
              leaving.length > 0 ? MATCH_GLOW : id === rider && phase !== 'over' ? '#f3c977' : null
            }
            seat={s}
            cards={view.hands[i] ?? []}
            leaving={leaving}
            leaveTo={leaveTo}
            plate={layout.plate}
            fan={layout.fan}
            showCards={!isOwner}
          />
        );
      })}
    </group>
  );
}
