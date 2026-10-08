import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Quaternion, Vector3, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import {
  lockDice,
  ROLE_FACE,
  ROLES,
  type Die,
  type Role,
  type View,
} from '@/core/games/ship-captain-crew/logic';
import type { Face } from '@/core/primitives/dice';
import { DiceReplay, type DiceSettleResult } from '@/physics/DiceReplay';
import { DIE_SIZE, type TraySpec } from '@/physics/diceConfig';
import { TABLE_Y } from '@/stage/tableSpace';
import { useTheme } from '@/store/theme';
import { Die3D } from '@/three/Die3D';
import {
  brassMaterial,
  clamp01,
  easeInOut,
  faceUpQuaternion,
  hash01,
  narraMaterial,
  reducedMotion,
} from '../mexico/dice3d';
import { DiceTray, DieShadow } from '../mexico/diceKit';
import type { GameViewProps } from '../types';
import { plaqueTexture, slotTexture } from './plaques';

type V3 = [number, number, number];
type Q4 = [number, number, number, number];
interface Pose {
  p: V3;
  q: Q4;
}

/** The tray sits back; the ship / captain / crew dock runs along its near side, closest to you. */
const TRAY: TraySpec = { width: 1.8, depth: 1.15, wallHeight: 0.2, backHeight: 0.4 };
const TRAY_POS: V3 = [0, TABLE_Y, -0.6];
const DOCK_Z = 0.32;
const DOCK_H = 0.035;
const DOCK_W = 1.74;
const DOCK_D = 0.66;
const SLOT = 0.36;
const SLOT_X: Readonly<Record<Role, number>> = { ship: -0.56, captain: 0, crew: 0.56 };
const PLAQUE_Z = DOCK_Z + 0.25;
const PLAQUE_W = 0.48;
const PLAQUE_H = 0.12;
const SLIDE_DELAY = 0.35;
const SLIDE_SECONDS = 0.75;
const SLIDE_ARC = 0.38;

/** Dice placed in the tray without physics (a resumed turn): a loose row across the felt. */
function tidyPose(i: number, face: Face): Pose {
  const x = TRAY_POS[0] + (i - 2) * 0.32 + (hash01(i * 7.1) - 0.5) * 0.06;
  const z = TRAY_POS[2] + 0.08 + (hash01(i * 3.3) - 0.5) * 0.2;
  const q = faceUpQuaternion(face, (hash01(i * 5.7) - 0.5) * 0.9);
  return { p: [x, TABLE_Y + DIE_SIZE / 2, z], q: [q.x, q.y, q.z, q.w] };
}

function dockPose(role: Role, face: Face): Pose {
  const q = faceUpQuaternion(face, (hash01(ROLE_FACE[role] * 1.7) - 0.5) * 0.18);
  return { p: [SLOT_X[role], TABLE_Y + DOCK_H + DIE_SIZE / 2, DOCK_Z], q: [q.x, q.y, q.z, q.w] };
}

/** World pose of every rendered die under a DiceReplay, by die index (via `indices`). */
function readPoses(root: Group | null, indices: readonly number[]): (Pose | null)[] {
  const out: (Pose | null)[] = Array<Pose | null>(5).fill(null);
  const p = new Vector3();
  const q = new Quaternion();
  root?.traverse((o) => {
    const k: unknown = o.userData.dieIndex;
    if (typeof k !== 'number') return;
    const die = indices[k];
    if (die === undefined) return;
    o.getWorldPosition(p);
    o.getWorldQuaternion(q);
    out[die] = { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] };
  });
  return out;
}

/** A die resting in the tray where the throw left it. */
function RestingDie({ pose, theme }: { pose: Pose; theme: string }) {
  return (
    <>
      <Die3D materialId={theme} position={pose.p} quaternion={pose.q} />
      <DieShadow position={[pose.p[0], TABLE_Y + 0.004, pose.p[2]]} opacity={0.5} />
    </>
  );
}

/** A locked die on its dock slot; a freshly locked one hops over from where it landed. */
function DockDie({
  role,
  face,
  from,
  theme,
}: {
  role: Role;
  face: Face;
  from: Pose | null;
  theme: string;
}) {
  const die = useRef<Mesh>(null);
  const shadow = useRef<Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  // Decided once at mount: later renders (from → null) must not move anything back.
  const [to] = useState(() => dockPose(role, face));
  const [start] = useState<Pose>(() => from ?? to);
  const [shadowAt] = useState<V3>(() => [
    start.p[0],
    TABLE_Y + 0.004 + (from ? 0 : DOCK_H),
    start.p[2],
  ]);
  const anim = useRef(
    from
      ? {
          t0: -1,
          delay: reducedMotion() ? 0 : SLIDE_DELAY,
          dur: reducedMotion() ? 0.12 : SLIDE_SECONDS,
          qa: new Quaternion(...from.q),
          qb: new Quaternion(...to.q),
        }
      : null,
  );

  useEffect(() => {
    if (anim.current) invalidate();
  }, [invalidate]);

  useFrame((state) => {
    const a = anim.current;
    const m = die.current;
    if (!a || !m) return;
    const now = performance.now() / 1000;
    if (a.t0 < 0) a.t0 = now;
    const raw = clamp01((now - a.t0 - a.delay) / a.dur);
    const e = easeInOut(raw);
    const x = start.p[0] + (to.p[0] - start.p[0]) * e;
    const z = start.p[2] + (to.p[2] - start.p[2]) * e;
    const y = start.p[1] + (to.p[1] - start.p[1]) * e + Math.sin(Math.PI * raw) * SLIDE_ARC;
    m.position.set(x, y, z);
    m.quaternion.slerpQuaternions(a.qa, a.qb, e);
    const sh = shadow.current;
    if (sh) {
      sh.position.set(x, TABLE_Y + 0.004 + (z > DOCK_Z - DOCK_D / 2 ? DOCK_H : 0), z);
      (sh.material as MeshBasicMaterial).opacity =
        0.5 * (1 - Math.min(1, (y - to.p[1]) * 1.6) * 0.7);
    }
    if (raw < 1) state.invalidate();
    else anim.current = null;
  });

  return (
    <>
      <Die3D ref={die} materialId={theme} position={start.p} quaternion={start.q} />
      <DieShadow ref={shadow} position={shadowAt} opacity={0.5} />
    </>
  );
}

/** The narra plank in front of the tray: three felt slots and an engraved brass plaque under each. */
function Dock({ filled }: { filled: Readonly<Record<Role, boolean>> }) {
  const { t } = useTranslation();
  const invalidate = useThree((s) => s.invalidate);
  const plaques = useMemo(
    () =>
      ROLES.map((role) => {
        const map = plaqueTexture(t(`scc.hud.${role}`).toUpperCase(), invalidate);
        return { role, map };
      }),
    // `t` changes with the language, which re-labels the plaques.
    [t, invalidate],
  );
  return (
    <group position={[0, TABLE_Y, 0]}>
      <mesh position={[0, DOCK_H / 2, DOCK_Z + 0.06]} material={narraMaterial()}>
        <boxGeometry args={[DOCK_W, DOCK_H, DOCK_D]} />
      </mesh>
      <mesh
        position={[0, DOCK_H / 2 + 0.0005, DOCK_Z + 0.06 + DOCK_D / 2 + 0.001]}
        material={brassMaterial()}
      >
        <boxGeometry args={[DOCK_W + 0.004, 0.012, 0.004]} />
      </mesh>
      {plaques.map(({ role, map }) => (
        <group key={role}>
          <mesh rotation-x={-Math.PI / 2} position={[SLOT_X[role], DOCK_H + 0.002, DOCK_Z]}>
            <planeGeometry args={[SLOT, SLOT]} />
            <meshStandardMaterial map={slotTexture(ROLE_FACE[role])} roughness={1} transparent />
          </mesh>
          {/* Plaques lean back a little toward the players. */}
          <mesh rotation-x={-Math.PI / 2 + 0.42} position={[SLOT_X[role], DOCK_H + 0.03, PLAQUE_Z]}>
            <planeGeometry args={[PLAQUE_W, PLAQUE_H]} />
            <meshStandardMaterial
              map={map}
              metalness={0.3}
              roughness={0.45}
              transparent
              emissive="#e8b04a"
              emissiveIntensity={filled[role] ? 0.22 : 0}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

interface Snapshot {
  rollId: number;
  /** The dice after that roll: faces plus locks (computed like the reducer's settle). */
  dice: Die[];
  /** Where each thrown die came to rest, by die index. */
  poses: (Pose | null)[];
  /** Dice that locked on that roll: they hop to the dock. */
  fresh: number[];
}

/**
 * Ship, Captain & Crew: five dice. Only the unlocked dice are thrown (a fresh DiceReplay per
 * roll); when they settle, every die is frozen where it landed and the newly locked ones hop over
 * to their dock slot (6 ship, 5 captain, 4 crew). The dock clears when the next player throws.
 */
export default function SccScene({ view, dispatch }: GameViewProps<View>) {
  const theme = useTheme((s) => s.theme.diceMaterialId);
  const replay = useRef<Group>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const roll = view.roll;
  const inFlight = roll !== null && !roll.settled;

  const onSettled = (r: DiceSettleResult) => {
    if (!roll || roll.settled || r.rollId !== roll.id) return;
    const poses = readPoses(replay.current, roll.indices);
    const thrown: Die[] = view.dice.map((d) => ({ ...d }));
    roll.indices.forEach((die, k) => {
      thrown[die] = { face: roll.faces[k] as Face, lockedAs: null };
    });
    const dice = lockDice(thrown);
    const fresh = dice.flatMap((d, i) => (d.lockedAs && !view.dice[i]?.lockedAs ? [i] : []));
    setSnap({ rollId: r.rollId, dice, poses, fresh });
    dispatch({ type: 'GAME', action: { type: 'SETTLED', rollId: r.rollId } });
  };

  // What lies on the table outside the throw.
  let table: { dice: Die[]; poses: (Pose | null)[]; fresh: number[] } | null = null;
  if (inFlight) table = { dice: view.dice, poses: [], fresh: [] };
  else if (snap && roll && snap.rollId === roll.id) table = snap;
  else if (view.rollsUsed > 0) {
    table = {
      dice: view.dice,
      poses: view.dice.map((d, i) => (d.face && !d.lockedAs ? tidyPose(i, d.face) : null)),
      fresh: [],
    };
  }

  const filled: Record<Role, boolean> = { ship: false, captain: false, crew: false };
  for (const d of table?.dice ?? []) if (d.lockedAs) filled[d.lockedAs] = true;

  return (
    <group>
      <DiceTray tray={TRAY} position={TRAY_POS} />
      <Dock filled={filled} />
      {inFlight && roll && (
        <DiceReplay
          key={roll.id}
          ref={replay}
          targets={roll.faces}
          rollId={roll.id}
          tray={TRAY}
          showTray={false}
          theme={theme}
          onSettled={onSettled}
          position={TRAY_POS}
        />
      )}
      {table?.dice.map((d, i) => {
        if (d.face === null) return null;
        if (d.lockedAs) {
          return (
            <DockDie
              key={`dock:${d.lockedAs}`}
              role={d.lockedAs}
              face={d.face}
              from={table.fresh.includes(i) ? (table.poses[i] ?? null) : null}
              theme={theme}
            />
          );
        }
        const pose = table.poses[i];
        return pose ? <RestingDie key={`tray:${i}`} pose={pose} theme={theme} /> : null;
      })}
    </group>
  );
}
