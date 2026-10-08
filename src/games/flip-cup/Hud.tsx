import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rules, View } from '@/core/games/flip-cup/logic';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import { CUP_HEIGHT, CUP_TOP_RADIUS, type Vec3 } from '@/physics/throwConfig';
import { projectToScreen } from '@/physics/throwMath';
import { useFlick, type Flick } from '@/physics/useFlick';
import { useFx } from '@/store/fx';
import { TeamDot, TeamName } from '../beer-pong/hudKit';
import { rigCamera } from '../beer-pong/throwBus';
import { TEAM_COLORS } from '../beer-pong/layout';
import { settleOnce } from '../spin-the-bottle/settle';
import { useCompactToasts } from '@/ui/toastAnchor';
import { GameHeader } from '../truth-or-dare/hudKit';
import type { GameViewProps } from '../types';
import { angleOffVertical, flickQuality, FLIP_SPOT, needleAt, powerScore, SWEET } from './flip';

/** If the scene never reports a flip (no WebGL), the Hud settles it after this long. */
const SETTLE_FALLBACK_MS = 4500;
/** "Tumaob!" / "Ulit!" stays up this long after a flip lands. */
const RESULT_MS = 2200;

type Dispatch = GameViewProps<View>['dispatch'];

interface Reading {
  /** Where the gesture landed on the power scale (0 … 1). */
  power: number;
  quality: number;
  /** Degrees off straight up (a flick), or null for a tap of the meter. */
  angle: number | null;
}

/** The cup at the flip spot, on screen: a box (CSS px) around it, roomy enough for a thumb. */
function useCupBox(): CSSProperties | null {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // The camera rig's pose for this viewport: exactly where the stage camera stands.
  const aspect = size.w / Math.max(1, size.h);
  const cam = rigCamera(aspect);
  const at = (p: Vec3) => projectToScreen(cam, aspect, p);
  const base = at(FLIP_SPOT);
  const top = at([FLIP_SPOT[0], CUP_HEIGHT, FLIP_SPOT[2]]);
  const side = at([FLIP_SPOT[0] + CUP_TOP_RADIUS, CUP_HEIGHT, FLIP_SPOT[2]]);
  if (!base || !top || !side) return null;
  const cx = base[0] * size.w;
  const halfW = Math.max(70, Math.abs(side[0] - top[0]) * size.w * 2.2);
  const y0 = top[1] * size.h - 56;
  const y1 = base[1] * size.h + 26;
  return {
    position: 'fixed',
    left: cx - halfW,
    width: halfW * 2,
    top: y0,
    height: Math.max(120, y1 - y0),
  };
}

/** Power scale with the sweet spot; a needle sweeps it for the tap, a marker shows a flick. */
function FlipMeter({
  running,
  reading,
  needleRef,
}: {
  running: boolean;
  reading: Reading | null;
  needleRef: RefObject<HTMLSpanElement | null>;
}) {
  const { t } = useTranslation();
  const marker = !running && reading ? reading.power : null;
  const q = reading ? Math.round(reading.quality * 100) : null;
  return (
    <div className="panel flex w-full flex-col gap-1.5 px-3 py-2" data-testid="fc-meter">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="eyebrow">{t('fcui.meter')}</span>
        {reading && (
          <span
            className="font-bold text-capiz-200"
            data-testid="fc-quality"
            data-quality={reading.quality.toFixed(2)}
          >
            {t('fcui.quality', { q })}
            {reading.angle !== null && (
              <span className="ml-2 font-normal text-capiz-400">
                {t('fcui.angle', { deg: Math.round(reading.angle) })}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="relative h-4 overflow-hidden rounded-full border border-narra-500 bg-narra-950">
        <span
          aria-hidden
          className="absolute inset-y-0 bg-[linear-gradient(90deg,rgb(232_176_74/0.35),rgb(232_176_74/0.75),rgb(232_176_74/0.35))]"
          style={{ left: `${SWEET.lo * 100}%`, width: `${(SWEET.hi - SWEET.lo) * 100}%` }}
        />
        <span
          ref={needleRef}
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-capiz-50 shadow-[0_0_8px_rgb(246_236_217/0.9)]"
          style={{ visibility: running ? 'visible' : 'hidden' }}
        />
        {marker !== null && (
          <span
            aria-hidden
            className="anim-fade absolute inset-y-0 w-[5px] -translate-x-1/2 rounded-full bg-sili-500 shadow-[0_0_8px_rgb(224_72_47/0.9)]"
            style={{ left: `${marker * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

function Totals({ view, totals }: { view: View; totals: [number, number] }) {
  const { t } = useTranslation();
  const cell = (team: TeamIndex) => {
    const active = view.currentTeam === team;
    const won = view.winner === team;
    return (
      <span
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border px-3 py-1 ${
          active || won
            ? 'border-brass-400/80 bg-narra-950/90 shadow-[0_0_14px_-4px_rgb(232_176_74/0.6)]'
            : 'border-narra-600 bg-narra-950/75'
        }`}
        style={{ flexDirection: team === 0 ? 'row' : 'row-reverse' }}
        data-testid={`fc-team-${team}`}
        data-tries={totals[team]}
      >
        <TeamDot team={team} />
        <span className="truncate text-[0.8rem] font-bold text-capiz-200">
          {t(`bp.team.${team}`)}
        </span>
        <span
          className="font-sign text-xl leading-none"
          style={{
            color: TEAM_COLORS[team].hud,
            marginLeft: team === 0 ? 'auto' : undefined,
            marginRight: team === 1 ? 'auto' : undefined,
          }}
        >
          {totals[team]}
        </span>
      </span>
    );
  };
  return (
    <div className="flex w-full max-w-[22rem] flex-col items-center gap-1">
      <div className="flex w-full items-center gap-1.5" aria-label={t('fc.hud.fewerWins')}>
        {cell(0)}
        <span className="shrink-0 text-xs font-bold text-capiz-400 uppercase">
          {t('bp.hud.vs')}
        </span>
        {cell(1)}
      </div>
      <span className="rounded-full bg-narra-950/70 px-2 text-[0.72rem] text-capiz-300">
        {t('fc.hud.fewerWins')}
      </span>
    </div>
  );
}

function DrinkPanel({ name, dispatch }: { name: string; dispatch: Dispatch }) {
  const { t } = useTranslation();
  return (
    <section className="felt anim-pour w-full px-4 pt-3.5 pb-4" data-testid="fc-drink">
      <div className="relative z-10 flex flex-col gap-3">
        <h3 className="font-sign text-[1.5rem] leading-tight text-capiz-50">
          {t('fc.hud.drink', { name })}
        </h3>
        <button
          type="button"
          className="btn btn-brass min-h-16 font-sign text-xl"
          onClick={() => dispatch({ type: 'GAME', action: { type: 'DRANK' } })}
          data-testid="fc-drank"
        >
          {t('fc.hud.drank')}
        </button>
      </div>
    </section>
  );
}

export default function FlipCupHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  // The table is the news: drink toasts shrink to chips so they never cover the cups.
  useCompactToasts(true);
  const r = rules as Rules;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const resultsShown = useFx((s) => s.resultsShown);
  const over = view.phase === 'over';
  const leg = over ? null : (view.legs[view.leg] ?? null);
  const flip = view.flip;
  const flipping = flip !== null && !flip.settled;
  const ready = !over && view.phase === 'flip' && !flipping;
  const [reading, setReading] = useState<Reading | null>(null);
  const box = useCupBox();
  const zone = useRef<HTMLDivElement>(null);
  const needle = useRef<HTMLSpanElement>(null);
  const meterStart = useRef(0);

  const attempt = (q: number, read: Reading) => {
    if (!ready) return;
    setReading(read);
    dispatch({ type: 'GAME', action: { type: 'FLIP_ATTEMPT', quality: q } });
  };

  const tap = (timeStamp: number) => {
    const x = needleAt(timeStamp - meterStart.current);
    const q = powerScore(x);
    attempt(q, { power: x, quality: q, angle: null });
  };

  const { dragging } = useFlick({
    target: zone,
    enabled: ready,
    onFlick: (f: Flick) => {
      const q = flickQuality(f);
      attempt(q, { power: f.power, quality: q, angle: angleOffVertical(f.direction) });
    },
  });

  // The tap meter's needle: sweeps while a flip can be made (DOM only, no re-renders).
  useEffect(() => {
    if (!ready) return;
    meterStart.current = performance.now();
    let raf = 0;
    const tick = () => {
      const el = needle.current;
      const x = needleAt(performance.now() - meterStart.current);
      if (el) el.style.transform = `translateX(${x * (el.parentElement?.clientWidth ?? 0)}px)`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // The scene reports SETTLED when the flip lands; if it can't (no WebGL), settle it anyway.
  const flipId = flip?.id ?? 0;
  useEffect(() => {
    if (!flipping) return;
    const timer = window.setTimeout(
      () =>
        settleOnce('fc', flipId, () =>
          dispatch({ type: 'GAME', action: { type: 'SETTLED', flipId } }),
        ),
      SETTLE_FALLBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [flipping, flipId, dispatch]);

  // "Tumaob!" / "Ulit!" / "Pasa na!" for flips that land while this screen is up.
  const [mountFlip] = useState(flipId);
  const [resultOff, setResultOff] = useState(0);
  const landed = flip && flip.settled && flip.id > mountFlip ? flip : null;
  useEffect(() => {
    if (!landed) return;
    const id = landed.id;
    const timer = window.setTimeout(() => setResultOff(id), RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [landed]);
  const shownResult = landed && resultOff !== landed.id ? landed : null;
  // The leg that just ended (on a success or the cap) is the one before the current one.
  const prevLeg = view.legs[over ? view.leg : view.leg - 1];
  const resultText = shownResult
    ? shownResult.success
      ? t('fc.hud.success')
      : prevLeg?.result === 'capped' && view.legs[view.leg]?.attempts === 0
        ? t('fc.hud.capped')
        : t('fc.hud.fail')
    : null;

  const totals: [number, number] = view.suddenDeath > 0 ? view.roundAttempts : view.teamAttempts;
  const mainLegs = view.legs.filter((l) => l.round === 0).length;

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      {over ? (
        <GameHeader
          eyebrow={view.draw ? t('fcui.raceOver') : t('bpui.winnerEyebrow')}
          name={
            view.winner !== null ? (
              <TeamName team={view.winner} className="justify-center" />
            ) : (
              t('fc.hud.draw')
            )
          }
          testId="fc-winner"
        >
          {view.winner !== null && (
            <span className="chip max-w-full" data-testid="fc-winners">
              <span className="truncate text-capiz-50">
                {view.teams[view.winner].map(nameOf).join(', ')}
              </span>
            </span>
          )}
          <Totals view={view} totals={view.teamAttempts} />
        </GameHeader>
      ) : (
        <GameHeader
          eyebrow={view.currentTeam !== null ? <TeamName team={view.currentTeam} /> : ''}
          name={view.current ? nameOf(view.current) : ''}
        >
          {view.suddenDeath > 0 ? (
            <span
              className="chip anim-pour border-sili-500 font-sign text-[0.85rem] text-[#ff8a6b]"
              data-testid="fc-sudden"
              data-round={view.suddenDeath}
            >
              {t('fc.hud.suddenDeath')} {view.suddenDeath}
            </span>
          ) : (
            <span className="chip" data-testid="fc-leg">
              {t('fc.hud.leg', { n: view.leg + 1, total: mainLegs })}
            </span>
          )}
          <span className="chip" data-testid="fc-attempts" data-n={leg?.attempts ?? 0}>
            {t('fc.hud.attempts', { n: leg?.attempts ?? 0 })}
            <span className="text-capiz-400">· {t('fc.hud.cap', { n: r.maxAttemptsPerLeg })}</span>
          </span>
          <Totals view={view} totals={totals} />
        </GameHeader>
      )}

      {/* The cup itself is the flick target: a box over it on screen. */}
      {ready && box && (
        <div
          ref={zone}
          aria-hidden
          className="pointer-events-auto touch-none select-none"
          style={box}
          data-testid="fc-zone"
          data-dragging={dragging}
        />
      )}

      {!over && leg && (
        <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-2.5">
          <div className="flex min-h-9 items-center justify-center" aria-live="polite">
            {resultText && shownResult ? (
              <span
                key={shownResult.id}
                className={`anim-pour rounded-full border px-4 py-1 font-sign text-xl shadow-lg ${
                  shownResult.success
                    ? 'border-brass-400 bg-narra-950/90 text-brass-300'
                    : 'border-narra-500 bg-narra-950/85 text-capiz-300'
                }`}
                data-testid="fc-result"
                data-flip-id={shownResult.id}
                data-success={shownResult.success ? 'true' : 'false'}
              >
                {resultText}
              </span>
            ) : flipping ? (
              <span className="chip anim-fade px-3 text-capiz-200" data-testid="fc-flipping">
                {t('fc.hud.flipping')}
              </span>
            ) : view.phase === 'flip' ? (
              <span
                className={`chip anim-fade gap-1.5 bg-narra-950/80 px-3 py-1.5 text-[0.82rem] backdrop-blur-sm ${
                  dragging ? 'border-brass-400 text-brass-200' : 'text-capiz-200'
                }`}
              >
                {t('fc.hud.flipHint')}
              </span>
            ) : null}
          </div>

          {view.phase === 'drink' ? (
            <DrinkPanel name={nameOf(leg.player)} dispatch={dispatch} />
          ) : (
            <>
              <FlipMeter running={ready} reading={reading} needleRef={needle} />
              <button
                type="button"
                className="btn btn-brass min-h-16 w-full font-sign text-[1.5rem]"
                disabled={!ready}
                onPointerDown={(e) => {
                  // Read the needle where the finger came down, not after the click settles.
                  if (e.button !== 0) return;
                  e.preventDefault();
                  tap(e.timeStamp);
                }}
                // Keyboard and assistive tech: a click with no pointer behind it.
                onClick={(e) => {
                  if (e.detail === 0) tap(e.timeStamp);
                }}
                data-testid="fc-flip"
              >
                {t('fc.hud.flip')}
              </button>
              <span className="text-center text-[0.75rem] text-capiz-300">{t('fcui.tapHint')}</span>
            </>
          )}
        </section>
      )}

      {over && resultsShown && (
        <div
          className="anim-pour pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-[31] mx-auto flex max-w-[440px] flex-col items-center px-4 text-center"
          data-testid="fc-winner-line"
        >
          <span className="eyebrow text-brass-300">
            {t('game.flip-cup.title')} ·{' '}
            {view.winner !== null ? t('bpui.winnerEyebrow') : t('fcui.raceOver')}
          </span>
          <span className="sign-pintor max-w-full text-[clamp(1.6rem,8vw,2.4rem)] [overflow-wrap:anywhere]">
            {view.winner !== null ? t(`bp.team.${view.winner}`) : t('fc.hud.draw')}
          </span>
        </div>
      )}
    </div>
  );
}
