import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_RULE_LENGTH, type Pending, type Rules, type View } from '@/core/games/quarters/logic';
import { DEFAULT_GLASS_POSITION } from '@/physics/throwConfig';
import {
  aimAssist,
  flickToThrow,
  useFlick,
  type AssistedThrow,
  type AssistLevel,
  type Flick,
} from '@/physics/useFlick';
import { useSession } from '@/store/session';
import { Sheet } from '@/ui/Sheet';
import { DotsChip, HoldThrowButton, SwipeHint } from '../beer-pong/hudKit';
import { aimedThrow, idealPower, throwSeed } from '../beer-pong/layout';
import { clearThrow, runThrow, sceneCamera, sleep, useThrowBus } from '../beer-pong/throwBus';
import { useCompactToasts } from '@/ui/toastAnchor';
import { GameHeader } from '../truth-or-dare/hudKit';
import type { GameViewProps } from '../types';
import { GLASS } from './layout';

/** A made coin rests in the glass a moment before the pick comes up. */
const MADE_HOLD_MS = 380;
/** A clean drop that doesn't count stays in view this long before the coin comes back. */
const NO_BOUNCE_HOLD_MS = 900;
const MISS_FADE_MS = 320;
const GLASS_POS = GLASS[0]?.position ?? DEFAULT_GLASS_POSITION;
const BANNER_MS = 2600;

type Dispatch = GameViewProps<View>['dispatch'];

function PendingPanel({
  pending,
  order,
  nameOf,
  dispatch,
}: {
  pending: Pending;
  order: readonly string[];
  nameOf(id: string): string;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const setPicked = useThrowBus((s) => s.setPicked);
  const [target, setTarget] = useState<string | null>(null);
  const [text, setText] = useState('');
  const kind = pending.kind;
  const options = order.filter((id) => id !== pending.by);
  const len = text.trim().length;
  const valid =
    kind === 'rule'
      ? len >= 1 && len <= MAX_RULE_LENGTH
      : target !== null && options.includes(target);
  const title = kind === 'rule' ? t('qt.hud.makeRule') : t('qt.hud.pick');

  useEffect(() => () => setPicked(null), [setPicked]);

  const pick = (id: string) => {
    setTarget(id);
    setPicked(id);
  };
  const resolve = () => {
    if (!valid) return;
    dispatch({
      type: 'GAME',
      action:
        kind === 'rule'
          ? { type: 'RESOLVE', text: text.trim() }
          : { type: 'RESOLVE', target: target ?? undefined },
    });
  };

  return (
    <section className="felt anim-pour px-4 pt-3.5 pb-4" data-testid="qt-pending" data-kind={kind}>
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex flex-col">
          <h3 className="font-sign text-[1.5rem] leading-tight text-capiz-50">{title}</h3>
          <p className="text-sm text-capiz-300">
            {kind === 'rule'
              ? t('qtui.ruleHint', { name: nameOf(pending.by) })
              : t('qt.hud.pickHint', { sips: pending.sips })}
          </p>
        </div>

        {kind === 'rule' ? (
          <label className="flex flex-col gap-1">
            <span className="sr-only">{t('qt.hud.makeRule')}</span>
            <input
              className="field bg-narra-950/85"
              value={text}
              maxLength={MAX_RULE_LENGTH}
              placeholder={t('qt.hud.rulePlaceholder')}
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') resolve();
              }}
              data-testid="qt-rule-input"
            />
            <span className="self-end text-xs font-bold text-capiz-400" aria-hidden>
              {text.length}/{MAX_RULE_LENGTH}
            </span>
          </label>
        ) : (
          <div
            role="radiogroup"
            aria-label={title}
            className="flex max-h-[30dvh] flex-wrap gap-2 overflow-y-auto"
          >
            {options.map((id) => {
              const on = id === target;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pick(id)}
                  className={`min-h-12 max-w-full truncate rounded-full border px-4 font-bold transition-colors ${
                    on
                      ? 'border-brass-300 bg-brass-400 text-narra-950 shadow-[0_0_0_3px_rgb(232_176_74/0.25)]'
                      : 'border-narra-500 bg-narra-950/70 text-capiz-50 active:bg-narra-800'
                  }`}
                  data-testid="qt-target"
                >
                  {nameOf(id)}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-2">
          <button
            type="button"
            className="btn btn-wood"
            onClick={() => dispatch({ type: 'GAME', action: { type: 'SKIP' } })}
            data-testid="qt-skip"
          >
            {t('qt.hud.skip')}
          </button>
          <button
            type="button"
            className="btn btn-brass font-sign text-lg"
            disabled={!valid}
            onClick={resolve}
            data-testid="qt-resolve"
          >
            {kind === 'rule' ? t('qt.hud.saveRule') : t('qtui.confirm')}
          </button>
        </div>
      </div>
    </section>
  );
}

function HouseRulesSheet({
  open,
  onClose,
  rules,
}: {
  open: boolean;
  onClose(): void;
  rules: readonly string[];
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} title={t('qt.hud.houseRules')} testId="qt-rules-sheet">
      {rules.length === 0 ? (
        <p className="text-capiz-300">{t('qtui.noRules')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rules.map((rule, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl bg-narra-950/50 px-3 py-2.5">
              <span className="font-sign text-lg leading-6 text-brass-400">{i + 1}</span>
              {/* Literal text the group typed: rendered as text, never HTML. */}
              <span className="min-w-0 flex-1 leading-6 text-capiz-50 [overflow-wrap:anywhere]">
                {rule}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

export default function QuartersHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  // The table is the news: drink toasts shrink to chips so they never cover the cups.
  useCompactToasts(true);
  const r = rules as Rules;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const setAim = useThrowBus((s) => s.setAim);
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

  const pending = view.pending;
  // A made coin waits in the glass until the pick (and any streak rule) is settled.
  useEffect(() => {
    if (!pending) clearThrow();
  }, [pending]);

  const canThrow = !flying && !pending && !sheet && view.current !== null;
  const ideal = useMemo(() => idealPower('coin', GLASS_POS), []);

  const [mountShot] = useState(view.lastShot?.id ?? 0);
  const last = view.lastShot && view.lastShot.id > mountShot ? view.lastShot : null;
  const [bannerOff, setBannerOff] = useState(0);
  useEffect(() => {
    if (!last) return;
    const id = last.id;
    const timer = window.setTimeout(() => setBannerOff(id), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [last]);
  const banner = last && bannerOff !== last.id && !flying ? last : null;

  const shoot = async (thrown: AssistedThrow) => {
    if (busy.current) return;
    busy.current = true;
    setFlying(true);
    setAim(null);
    const n = (view.lastShot?.id ?? 0) + 1;
    try {
      const sim = await runThrow({
        kind: 'coin',
        origin: thrown.origin,
        impulse: thrown.impulse,
        targets: GLASS,
        seed: throwSeed(useSession.getState().startedAt, n),
      });
      const res = sim.result;
      const made = res.kind === 'coin' && res.made;
      const bounced = res.kind === 'coin' && res.bounced;
      const counted = made && (bounced || !r.mustBounce);
      await sleep(counted ? MADE_HOLD_MS : made ? NO_BOUNCE_HOLD_MS : MISS_FADE_MS);
      if (!alive.current) return;
      dispatch({
        type: 'GAME',
        action: {
          type: 'THROW_RESOLVED',
          impulse: thrown.impulse,
          origin: thrown.origin,
          made,
          bounced,
        },
      });
      if (!counted) clearThrow();
    } finally {
      busy.current = false;
      if (alive.current) setFlying(false);
    }
  };

  const assist = r.aimAssist as AssistLevel;
  const fromFlick = (f: Flick): AssistedThrow =>
    aimAssist(assist, flickToThrow(f, sceneCamera(), 'coin', { targets: GLASS }), GLASS);
  const fromPower = (power: number): AssistedThrow =>
    aimAssist(assist, aimedThrow('coin', GLASS_POS, power), GLASS);

  const { dragging } = useFlick({
    enabled: canThrow,
    onAim: (f) => setAim(f ? fromFlick(f) : null),
    onFlick: (f) => {
      setAim(null);
      void shoot(fromFlick(f));
    },
  });

  const shooter = view.current;
  const stats = shooter ? view.stats[shooter] : undefined;
  const streakLen = r.streakRule === 'makeRule' ? r.streakLength : 0;
  const missesLeft = Math.max(0, r.missesBeforePass - view.misses);

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <GameHeader
        eyebrow={t('qtui.eyebrow')}
        name={
          <span aria-label={shooter ? t('qt.hud.shooter', { name: nameOf(shooter) }) : undefined}>
            {shooter ? nameOf(shooter) : ''}
          </span>
        }
      >
        {streakLen > 0 ? (
          <DotsChip
            left={view.streak % streakLen}
            cap={streakLen}
            label={t('qt.hud.streak', { n: view.streak })}
            testId="qt-streak"
          />
        ) : (
          <span className="chip" data-testid="qt-streak" data-left={view.streak}>
            {t('qt.hud.streak', { n: view.streak })}
          </span>
        )}
        <DotsChip
          left={missesLeft}
          cap={r.missesBeforePass}
          label={t('qt.hud.missesLeft', { n: missesLeft })}
          testId="qt-misses"
          tone="sili"
        />
        {stats && stats.shots > 0 && (
          <span className="chip" data-testid="qt-stats">
            {t('qt.hud.stats', { makes: stats.makes, shots: stats.shots })}
          </span>
        )}
        {view.houseRules.length > 0 && (
          <button
            type="button"
            className="chip min-h-7 border-brass-600/80 active:bg-narra-800"
            onClick={() => setSheet(true)}
            data-testid="qt-house-rules"
          >
            <span className="text-brass-300">{t('qt.hud.houseRules')}</span>
            <span className="grid min-w-5 place-items-center rounded-full bg-brass-400 px-1 font-sign text-[0.75rem] text-narra-950">
              {view.houseRules.length}
            </span>
          </button>
        )}
      </GameHeader>

      <section
        className={`pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-2.5 ${
          pending ? '' : 'touch-none'
        }`}
        data-testid="qt-controls"
      >
        {pending ? (
          <div className="w-full">
            <PendingPanel
              key={`${view.lastShot?.id ?? 0}:${pending.kind}`}
              pending={pending}
              order={view.order}
              nameOf={nameOf}
              dispatch={dispatch}
            />
          </div>
        ) : (
          <>
            <div
              className="flex min-h-9 flex-col items-center justify-center gap-1"
              aria-live="polite"
            >
              {banner ? (
                <>
                  <span
                    key={banner.id}
                    className={`anim-pour rounded-full border px-4 py-1 font-sign text-xl shadow-lg ${
                      banner.counted
                        ? 'border-brass-400 bg-narra-950/90 text-brass-300'
                        : banner.made
                          ? 'border-sili-500 bg-narra-950/90 text-[#ff8a6b]'
                          : 'border-narra-500 bg-narra-950/85 text-capiz-300'
                    }`}
                    data-testid="qt-result"
                    data-shot-id={banner.id}
                    data-result={banner.counted ? 'made' : banner.made ? 'noBounce' : 'miss'}
                  >
                    {banner.counted
                      ? t('qt.hud.made')
                      : banner.made
                        ? t('qt.hud.noBounce')
                        : t('qt.hud.miss')}
                  </span>
                  {banner.made && !banner.counted && (
                    <span
                      className="anim-fade rounded-lg bg-narra-950/80 px-2.5 py-1 text-center text-sm text-capiz-200"
                      data-testid="qt-bounce-hint"
                    >
                      {t('qtui.mustBounceHint')}
                    </span>
                  )}
                </>
              ) : flying ? (
                <span className="chip anim-fade px-3 text-capiz-200" data-testid="qt-flying">
                  {t('qtui.inFlight')}
                </span>
              ) : (
                <SwipeHint text={t('qtui.swipeHint')} active={dragging} />
              )}
            </div>
            <div className="flex w-full items-end justify-end gap-2">
              <HoldThrowButton
                label={t('bpui.shoot')}
                hint={t('bpui.holdHint')}
                disabled={!canThrow}
                ideal={ideal}
                onHold={(p) => setAim(p !== null ? fromPower(p) : null)}
                onRelease={(p) => {
                  setAim(null);
                  void shoot(fromPower(p));
                }}
                testId="qt-shoot"
                className="w-[11.5rem]"
              />
            </div>
          </>
        )}
        <HouseRulesSheet open={sheet} onClose={() => setSheet(false)} rules={view.houseRules} />
      </section>
    </div>
  );
}
