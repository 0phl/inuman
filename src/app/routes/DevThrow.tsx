import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useSearchParams } from 'react-router';
import { RingGeometry, type Camera } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { AimPreview } from '@/physics/AimPreview';
import {
  CUP_RIM_TUBE,
  CUP_TOP_RADIUS,
  DEFAULT_GLASS_POSITION,
  rackLayout,
  reRackSize,
  THROW_SETUPS,
  type RackSize,
  type ThrowKind,
  type ThrowTarget,
  type Vec3,
} from '@/physics/throwConfig';
import { ThrowReplay } from '@/physics/ThrowReplay';
import { isMade, useThrowReplay } from '@/physics/useThrowReplay';
import type { ThrowResult } from '@/physics/throwSim';
import {
  aimAssist,
  flickToThrow,
  useFlick,
  type AssistedThrow,
  type AssistLevel,
  type CameraLike,
  type Flick,
} from '@/physics/useFlick';
import { useStage } from '@/stage/stageStore';
import { sceneTunnel } from '@/stage/tunnel';
import { CupInstances, type CupInstance } from '@/three/Cup3D';
import { ShotGlass3D } from '@/three/ShotGlass3D';

// Dev test bench for the skill throws (/dev/throw, dev builds only): a beer-pong rack (10/6/3 and
// the standard re-racks) and a quarters glass. Swipe up from the bottom of the screen to throw.
// `?hold` keeps a made ball/coin where it landed until the next throw (for screenshots).

type Mode = 'pong' | 'quarters';
const FORMATIONS: readonly RackSize[] = [10, 6, 3];
const LEVELS: readonly AssistLevel[] = [0, 1, 2, 3];
const GLASS: ThrowTarget[] = [{ id: 'glass', position: DEFAULT_GLASS_POSITION }];
/** How long a made ball/coin sits in its target before the cup goes / the coin comes back. */
const SHOW_MADE_MS = 650;
const TWEEN_S = 0.42;

interface Stats {
  throws: number;
  made: number;
  bounced: number;
}
const NO_STATS: Stats = { throws: 0, made: 0, bounced: 0 };

/** Hands the live R3F camera to the DOM side (flick → world mapping). */
function CameraProbe({ intoRef }: { intoRef: RefObject<Camera | null> }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    intoRef.current = camera;
  }, [camera, intoRef]);
  return null;
}

interface RackCup {
  id: string;
  from: Vec3;
  to: Vec3;
  /** 1 = standing; animates to 0 when removed. */
  life: number;
  removing: boolean;
}

/**
 * The rack: slides cups to new spots (re-rack) and lifts/shrinks hit cups away, then draws them
 * all with CupInstances. Only re-renders while something moves.
 */
function AnimatedRack({ cups }: { cups: readonly ThrowTarget[] }) {
  const state = useRef<{ list: RackCup[]; start: number }>({ list: [], start: -1 });
  const [display, setDisplay] = useState<CupInstance[]>([]);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const prev = new Map(state.current.list.map((c) => [c.id, c]));
    const now = performance.now() / 1000;
    const k = Math.min(1, (now - state.current.start) / TWEEN_S);
    const list: RackCup[] = cups.map((c) => {
      const p = prev.get(c.id);
      const at: Vec3 = p
        ? [p.from[0] + (p.to[0] - p.from[0]) * k, 0, p.from[2] + (p.to[2] - p.from[2]) * k]
        : [...c.position];
      return { id: c.id, from: at, to: [...c.position], life: 1, removing: false };
    });
    for (const p of prev.values()) {
      if (!cups.some((c) => c.id === p.id) && !p.removing)
        list.push({ ...p, from: p.to, removing: true });
    }
    state.current = { list, start: now };
    invalidate();
  }, [cups, invalidate]);

  useFrame((three) => {
    const s = state.current;
    if (s.start < 0) return;
    const t = Math.min(1, (performance.now() / 1000 - s.start) / TWEEN_S);
    const e = t * t * (3 - 2 * t);
    setDisplay(
      s.list
        .map((c): CupInstance | null => {
          if (c.removing) {
            const k = 1 - e;
            return k <= 0.01
              ? null
              : { position: [c.to[0], 0.25 * e, c.to[2]], scale: k, tilt: [0.5 * e, 0] };
          }
          return {
            position: [
              c.from[0] + (c.to[0] - c.from[0]) * e,
              0,
              c.from[2] + (c.to[2] - c.from[2]) * e,
            ],
          };
        })
        .filter((c): c is CupInstance => c !== null),
    );
    if (t < 1) three.invalidate();
    else {
      s.list = s.list.filter((c) => !c.removing).map((c) => ({ ...c, from: c.to }));
      s.start = -1;
    }
  });

  return <CupInstances cups={display} />;
}

let ringGeo: RingGeometry | null = null;
/** Outlines on the felt where a re-rack would put the cups. */
function RerackGhosts({ spots }: { spots: readonly ThrowTarget[] }) {
  ringGeo ??= new RingGeometry(CUP_TOP_RADIUS - 0.012, CUP_TOP_RADIUS + CUP_RIM_TUBE, 40).rotateX(
    -Math.PI / 2,
  );
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [spots, invalidate]);
  return (
    <group>
      {spots.map((s) => (
        <mesh
          key={s.id}
          geometry={ringGeo ?? undefined}
          position={[s.position[0], 0.004, s.position[2]]}
          renderOrder={1}
        >
          <meshBasicMaterial color="#ffe9b0" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

const describe = (r: ThrowResult): string => {
  if (r.kind === 'ball') {
    const b = r.bounces ? ` after ${r.bounces} bounce${r.bounces > 1 ? 's' : ''}` : '';
    return r.hit ? `Sink! ${r.hit}${b}` : `Miss${r.bounces ? ` (${r.bounces} bounces)` : ''}`;
  }
  if (r.made) return r.bounced ? 'Made it — bounced in' : 'In, but no bounce';
  return r.bounced ? 'Miss — bounced' : 'Miss — no bounce';
};

/** Do two layouts put cups in the same spots (any order)? */
const sameSpots = (a: readonly ThrowTarget[], b: readonly ThrowTarget[]) =>
  a.length === b.length &&
  a.every((p) =>
    b.some((q) => Math.hypot(p.position[0] - q.position[0], p.position[2] - q.position[2]) < 0.02),
  );

/** Moves each standing cup to a slot of `spots`, greedily keeping moves short. */
function reRack(cups: readonly ThrowTarget[], spots: readonly ThrowTarget[]): ThrowTarget[] {
  const free = [...spots];
  return cups.map((c) => {
    let best = 0;
    let bestD = Infinity;
    free.forEach((s, i) => {
      const d = Math.hypot(c.position[0] - s.position[0], c.position[2] - s.position[2]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [spot] = free.splice(best, 1);
    return { id: c.id, position: spot ? [...spot.position] : c.position };
  });
}

export default function DevThrow() {
  const want = useStage((s) => s.want);
  const camera = useRef<Camera | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const replay = useThrowReplay();
  const [mode, setMode] = useState<Mode>('pong');
  const [level, setLevel] = useState<AssistLevel>(2);
  const [formation, setFormation] = useState<RackSize>(10);
  const [cups, setCups] = useState<ThrowTarget[]>(() => rackLayout(10));
  const [aim, setAim] = useState<AssistedThrow | null>(null);
  const [last, setLast] = useState<string>('—');
  const [lastMs, setLastMs] = useState(0);
  const [lastFlick, setLastFlick] = useState<Flick | null>(null);
  const [stats, setStats] = useState<Record<Mode, Stats>>({ pong: NO_STATS, quarters: NO_STATS });
  const throwCount = useRef(0);
  const [params] = useSearchParams();
  const hold = params.has('hold');

  useEffect(() => want(), [want]);

  const kind: ThrowKind = mode === 'pong' ? 'ball' : 'coin';
  const targets = mode === 'pong' ? cups : GLASS;
  const setup = THROW_SETUPS[kind];
  const idle: Vec3 = useMemo(() => [0, setup.handY, setup.handZ], [setup]);

  const preview = reRackSize(cups.length);
  const previewSpots = useMemo(
    () => (preview ? rackLayout(preview, { prefix: 'ghost-' }) : []),
    [preview],
  );
  const showGhosts =
    mode === 'pong' && preview !== null && cups.length > 0 && !sameSpots(cups, previewSpots);

  const rackUp = (n: RackSize) => {
    replay.clear();
    setFormation(n);
    setCups(rackLayout(n));
  };

  const toThrow = (flick: Flick): AssistedThrow | null => {
    const cam = camera.current as (Camera & CameraLike) | null;
    if (!cam || !('fov' in cam)) return null;
    const raw = flickToThrow(flick, cam, kind, { targets });
    return aimAssist(level, raw, targets);
  };

  const { dragging, zoneStyle } = useFlick({
    target: zone,
    enabled: !replay.busy && targets.length > 0,
    onAim: (f) => setAim(f && level >= 2 ? toThrow(f) : null),
    onFlick: (f) => {
      setLastFlick(f);
      const thrown = toThrow(f);
      setAim(null);
      if (!thrown) return;
      const n = ++throwCount.current;
      const m = mode;
      void replay
        .throwAndReplay({
          kind,
          origin: thrown.origin,
          impulse: thrown.impulse,
          targets,
          // Math.random is fine in a dev bench (a game seeds from its session RNG).
          seed: (Math.random() * 2 ** 32) >>> 0,
        })
        .then((sim) => {
          if (n !== throwCount.current) return;
          const r = sim.result;
          setLast(describe(r));
          setLastMs(sim.ms);
          setStats((s) => ({
            ...s,
            [m]: {
              throws: s[m].throws + 1,
              made: s[m].made + (isMade(r) ? 1 : 0),
              bounced: s[m].bounced + ((r.kind === 'ball' ? r.bounces > 0 : r.bounced) ? 1 : 0),
            },
          }));
          if (hold && isMade(r)) return;
          window.setTimeout(
            () => {
              if (n !== throwCount.current) return;
              if (r.kind === 'ball' && r.hit) setCups((c) => c.filter((x) => x.id !== r.hit));
              replay.clear();
            },
            isMade(r) ? SHOW_MADE_MS : 250,
          );
        });
    },
  });

  const st = stats[mode];
  const rate = st.throws ? Math.round((100 * st.made) / st.throws) : 0;

  return (
    <main
      className="pointer-events-none relative flex h-dvh flex-col gap-2 overflow-hidden px-3 pt-[calc(env(safe-area-inset-top)+10px)] pb-[calc(env(safe-area-inset-bottom)+12px)] select-none"
      data-testid="dev-throw"
    >
      <sceneTunnel.In>
        <CameraProbe intoRef={camera} />
        {mode === 'pong' ? (
          <>
            <AnimatedRack cups={cups} />
            {showGhosts && <RerackGhosts spots={previewSpots} />}
          </>
        ) : (
          <ShotGlass3D position={DEFAULT_GLASS_POSITION} />
        )}
        <ThrowReplay
          playback={replay.playback}
          kind={kind}
          idle={replay.busy ? null : idle}
          ballColor="orange"
        />
        <AimPreview aim={aim} targets={targets} />
      </sceneTunnel.In>

      <section
        className="panel pointer-events-auto mx-auto w-full max-w-[528px] p-3 text-sm"
        data-testid="throw-report"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="eyebrow">Throw bench</h1>
          <span data-testid="throw-status" className="font-bold text-capiz-200">
            {replay.busy ? 'in flight' : dragging ? 'aiming' : 'ready'}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span data-testid="last-result" className="truncate text-base font-bold text-capiz-50">
            {last}
          </span>
          <span className="shrink-0 text-xs text-capiz-300 tabular-nums">
            <b data-testid="hits" className="text-capiz-50">
              {st.made}
            </b>
            /<b data-testid="throws">{st.throws}</b> ·{' '}
            <b data-testid="hit-rate" className="text-tubig-300">
              {rate}%
            </b>{' '}
            · {lastMs.toFixed(1)} ms
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-capiz-300 tabular-nums" data-testid="last-flick">
          {lastFlick
            ? `flick power ${lastFlick.power.toFixed(2)} · ${lastFlick.speed.toFixed(2)} h/s · ${Math.round((Math.atan2(lastFlick.direction[0], -lastFlick.direction[1]) * 180) / Math.PI)}°`
            : 'flick —'}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(['pong', 'quarters'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn min-h-10 px-2 text-xs ${mode === m ? 'btn-brass' : 'btn-wood'}`}
              onClick={() => {
                replay.clear();
                setMode(m);
                setLast('—');
              }}
              data-testid={`mode-${m}`}
            >
              {m === 'pong' ? 'Beer pong' : 'Quarters'}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="w-12 shrink-0 text-xs text-capiz-300">Assist</span>
          <div className="grid flex-1 grid-cols-4 gap-1">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                className={`btn min-h-9 px-1 text-xs ${level === l ? 'btn-brass' : 'btn-wood'}`}
                onClick={() => setLevel(l)}
                data-testid={`assist-${l}`}
              >
                {l === 0 ? 'Off' : l}
              </button>
            ))}
          </div>
        </div>
        {mode === 'pong' && (
          <div className="mt-2 flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-capiz-300">Rack</span>
            <div className="grid flex-1 grid-cols-4 gap-1">
              {FORMATIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn min-h-9 px-1 text-xs ${formation === n && cups.length === n ? 'btn-brass' : 'btn-wood'}`}
                  onClick={() => rackUp(n)}
                  data-testid={`rack-${n}`}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-wood min-h-9 px-1 text-xs"
                disabled={!showGhosts}
                onClick={() => setCups((c) => reRack(c, previewSpots))}
                data-testid="rerack"
              >
                Re-rack
              </button>
            </div>
          </div>
        )}
      </section>

      <div
        ref={zone}
        style={zoneStyle}
        className="pointer-events-auto flex items-end justify-center rounded-3xl border-2 border-dashed border-capiz-50/15 pb-3"
        data-testid="throw-zone"
      >
        <span className="text-xs font-bold tracking-wide text-capiz-200/70 uppercase">
          {targets.length === 0 ? 'Rack cleared — pick a rack' : 'Swipe up to throw'}
        </span>
      </div>
    </main>
  );
}
