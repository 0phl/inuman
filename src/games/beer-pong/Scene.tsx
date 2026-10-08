import { useEffect, useMemo, useRef, useState, type RefCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { Cup, Formation, View } from '@/core/games/beer-pong/logic';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import { AimPreview } from '@/physics/AimPreview';
import { BALL_RADIUS, CUP_BEER_LEVEL, type Vec3 } from '@/physics/throwConfig';
import { ThrowReplay } from '@/physics/ThrowReplay';
import { useThrowReplay } from '@/physics/useThrowReplay';
import { Ball3D } from '@/three/Ball3D';
import { Cup3D, type CupInstance } from '@/three/Cup3D';
import { clamp01, easeInOut, easeOut, reducedMotion } from '../mexico/dice3d';
import { GlowDisc } from '../mexico/diceKit';
import type { GameViewProps } from '../types';
import {
  defendingTargets,
  PLACARD,
  handPosition,
  rackCentroid,
  rackDepth,
  rackPose,
  rackToWorld,
  slotLocal,
  TEAM_COLORS,
  type RackPose,
} from './layout';
import { CameraProbe, TeamCups, TeamPlaque, TeamRim } from './teamKit';
import { useThrowBus } from './throwBus';

/** Re-rack: cups slide to their new slots. */
const TWEEN_S = 0.42;
/** A sunk cup is pulled out of the rack (with the ball in it) and taken away. */
const PULL_S = 0.62;
/** The two racks trade ends when the turn passes to the other team. */
const SWAP_S = 1.05;
/** How far the racks swing aside to pass each other. */
const SWAP_BULGE = 0.62;
const HAND = handPosition('ball');
const TEAMS: readonly TeamIndex[] = [0, 1];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, t: number) => easeInOut(clamp01((t - a) / (b - a)));
const now = () => performance.now() / 1000;
const motion = (s: number) => (reducedMotion() ? Math.min(s, 0.18) : s);

/**
 * A pose between two rack poses, turning and growing/shrinking about the rack's middle (not its
 * apex), and swinging `bulge` units aside at the halfway point so the two racks pass each other.
 */
function swingPose(
  a: RackPose,
  b: RackPose,
  centroid: [number, number],
  k: number,
  bulge: number,
  scale: number,
): RackPose {
  const c: Vec3 = [centroid[0], 0, centroid[1]];
  const ca = rackToWorld(a, c);
  const cb = rackToWorld(b, c);
  const yaw = lerp(a.yaw, b.yaw, k);
  const turned = rackToWorld({ x: 0, z: 0, yaw, scale }, c);
  return {
    x: lerp(ca[0], cb[0], k) + bulge * Math.sin(Math.PI * k) - turned[0],
    z: lerp(ca[2], cb[2], k) - turned[2],
    yaw,
    scale,
  };
}

interface Tween {
  list: { id: number; from: Vec3; to: Vec3 }[];
  start: number;
}

/** The rack's cups in its own frame; a re-rack slides them to their new slots. */
function useRackCups(cups: readonly Cup[], formation: Formation): CupInstance[] {
  const invalidate = useThree((s) => s.invalidate);
  const tween = useRef<Tween>({
    list: cups.map((c) => {
      const p = slotLocal(formation, c.slot);
      return { id: c.id, from: p, to: p };
    }),
    start: -1,
  });
  const [display, setDisplay] = useState<CupInstance[]>(() =>
    cups.map((c) => ({ position: slotLocal(formation, c.slot) })),
  );

  useEffect(() => {
    const s = tween.current;
    const k = s.start < 0 ? 1 : easeInOut(clamp01((now() - s.start) / motion(TWEEN_S)));
    const prev = new Map(s.list.map((c) => [c.id, c]));
    let moved = false;
    const list = cups.map((c) => {
      const to = slotLocal(formation, c.slot);
      const p = prev.get(c.id);
      const from: Vec3 = p
        ? [lerp(p.from[0], p.to[0], k), 0, lerp(p.from[2], p.to[2], k)]
        : [...to];
      if (Math.hypot(from[0] - to[0], from[2] - to[2]) > 1e-4) moved = true;
      return { id: c.id, from, to };
    });
    tween.current = { list, start: moved ? now() : -1 };
    if (!moved) setDisplay(list.map((c) => ({ position: c.to })));
    invalidate();
  }, [cups, formation, invalidate]);

  useFrame((three) => {
    const s = tween.current;
    if (s.start < 0) return;
    const t = clamp01((now() - s.start) / motion(TWEEN_S));
    const e = easeInOut(t);
    setDisplay(
      s.list.map((c) => ({
        position: [lerp(c.from[0], c.to[0], e), 0, lerp(c.from[2], c.to[2], e)],
      })),
    );
    if (t < 1) three.invalidate();
    else s.start = -1;
  });

  return display;
}

/** One team's rack: cups with team rims and a soft team-coloured glow on the felt under it. */
function Rack({
  team,
  cups,
  formation,
  groupRef,
}: {
  team: TeamIndex;
  cups: readonly Cup[];
  formation: Formation;
  groupRef: RefCallback<Group>;
}) {
  const display = useRackCups(cups, formation);
  const depth = rackDepth(formation);
  return (
    <group ref={groupRef}>
      {cups.length > 0 && (
        <GlowDisc
          color={TEAM_COLORS[team].glow}
          opacity={0.32}
          radius={0.55 + depth * 0.55}
          position={[0, 0.002, -depth / 2]}
        />
      )}
      <TeamCups team={team} cups={display} />
    </group>
  );
}

interface Pulled {
  key: string;
  team: TeamIndex;
  position: Vec3;
  start: number;
}

/** A sunk cup, ball inside, lifted out of the rack, tipped toward the players and taken away. */
function PulledCup({ cup, onDone }: { cup: Pulled; onDone(key: string): void }) {
  const ref = useRef<Group>(null);
  const done = useRef(false);
  useFrame((three) => {
    const g = ref.current;
    if (!g || done.current) return;
    const t = clamp01((now() - cup.start) / motion(PULL_S));
    const up = easeOut(clamp01(t / 0.55));
    const away = easeInOut(clamp01((t - 0.45) / 0.55));
    g.position.set(cup.position[0], 0.32 * up + 0.2 * away, cup.position[2] + 0.18 * away);
    g.rotation.set(0.42 * up, 0, 0);
    g.scale.setScalar(Math.max(0.001, 1 - away));
    if (t < 1) three.invalidate();
    else {
      done.current = true;
      g.visible = false;
      onDone(cup.key);
    }
  });
  return (
    <group ref={ref} position={cup.position}>
      <Cup3D shadow={false} />
      <TeamRim team={cup.team} />
      <Ball3D position={[0, CUP_BEER_LEVEL + BALL_RADIUS * 0.85, 0]} />
    </group>
  );
}

interface Swap {
  /** The team that was at the far end (moving to the near end). */
  from: TeamIndex;
  to: TeamIndex;
  start: number;
}

/**
 * Both racks on the table. The rack being shot at stands at the far end; the throwing team's own
 * rack at the near end, turned around. When the turn passes to the other team the racks trade
 * ends (a short slide, the camera never moves), after any sunk cup is out of the way.
 */
function Racks({ view }: { view: View }) {
  const { t } = useTranslation();
  const invalidate = useThree((s) => s.invalidate);
  const setSceneBusy = useThrowBus((s) => s.setSceneBusy);
  // Rack groups and plaques by team, posed every frame.
  const objs = useRef<{ racks: (Group | null)[]; plaques: (Group | null)[] }>({
    racks: [null, null],
    plaques: [null, null],
  });
  /** Sunk cups found by the effect below, handed to state on the next frame. */
  const queued = useRef<Pulled[]>([]);
  const far = useRef<TeamIndex>(view.defending);
  const swap = useRef<Swap | null>(null);
  const [pulled, setPulled] = useState<Pulled[]>([]);
  const pullEnd = useRef(0);
  const prevCups = useRef<[readonly Cup[], readonly Cup[]]>([
    view.teams[0].cups,
    view.teams[1].cups,
  ]);
  const teams = view.teams;
  const live = useRef(teams);
  useEffect(() => {
    live.current = teams;
  });

  // Sunk cups: pulled out of the rack where they stood.
  useEffect(() => {
    const out: Pulled[] = [];
    for (const team of TEAMS) {
      const before = prevCups.current[team];
      const nowCups = teams[team].cups;
      if (before === nowCups) continue;
      const pose = rackPose(far.current === team ? 'far' : 'near');
      for (const c of before) {
        if (nowCups.some((x) => x.id === c.id)) continue;
        // The slot it stood in before the hit (its rack's formation doesn't change on a hit).
        out.push({
          key: `${team}:${c.id}:${now()}`,
          team,
          position: rackToWorld(pose, slotLocal(teams[team].formation, c.slot)),
          start: now(),
        });
      }
    }
    prevCups.current = [teams[0].cups, teams[1].cups];
    if (out.length) {
      pullEnd.current = now() + motion(PULL_S);
      queued.current.push(...out);
      setSceneBusy(true);
      invalidate();
    }
  }, [teams, setSceneBusy, invalidate]);

  // The other team's turn: trade ends once the sunk cup is out.
  const defending = view.defending;
  useEffect(() => {
    const s = swap.current;
    if (s?.to === defending) return;
    if (s) {
      // Turned again mid-slide (only without a scene to wait for): finish that one at once.
      far.current = s.to;
      swap.current = null;
    }
    if (defending !== far.current) {
      swap.current = { from: far.current, to: defending, start: Math.max(now(), pullEnd.current) };
      setSceneBusy(true);
    }
    invalidate();
  }, [defending, setSceneBusy, invalidate]);

  useEffect(() => () => setSceneBusy(false), [setSceneBusy]);

  useFrame((three) => {
    if (queued.current.length) {
      const add = queued.current.splice(0);
      setPulled((p) => [...p, ...add]);
    }
    const tm = live.current;
    const s = swap.current;
    const k = s ? easeInOut(clamp01((now() - s.start) / motion(SWAP_S))) : 0;
    for (const team of TEAMS) {
      const g = objs.current.racks[team];
      const plaque = objs.current.plaques[team];
      const f = tm[team].formation;
      let pose: RackPose;
      let show: number;
      if (s && (team === s.from || team === s.to)) {
        const leaving = team === s.from;
        const a = rackPose(leaving ? 'far' : 'near');
        const b = rackPose(leaving ? 'near' : 'far');
        // Both racks turn the same way: far → near goes 0 → π, near → far π → 2π. The leaving
        // rack shrinks away over the near edge late; the arriving one grows in early.
        const bb = { ...b, yaw: leaving ? Math.PI : 2 * Math.PI };
        const size = leaving ? 1 - smooth(0.5, 1, k) : smooth(0, 0.45, k);
        pose = swingPose(
          { ...a, scale: 1 },
          { ...bb, scale: 1 },
          rackCentroid(f, tm[team].cups),
          k,
          leaving ? SWAP_BULGE : -SWAP_BULGE,
          size,
        );
        show = leaving ? clamp01(1 - k * 2.2) : clamp01(k * 2.2 - 1.2);
      } else {
        pose = rackPose(far.current === team ? 'far' : 'near');
        show = far.current === team ? 1 : 0;
      }
      if (g) {
        g.visible = pose.scale > 0.01;
        g.position.set(pose.x, 0, pose.z);
        g.rotation.set(0, pose.yaw, 0);
        g.scale.setScalar(Math.max(0.001, pose.scale));
      }
      if (plaque) {
        plaque.visible = show > 0.01;
        plaque.scale.setScalar(Math.max(0.001, easeOut(show)));
      }
    }
    if (s) {
      if (now() - s.start < motion(SWAP_S)) three.invalidate();
      else {
        far.current = s.to;
        swap.current = null;
        three.invalidate();
      }
    }
    const busy = swap.current !== null || now() < pullEnd.current;
    setSceneBusy(busy);
    // Keep frames coming until everything has landed, so the Hud is always told.
    if (busy) three.invalidate();
  });

  return (
    <group>
      {TEAMS.map((team) => (
        <Rack
          key={team}
          team={team}
          cups={teams[team].cups}
          formation={teams[team].formation}
          groupRef={(g) => {
            objs.current.racks[team] = g;
          }}
        />
      ))}
      {TEAMS.map((team) => (
        <group
          key={`p${team}`}
          ref={(g) => {
            objs.current.plaques[team] = g;
          }}
          position={[PLACARD.x, 0, PLACARD.z]}
          rotation-y={PLACARD.yaw}
          visible={false}
        >
          <TeamPlaque text={t(`bp.team.${team}`)} team={team} width={0.5} />
        </group>
      ))}
      {pulled.map((c) => (
        <PulledCup
          key={c.key}
          cup={c}
          onDone={(key) => setPulled((p) => p.filter((x) => x.key !== key))}
        />
      ))}
    </group>
  );
}

/**
 * Beer Pong: two racks of party cups (team-coloured rims) on the bar table. The Hud turns a flick
 * (or the "Tumira" hold) into a throw; this scene replays the pre-simulated ball (ThrowReplay),
 * shows the aim arc while dragging, pulls sunk cups out, and slides the racks around when the turn
 * passes so the thrower always throws away from the camera.
 */
export default function BeerPongScene({ view }: GameViewProps<View>) {
  const replay = useThrowReplay();
  const setRunner = useThrowBus((s) => s.setRunner);
  const setAim = useThrowBus((s) => s.setAim);
  const aim = useThrowBus((s) => s.aim);
  const { throwAndReplay, clear } = replay;
  useEffect(() => {
    setRunner({ run: throwAndReplay, clear });
    return () => {
      setRunner(null);
      setAim(null);
    };
  }, [throwAndReplay, clear, setRunner, setAim]);

  const targets = useMemo(() => defendingTargets(view), [view]);
  const over = view.phase === 'over';

  return (
    <group>
      <CameraProbe />
      <Racks view={view} />
      <ThrowReplay
        playback={replay.playback}
        kind="ball"
        idle={over ? null : HAND}
        ballColor="orange"
      />
      <AimPreview aim={aim} targets={targets} />
    </group>
  );
}
