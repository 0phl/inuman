import { useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Mesh, MeshBasicMaterial } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { easing } from 'maath';
import { cardFlight, outcome } from '@/audio/cues';
import { play } from '@/audio/engine';
import type { Card } from '@/core/primitives/deck';
import type { Rules, View } from '@/core/games/higher-lower/logic';
import { useTheme } from '@/store/theme';
import { BlobShadow } from '@/three/BlobShadow';
import { Card3D } from '@/three/Card3D';
import { Deck3D } from '@/three/Deck3D';
import { CARD_T, deckHeight } from '@/three/cardGeometry';
import type { GameViewProps } from '../types';

const DECK_X = -0.52;
const PILE_X = 0.52;
const Z = 0;
const PILE_STEP = 0.0068;
const FLIP_SECONDS = 0.78;
const ARC_HEIGHT = 0.6;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Small deterministic "dropped by hand" offsets so the pile doesn't look machine-stacked. */
function restPose(card: Card, index: number): { x: number; z: number; yaw: number } {
  const a = Math.sin(card * 12.9898 + index * 78.233) * 43758.5453;
  const r = a - Math.floor(a);
  const b = Math.sin(card * 39.3468 + index * 11.135) * 24634.6345;
  const q = b - Math.floor(b);
  return { x: (r - 0.5) * 0.06, z: (q - 0.5) * 0.05, yaw: (r - 0.5) * 0.16 };
}

interface PileCardProps {
  card: Card;
  index: number;
  level: number;
  back: string;
  /** When set, the card flies in from the deck top at this height. */
  fromDeckY: number | null;
}

function PileCard({ card, index, level, back, fromDeckY }: PileCardProps) {
  const group = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const rest = useMemo(() => restPose(card, index), [card, index]);
  const restY = level * PILE_STEP + CARD_T / 2;
  // Only decided at mount: a resumed game shows the pile still, a fresh draw animates.
  const anim = useRef(fromDeckY === null ? null : { from: fromDeckY, start: -1, duration: reducedMotion() ? 0.15 : FLIP_SECONDS });

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    invalidate();
    // Off the deck, over mid-arc, down on the pile (the pile sits right of centre).
    cardFlight(a.duration, { pan: 0.18 });
  }, [invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const g = group.current;
    if (!a || !g) return;
    const now = performance.now() / 1000;
    if (a.start < 0) a.start = now;
    const raw = Math.min((now - a.start) / a.duration, 1);
    const e = easing.cubic.inOut(raw);
    const x = DECK_X + (PILE_X + rest.x - DECK_X) * e;
    const z = Z + rest.z * e;
    const y = a.from + (restY - a.from) * e + Math.sin(Math.PI * raw) * ARC_HEIGHT;
    g.position.set(x, y, z);
    g.rotation.set(0, rest.yaw * e, Math.PI * (1 - e));
    if (shadow.current) {
      shadow.current.position.set(x, 0.0025, z);
      const m = shadow.current.material as MeshBasicMaterial;
      m.opacity = 0.5 * (1 - Math.min((y - restY) / ARC_HEIGHT, 1) * 0.75);
    }
    if (raw < 1) state.invalidate();
    else anim.current = null;
  });

  const startPos: [number, number, number] =
    fromDeckY === null ? [PILE_X + rest.x, restY, Z + rest.z] : [DECK_X, fromDeckY, Z];
  const startRot: [number, number, number] = fromDeckY === null ? [0, rest.yaw, 0] : [0, 0, Math.PI];

  return (
    <>
      <Card3D ref={group} card={card} back={back} position={startPos} rotation={startRot} />
      {level === 0 || fromDeckY !== null ? (
        <BlobShadow ref={shadow} position={[startPos[0], 0.0025, startPos[2]]} opacity={0.5} />
      ) : null}
    </>
  );
}

/** Deck on the left, face-up pile on the right; each guess flips the next card over onto the pile. */
export default function HigherLowerScene({ view, rules }: GameViewProps<View>) {
  const back = useTheme((s) => s.theme.cardBack);
  // The result showing when the scene mounted (e.g. after a reload) is not animated again.
  const [firstLast] = useState(view.last);
  const fresh = view.last !== null && view.last !== firstLast;

  // Tama / mali / tabla as the card lands; a streak that earned the safe pass rings higher.
  const last = view.last;
  const passAfter = (rules as Rules).passAfter;
  const streak = view.streak;
  useEffect(() => {
    if (!last || last === firstLast) return;
    const safe = last.outcome === 'correct' && passAfter > 0 && streak === 0;
    outcome(safe ? 'streak' : last.outcome, reducedMotion() ? 0.15 : FLIP_SECONDS);
  }, [last, firstLast, passAfter, streak]);

  // The deck ran out and the pile was shuffled back in.
  const deckCount = view.deckCount;
  const prevDeck = useRef(deckCount);
  useEffect(() => {
    if (deckCount > prevDeck.current) play('card.shuffle');
    prevDeck.current = deckCount;
  }, [deckCount]);

  const visible = view.pile.slice(-3);
  const offset = view.pile.length - visible.length;
  // The flying card leaves from the top of the deck as it was before the draw.
  const fromY = deckHeight(view.deckCount + 1) + CARD_T;

  return (
    <group>
      <Deck3D count={view.deckCount} back={back} position={[DECK_X, 0.001, Z]} />
      {view.deckCount > 0 && <BlobShadow position={[DECK_X, 0.0025, Z]} opacity={0.65} />}
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
            fromDeckY={isTop && fresh ? fromY : null}
          />
        );
      })}
    </group>
  );
}
