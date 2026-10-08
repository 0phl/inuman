import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FORMATION_SLOTS,
  type Formation,
  type Rules,
  type View,
} from '@/core/games/beer-pong/logic';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import {
  aimAssist,
  flickToThrow,
  useFlick,
  type AssistedThrow,
  type AssistLevel,
  type Flick,
} from '@/physics/useFlick';
import { useFx } from '@/store/fx';
import { useSession } from '@/store/session';
import { Sheet } from '@/ui/Sheet';
import { useCompactToasts } from '@/ui/toastAnchor';
import { GameHeader } from '../truth-or-dare/hudKit';
import type { GameViewProps } from '../types';
import { DotsChip, HoldThrowButton, SwipeHint, TeamDot, TeamName } from './hudKit';
import {
  aimedThrow,
  defendingTargets,
  frontTarget,
  idealPower,
  parseTargetId,
  TEAM_COLORS,
  throwSeed,
} from './layout';
import { clearThrow, runThrow, sceneCamera, sleep, useThrowBus } from './throwBus';

/** A sunk ball sits in its cup this long before the cup comes out. */
const HIT_HOLD_MS = 520;
/** A miss shrinks away (ThrowReplay's MISS_FADE) before the ball is back in hand. */
const MISS_FADE_MS = 320;
/** The "Pasok!" / "Sablay!" banner. */
const BANNER_MS = 2400;

type Dispatch = GameViewProps<View>['dispatch'];

/** A formation as a little rack of dots, apex toward the thrower (bottom). */
function FormationGlyph({ formation, size = 56 }: { formation: Formation; size?: number }) {
  const slots = FORMATION_SLOTS[formation];
  const r = 0.46;
  const xs = slots.map((s) => s.x);
  const ys = slots.map((s) => s.y);
  const minX = Math.min(...xs) - r;
  const maxX = Math.max(...xs) + r;
  const maxY = Math.max(...ys) + r;
  const w = Math.max(maxX - minX, 2.2);
  const h = Math.max(maxY + r, 2.2);
  const cx = (minX + maxX) / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${cx - w / 2} ${-r - (h - maxY - r) / 2} ${w} ${h}`}
      aria-hidden
      className="shrink-0"
    >
      {slots.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          // y grows away from the thrower: draw it upward so the apex is at the bottom.
          cy={maxY - r - s.y}
          r={r - 0.05}
          className="fill-sili-500 stroke-capiz-50"
          strokeWidth={0.09}
        />
      ))}
    </svg>
  );
}

function RerackSheet({
  open,
  onClose,
  view,
  dispatch,
}: {
  open: boolean;
  onClose(): void;
  view: View;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const rack = view.teams[view.defending];
  const left = view.teams[view.turn].reracksLeft;
  return (
    <Sheet open={open} onClose={onClose} title={t('bp.hud.rerackPick')} testId="bp-rerack-sheet">
      <p className="mb-3 flex items-center gap-2 text-sm text-capiz-300">
        <TeamDot team={view.defending} />
        {t('bpui.rerackHint', { team: t(`bp.team.${view.defending}`), n: rack.cups.length })}
        <span className="ml-auto chip shrink-0">{t('bp.hud.reracksLeft', { n: left })}</span>
      </p>
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/8 bg-narra-950/50 px-3 py-2 opacity-80">
        <FormationGlyph formation={rack.formation} size={44} />
        <span className="flex min-w-0 flex-col">
          <span className="eyebrow">{t('bpui.rerackCurrent')}</span>
          <span className="font-bold text-capiz-200">
            {t(`bp.hud.formation.${rack.formation}`)}
          </span>
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {view.rerackOptions.map((f) => (
          <li key={f}>
            <button
              type="button"
              className="btn btn-wood h-auto min-h-28 w-full flex-col gap-2 py-3"
              onClick={() => {
                dispatch({ type: 'GAME', action: { type: 'RERACK', formation: f } });
                onClose();
              }}
              data-testid={`bp-formation-${f}`}
            >
              <FormationGlyph formation={f} />
              <span className="text-[0.95rem]">{t(`bp.hud.formation.${f}`)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Cups left per team, the throwing team lit up. */
function Scoreboard({ view }: { view: View }) {
  const { t } = useTranslation();
  const cell = (team: TeamIndex) => {
    const active = view.phase !== 'over' && view.turn === team;
    const won = view.winner === team;
    return (
      <span
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 py-1 ${
          active || won
            ? 'border-brass-400/80 bg-narra-950/90 shadow-[0_0_14px_-4px_rgb(232_176_74/0.6)]'
            : 'border-narra-600 bg-narra-950/75'
        }`}
        style={{ flexDirection: team === 0 ? 'row' : 'row-reverse' }}
        data-testid={`bp-cups-${team}`}
        data-left={view.cupsLeft[team]}
        aria-label={t('bpui.cupsAria', { team: t(`bp.team.${team}`), n: view.cupsLeft[team] })}
      >
        <TeamDot team={team} />
        <span className="truncate text-[0.8rem] font-bold text-capiz-200">
          {t(`bp.team.${team}`)}
        </span>
        <span
          className="ml-auto font-sign text-xl leading-none"
          style={{
            color: TEAM_COLORS[team].hud,
            marginLeft: team === 0 ? 'auto' : undefined,
            marginRight: team === 1 ? 'auto' : undefined,
          }}
        >
          {view.cupsLeft[team]}
        </span>
      </span>
    );
  };
  return (
    <div className="flex w-full max-w-[22rem] items-center gap-1.5" data-testid="bp-scoreboard">
      {cell(0)}
      <span className="shrink-0 text-xs font-bold text-capiz-400 uppercase">{t('bp.hud.vs')}</span>
      {cell(1)}
    </div>
  );
}

export default function BeerPongHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  // The table is the news: drink toasts shrink to chips so they never cover the cups.
  useCompactToasts(true);
  const r = rules as Rules;
  const level = r.aimAssist as AssistLevel;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const over = view.phase === 'over';
  const sceneBusy = useThrowBus((s) => s.sceneBusy);
  const setAim = useThrowBus((s) => s.setAim);
  const resultsShown = useFx((s) => s.resultsShown);
  const [flying, setFlying] = useState(false);
  const [sheet, setSheet] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setAim(null);
    };
  }, [setAim]);

  const targets = useMemo(() => defendingTargets(view), [view]);
  const front = frontTarget(targets);
  const canThrow = !over && !flying && !sceneBusy && !sheet && targets.length > 0;
  const ideal = useMemo(
    () => (level >= 2 && front ? idealPower('ball', front.position) : null),
    [level, front],
  );

  // "Pasok!" / "Sablay!" for throws made while this screen is up (not on a resume).
  const [mountThrow] = useState(view.lastThrow?.id ?? 0);
  const last = view.lastThrow && view.lastThrow.id > mountThrow ? view.lastThrow : null;
  const [bannerOff, setBannerOff] = useState(0);
  useEffect(() => {
    if (!last) return;
    const id = last.id;
    const timer = window.setTimeout(() => setBannerOff(id), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [last]);
  // While the ball sits in the cup (before the throw is reported) the banner already shows it.
  const [landed, setLanded] = useState<{ id: number; hit: boolean } | null>(null);
  const banner = flying
    ? landed
    : last && bannerOff !== last.id
      ? { id: last.id, hit: last.hit !== null }
      : null;

  const shoot = async (thrown: AssistedThrow) => {
    if (busy.current) return;
    busy.current = true;
    setFlying(true);
    setAim(null);
    const n = (view.lastThrow?.id ?? 0) + 1;
    try {
      const sim = await runThrow({
        kind: 'ball',
        origin: thrown.origin,
        impulse: thrown.impulse,
        targets,
        seed: throwSeed(useSession.getState().startedAt, n),
      });
      const id = sim.result.kind === 'ball' ? sim.result.hit : null;
      const hit = id ? parseTargetId(id) : null;
      if (alive.current) setLanded({ id: n, hit: hit !== null });
      await sleep(hit ? HIT_HOLD_MS : MISS_FADE_MS);
      if (!alive.current) return;
      // The throw that was simulated (assist included) is the one reported.
      dispatch({
        type: 'GAME',
        action: { type: 'THROW_RESOLVED', impulse: thrown.impulse, origin: thrown.origin, hit },
      });
      clearThrow();
    } finally {
      busy.current = false;
      if (alive.current) {
        setFlying(false);
        setLanded(null);
      }
    }
  };

  const fromFlick = (f: Flick): AssistedThrow =>
    aimAssist(level, flickToThrow(f, sceneCamera(), 'ball', { targets }), targets);

  const fromPower = (power: number): AssistedThrow | null =>
    front ? aimAssist(level, aimedThrow('ball', front.position, power), targets) : null;

  const { dragging } = useFlick({
    enabled: canThrow,
    onAim: (f) => setAim(f && level >= 2 ? fromFlick(f) : null),
    onFlick: (f) => {
      setAim(null);
      void shoot(fromFlick(f));
    },
  });

  const current = view.current;
  const teamOf = view.turn;
  const ballsBack =
    !over && view.lastThrow !== null && view.lastThrow.team === view.turn && view.throwsTaken === 0;
  const canRerack = !over && view.rerackOptions.length > 0 && !flying && !sceneBusy;
  const winner = view.winner;

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      {over && winner !== null ? (
        <GameHeader
          eyebrow={t('bpui.winnerEyebrow')}
          name={<TeamName team={winner} className="justify-center" />}
          testId="bp-winner"
        >
          <span className="chip max-w-full" data-testid="bp-winners">
            <span className="truncate text-capiz-50">
              {view.teams[winner].members.map(nameOf).join(', ')}
            </span>
          </span>
          <span className="chip max-w-full border-sili-500/70" data-testid="bp-losers">
            <span className="truncate">
              {t('bpui.losers', {
                names: view.teams[winner === 0 ? 1 : 0].members.map(nameOf).join(', '),
              })}
            </span>
          </span>
          <Scoreboard view={view} />
        </GameHeader>
      ) : (
        <GameHeader
          eyebrow={<TeamName team={teamOf} />}
          name={
            <span aria-label={current ? t('bpui.turnAria', { name: nameOf(current) }) : undefined}>
              {current ? nameOf(current) : ''}
            </span>
          }
        >
          <DotsChip
            left={view.throwsLeft}
            cap={Math.max(r.throwsPerTurn, view.throwsLeft)}
            label={t('bp.hud.throwsLeft', { n: view.throwsLeft })}
            testId="bp-throws-left"
          />
          {ballsBack && (
            <span
              className="chip anim-pour border-sili-500 font-sign text-[0.85rem] text-[#ff8a6b]"
              data-testid="bp-balls-back"
            >
              {t('bp.hud.ballsBack')}
            </span>
          )}
          <Scoreboard view={view} />
        </GameHeader>
      )}

      {!over && (
        <section
          className="pointer-events-auto mx-auto flex w-full max-w-[440px] touch-none flex-col items-center gap-2.5"
          data-testid="bp-controls"
          data-turn-team={view.turn}
          data-last-throw={view.lastThrow?.id ?? 0}
        >
          <div className="flex min-h-9 items-center justify-center" aria-live="polite">
            {banner ? (
              <span
                key={banner.id}
                className={`anim-pour rounded-full border px-4 py-1 font-sign text-xl shadow-lg ${
                  banner.hit
                    ? 'border-brass-400 bg-narra-950/90 text-brass-300'
                    : 'border-narra-500 bg-narra-950/85 text-capiz-300'
                }`}
                data-testid="bp-result"
                data-throw-id={banner.id}
                data-hit={banner.hit ? 'true' : 'false'}
              >
                {banner.hit ? t('bp.hud.made') : t('bp.hud.miss')}
              </span>
            ) : flying ? (
              <span className="chip anim-fade px-3 text-capiz-200" data-testid="bp-flying">
                {t('bpui.inFlight')}
              </span>
            ) : (
              <SwipeHint text={t('bpui.swipeHint')} active={dragging} />
            )}
          </div>
          <div className="flex w-full items-end gap-2">
            {canRerack ? (
              <button
                type="button"
                className="btn btn-wood min-h-16 shrink-0 border-brass-600 px-4 text-brass-200"
                onClick={() => setSheet(true)}
                data-testid="bp-rerack"
              >
                <span className="flex items-center gap-1.5 font-sign text-base leading-none">
                  {t('bp.hud.rerack')}
                  <span
                    className="grid min-w-5 place-items-center rounded-full bg-brass-400 px-1 text-[0.72rem] text-narra-950"
                    aria-label={t('bp.hud.reracksLeft', { n: view.teams[view.turn].reracksLeft })}
                  >
                    {view.teams[view.turn].reracksLeft}
                  </span>
                </span>
              </button>
            ) : (
              <span className="flex-1" />
            )}
            <span className="flex-1" />
            <HoldThrowButton
              label={t('bpui.shoot')}
              hint={t('bpui.holdHint')}
              disabled={!canThrow}
              ideal={ideal}
              onHold={(p) => setAim(p !== null && level >= 2 ? fromPower(p) : null)}
              onRelease={(p) => {
                setAim(null);
                const thrown = fromPower(p);
                if (thrown) void shoot(thrown);
              }}
              testId="bp-shoot"
              className="w-[11.5rem]"
            />
          </div>
          <RerackSheet
            open={sheet && canRerack}
            onClose={() => setSheet(false)}
            view={view}
            dispatch={dispatch}
          />
        </section>
      )}

      {over && winner !== null && resultsShown && (
        // Sits over the play screen's game-over cover so the winners are named there too.
        <div
          className="anim-pour pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-[31] mx-auto flex max-w-[440px] flex-col items-center px-4 text-center"
          data-testid="bp-winner-line"
        >
          <span className="eyebrow text-brass-300">
            {t('game.beer-pong.title')} · {t('bpui.winnerEyebrow')}
          </span>
          <span className="sign-pintor max-w-full text-[clamp(1.6rem,8vw,2.4rem)] [overflow-wrap:anywhere]">
            {t(`bp.team.${winner}`)}
          </span>
        </div>
      )}
    </div>
  );
}
