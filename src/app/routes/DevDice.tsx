import { useEffect, useRef, useState } from 'react';
import { Quaternion, type Group } from 'three';
import { topFace, type Face } from '@/core/primitives/dice';
import { DiceReplay, type DiceSettleResult } from '@/physics/DiceReplay';
import { useStage } from '@/stage/stageStore';
import { sceneTunnel } from '@/stage/tunnel';
import { DIE_MATERIAL_IDS, type DieMaterialId } from '@/three/diceTextures';

// Dev test bench for outcome-first dice (/dev/dice). Math.random is fine here: it stands in for the
// reducer's RNG. The visible faces are read back from the rendered meshes' world quaternions.

/** StageHost only reveals the canvas on /play; this bench borrows it while mounted. */
const SHOW_STAGE =
  '[data-testid="stage"]{visibility:visible!important;pointer-events:auto!important}';

const randomFace = (): Face => (1 + Math.floor(Math.random() * 6)) as Face;

interface Stats {
  rolls: number;
  dice: number;
  mismatches: number;
  cocked: number;
  retried: number;
  lastMs: number;
  maxMs: number;
}

const EMPTY: Stats = {
  rolls: 0,
  dice: 0,
  mismatches: 0,
  cocked: 0,
  retried: 0,
  lastMs: 0,
  maxMs: 0,
};

/** Top face of every rendered die mesh under `root`, by its `userData.dieIndex`. */
function readVisibleFaces(root: Group | null, count: number): (Face | null)[] {
  const out = Array<Face | null>(count).fill(null);
  const q = new Quaternion();
  root?.traverse((o) => {
    const i: unknown = o.userData.dieIndex;
    if (typeof i !== 'number' || i >= count) return;
    o.getWorldQuaternion(q); // refreshes world matrices, so this is exactly this frame's pose
    out[i] = topFace([q.x, q.y, q.z, q.w]).face;
  });
  return out;
}

export default function DevDice() {
  const want = useStage((s) => s.want);
  const group = useRef<Group>(null);
  const [targets, setTargets] = useState<Face[]>([]);
  const [rollId, setRollId] = useState(0);
  const [indices, setIndices] = useState<number[] | undefined>(undefined);
  const [theme, setTheme] = useState<DieMaterialId>('ivory');
  const [rolling, setRolling] = useState(false);
  const [visible, setVisible] = useState<(Face | null)[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY);

  useEffect(() => want(), [want]);

  const roll = (next: Face[], only?: number[]) => {
    setTargets(next);
    setIndices(only);
    setVisible([]);
    setRolling(true);
    setRollId((r) => r + 1);
  };

  const onSettled = (r: DiceSettleResult) => {
    if (targets.length === 0) return;
    const seen = readVisibleFaces(group.current, targets.length);
    const bad = seen.filter((f, i) => f !== targets[i]).length;
    setVisible(seen);
    setRolling(false);
    setStats((s) => ({
      rolls: s.rolls + 1,
      dice: s.dice + targets.length,
      mismatches: s.mismatches + bad,
      cocked: s.cocked + r.cocked.filter(Boolean).length,
      retried: s.retried + (r.attempts > 1 ? 1 : 0),
      lastMs: r.presimMs,
      maxMs: Math.max(s.maxMs, r.presimMs),
    }));
  };

  return (
    <main
      className="pointer-events-none relative flex h-dvh flex-col justify-between gap-3 overflow-hidden px-3 pt-[calc(env(safe-area-inset-top)+10px)] pb-[calc(env(safe-area-inset-bottom)+12px)] select-none"
      data-testid="dev-dice"
    >
      <style>{SHOW_STAGE}</style>
      <sceneTunnel.In>
        <DiceReplay
          ref={group}
          targets={targets}
          rollId={rollId}
          indices={indices}
          theme={theme}
          onSettled={onSettled}
          position={[0, 0, 0.15]}
        />
      </sceneTunnel.In>

      <section
        className="panel pointer-events-auto mx-auto w-full max-w-[528px] p-3 text-sm"
        data-testid="dice-report"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="eyebrow">Dice bench</h1>
          <span data-testid="dice-status" className="font-bold text-capiz-200">
            {rolling ? 'rolling' : stats.rolls ? 'settled' : 'idle'}
          </span>
        </div>
        <table className="mt-2 w-full text-center tabular-nums">
          <tbody>
            <tr>
              <th className="text-left font-normal text-capiz-300">Target</th>
              {targets.map((f, i) => (
                <td key={i} data-testid={`target-${i}`} className="font-bold">
                  {f}
                </td>
              ))}
            </tr>
            <tr>
              <th className="text-left font-normal text-capiz-300">Visible</th>
              {targets.map((f, i) => {
                const v = visible[i];
                return (
                  <td
                    key={i}
                    data-testid={`visible-${i}`}
                    className={
                      v == null
                        ? 'text-capiz-400'
                        : v === f
                          ? 'font-bold text-tubig-300'
                          : 'font-bold text-sili-500'
                    }
                  >
                    {v ?? '·'}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-xs text-capiz-300 tabular-nums">
          <div>
            rolls{' '}
            <b data-testid="rolls" className="text-capiz-50">
              {stats.rolls}
            </b>
          </div>
          <div>
            dice <b className="text-capiz-50">{stats.dice}</b>
          </div>
          <div>
            mismatches{' '}
            <b
              data-testid="mismatches"
              className={stats.mismatches ? 'text-sili-500' : 'text-tubig-300'}
            >
              {stats.mismatches}
            </b>
          </div>
          <div>
            cocked{' '}
            <b data-testid="cocked" className="text-capiz-50">
              {stats.cocked}
            </b>
          </div>
          <div>
            retried <b className="text-capiz-50">{stats.retried}</b>
          </div>
          <div>
            presim{' '}
            <b data-testid="presim-ms" className="text-capiz-50">
              {stats.lastMs.toFixed(1)}
            </b>
            /{stats.maxMs.toFixed(1)} ms
          </div>
        </dl>
      </section>

      <section className="pointer-events-auto mx-auto grid w-full max-w-[528px] gap-2">
        <div className="grid grid-cols-3 gap-2">
          {DIE_MATERIAL_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`btn min-h-10 px-2 text-xs ${theme === id ? 'btn-brass' : 'btn-wood'}`}
              onClick={() => setTheme(id)}
              data-testid={`theme-${id}`}
            >
              {id}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className="btn btn-brass min-h-12 px-2 text-sm"
            onClick={() => roll([randomFace(), randomFace()])}
            data-testid="roll-2"
          >
            Roll 2 random
          </button>
          <button
            type="button"
            className="btn btn-brass min-h-12 px-2 text-sm"
            onClick={() => roll(Array.from({ length: 5 }, randomFace))}
            data-testid="roll-5"
          >
            Roll 5 random
          </button>
          <button
            type="button"
            className="btn btn-wood min-h-12 px-2 text-sm"
            disabled={targets.length < 5}
            onClick={() =>
              roll(
                targets.map((f, i) => (i >= 2 ? randomFace() : f)),
                [2, 3, 4],
              )
            }
            data-testid="reroll-345"
          >
            Re-roll dice 3–5 only
          </button>
        </div>
      </section>
    </main>
  );
}
