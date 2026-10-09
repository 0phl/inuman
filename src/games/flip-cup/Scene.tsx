import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { withHaptic } from '@/audio/cues';
import { play } from '@/audio/engine';
import type { View } from '@/core/games/flip-cup/logic';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import { Cup3D, type CupInstance } from '@/three/Cup3D';
import { TEAM_COLORS } from '../beer-pong/layout';
import { CameraProbe, TeamCups, TeamPlaque, TeamRim } from '../beer-pong/teamKit';
import { clamp01, easeInOut, reducedMotion } from '../mexico/dice3d';
import { GlowDisc } from '../mexico/diceKit';
import { settleOnce } from '../spin-the-bottle/settle';
import type { GameViewProps } from '../types';
import {
  FLIP_SPOT,
  flipDuration,
  flipEnd,
  flipKind,
  flipPose,
  lerpPose,
  onSide,
  PLAQUE_Z,
  poseToInstance,
  ROW_X,
  rowSlots,
  upright,
  upsideDown,
  type CupPose,
  type FlipKind,
} from './flip';

/** Cups slide between their row and the flip spot. */
const MOVE_S = 0.55;
const TEAMS: readonly TeamIndex[] = [0, 1];
const now = () => performance.now() / 1000;

interface Move {
  from: CupPose;
  to: CupPose;
  start: number;
}

interface FlipAnim {
  id: number;
  kind: FlipKind;
  start: number;
  reduced: boolean;
  done: boolean;
}

/** Where each leg's cup rests now: done legs back in their row, the current one at the spot. */
function restPoses(view: View): { pose: CupPose; scale: number }[] {
  const slots = rowSlots(view.legs);
  const over = view.phase === 'over';
  return view.legs.map((leg, i) => {
    const slot = slots[i] ?? { x: 0, z: 0, scale: 1 };
    if (i === view.leg && !over) {
      // After a flip that landed, it stays mouth down where it fell until the next leg starts.
      const f = view.flip;
      const landed = f?.settled && f.success && leg.result === 'flipped';
      return {
        pose: landed ? flipEnd('flip', FLIP_SPOT) : upright(FLIP_SPOT[0], FLIP_SPOT[2]),
        scale: 1,
      };
    }
    const p =
      leg.result === 'flipped'
        ? upsideDown(slot.x, slot.z, slot.scale)
        : leg.result === 'capped'
          ? onSide(slot.x, slot.z, slot.scale)
          : upright(slot.x, slot.z, slot.scale);
    return { pose: p, scale: slot.scale };
  });
}

/**
 * Flip Cup: each team's cups in a row down its side of the table (Team Pula left, Team Asul
 * right), the leg being played at the front edge in a team-coloured glow. FLIP_ATTEMPT's outcome
 * comes from the reducer; this plays it as a scripted flip (mouth down on a success; rocking back
 * or rolling onto its side on a miss) and then reports SETTLED.
 */
export default function FlipCupScene({ view, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const invalidate = useThree((s) => s.invalidate);
  const active = useRef<Group>(null);
  const over = view.phase === 'over';
  const rest = useMemo(() => restPoses(view), [view]);
  const moves = useRef(new Map<number, Move>());
  const shown = useRef(new Map<number, CupPose>());
  const anim = useRef<FlipAnim | null>(null);
  const [rows, setRows] = useState<{ team: TeamIndex; beer: boolean; cups: CupInstance[] }[]>([]);
  /** The row batches need rebuilding (new rest spots); otherwise only while a row cup slides. */
  const rowsStale = useRef(true);

  // New rest spots (a leg ended, a new one starts): slide the cups that moved.
  useEffect(() => {
    const t0 = now();
    const reduced = reducedMotion();
    rest.forEach((r, i) => {
      const was = shown.current.get(i);
      if (!was) {
        shown.current.set(i, r.pose);
        return;
      }
      const same =
        Math.abs(was.x - r.pose.x) + Math.abs(was.z - r.pose.z) + Math.abs(was.rx - r.pose.rx) <
        1e-3;
      if (same || (anim.current && !anim.current.done && i === view.leg)) return;
      moves.current.set(i, { from: was, to: r.pose, start: reduced ? t0 - MOVE_S : t0 });
    });
    rowsStale.current = true;
    invalidate();
  }, [rest, view.leg, invalidate]);

  // A new flip: play it, then report SETTLED (once; the Hud has a fallback if we never get here).
  const flip = view.flip;
  useEffect(() => {
    if (!flip || flip.settled || anim.current?.id === flip.id) return;
    const kind = flipKind(flip.success, flip.quality);
    const reduced = reducedMotion();
    anim.current = { id: flip.id, kind, start: now(), reduced, done: false };
    moves.current.delete(view.leg);
    // The flick, then a clean clack mouth-down, or the cup rocking back / tipping over. Times
    // follow the flip script in flip.ts.
    play('flip.whoosh', { delay: reduced ? 0 : 0.1 });
    if (kind === 'flip') withHaptic('flip.land', 'success', { delay: reduced ? 0.36 : 0.74 });
    else
      withHaptic('flip.fail', 'error', {
        delay: reduced ? 0.2 : kind === 'under' ? 0.42 : 0.72,
      });
    invalidate();
  }, [flip, view.leg, invalidate]);

  useFrame((three) => {
    const t = now();
    let moving = false;
    // Any slide this frame (its last one included) means the row batches change.
    let slid = false;
    const posed: { pose: CupPose; scale: number }[] = rest.map((r, i) => {
      const m = moves.current.get(i);
      if (!m) return { pose: shown.current.get(i) ?? r.pose, scale: r.scale };
      const k = clamp01((t - m.start) / MOVE_S);
      const pose = lerpPose(m.from, m.to, easeInOut(k), 0.12);
      slid = true;
      if (k >= 1) moves.current.delete(i);
      else moving = true;
      return { pose, scale: r.scale };
    });

    // The flipping cup follows its script.
    const a = anim.current;
    let activePose = posed[view.leg]?.pose;
    if (a && !a.done) {
      const el = t - a.start;
      activePose = flipPose(a.kind, el, FLIP_SPOT, a.reduced);
      if (el >= flipDuration(a.kind, a.reduced)) {
        a.done = true;
        activePose = flipEnd(a.kind, FLIP_SPOT);
        const id = a.id;
        settleOnce('fc', id, () =>
          dispatch({ type: 'GAME', action: { type: 'SETTLED', flipId: id } }),
        );
      } else moving = true;
    }
    posed.forEach((p, i) =>
      shown.current.set(i, i === view.leg && activePose ? activePose : p.pose),
    );

    const g = active.current;
    if (g) {
      g.visible = !over && activePose !== undefined;
      if (activePose) {
        const inst = poseToInstance(activePose, 1);
        g.position.set(...inst.position);
        g.rotation.set(inst.tilt[0], 0, inst.tilt[1]);
      }
    }

    if (moving) three.invalidate();
    // The flipping cup isn't in the rows: during a flip they stay as they are (no React work).
    if (!slid && !rowsStale.current) return;
    rowsStale.current = false;

    // Row cups: two batches per team, with beer (still to play) and without (done).
    const next = TEAMS.flatMap((team) =>
      [true, false].map((beer) => ({
        team,
        beer,
        cups: posed.flatMap((p, i) => {
          const leg = view.legs[i];
          if (!leg || leg.team !== team || (i === view.leg && !over)) return [];
          const full = leg.result === null;
          if (full !== beer) return [];
          return [poseToInstance(p.pose, p.scale)];
        }),
      })),
    );
    setRows((prev) =>
      prev.length === next.length &&
      prev.every(
        (r, i) =>
          r.team === next[i]?.team && r.beer === next[i]?.beer && sameCups(r.cups, next[i].cups),
      )
        ? prev
        : next,
    );
  });

  const leg = over ? null : view.legs[view.leg];
  const team = leg?.team ?? null;
  const drinking = view.phase === 'drink';

  return (
    <group>
      <CameraProbe />
      {rows.map((r) => (
        <TeamCups key={`${r.team}:${r.beer}`} team={r.team} cups={r.cups} beer={r.beer} />
      ))}
      {TEAMS.map((tm) => (
        <TeamPlaque
          key={tm}
          text={t(`bp.team.${tm}`)}
          team={tm}
          width={0.52}
          position={[tm === 0 ? -ROW_X : ROW_X, 0, PLAQUE_Z]}
        />
      ))}
      {team !== null && (
        <GlowDisc
          color={TEAM_COLORS[team].glow}
          opacity={0.55}
          radius={0.42}
          position={[FLIP_SPOT[0], 0.002, FLIP_SPOT[2] - 0.04]}
        />
      )}
      <group ref={active} visible={false}>
        <Cup3D beer={drinking} />
        {team !== null && <TeamRim team={team} />}
      </group>
    </group>
  );
}

function sameCups(a: readonly CupInstance[], b: readonly CupInstance[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return false;
    if (
      Math.abs(p.position[0] - q.position[0]) +
        Math.abs(p.position[1] - q.position[1]) +
        Math.abs(p.position[2] - q.position[2]) +
        Math.abs((p.tilt?.[0] ?? 0) - (q.tilt?.[0] ?? 0)) +
        Math.abs((p.scale ?? 1) - (q.scale ?? 1)) >
      1e-4
    )
      return false;
  }
  return true;
}
