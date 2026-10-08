import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDrag } from '@use-gesture/react';
import type { Rules, View } from '@/core/games/spin-the-bottle/logic';
import type { Kind } from '@/core/games/truth-or-dare/prompts';
import { useSettings } from '@/store/settings';
import { GameHeader } from '../truth-or-dare/hudKit';
import { promptFills, promptText } from '../truth-or-dare/promptFill';
import { KindBadge, PromptCard, PromptText } from '../truth-or-dare/promptKit';
import type { GameViewProps } from '../types';
import { SETTLE_FALLBACK_MS, settleOnce } from './settle';
import { powerFromFlick } from './spin';

type Dispatch = GameViewProps<View>['dispatch'];

function IconSpin({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

/**
 * The empty middle of the screen, over the bottle: flick or swipe it to spin. Release speed sets
 * the SPIN power; a tap or a slow drag does nothing (the big button is the accessible way in).
 */
function FlickPad({ enabled, onFlick }: { enabled: boolean; onFlick(power: number): void }) {
  const { t } = useTranslation();
  const [pulling, setPulling] = useState(false);
  const bind = useDrag(
    ({ first, last, tap, velocity: [vx, vy], movement: [mx, my] }) => {
      if (!enabled) return;
      if (first) setPulling(true);
      if (!last) return;
      setPulling(false);
      if (!tap && Math.hypot(mx, my) > 28) onFlick(powerFromFlick(Math.hypot(vx, vy)));
    },
    { filterTaps: true },
  );
  return (
    <div
      {...bind()}
      className={`relative flex min-h-0 flex-1 touch-none items-end justify-center pb-2 ${
        enabled ? 'pointer-events-auto' : ''
      }`}
      data-testid="stb-pad"
      aria-hidden
    >
      {enabled && (
        <span
          className={`chip anim-fade gap-2 bg-narra-950/80 px-3 py-1.5 text-[0.85rem] text-capiz-200 backdrop-blur-sm transition-colors ${
            pulling ? 'border-brass-400 text-brass-200' : ''
          }`}
        >
          <IconSpin size={18} />
          {t('stb.hud.flick')}
        </span>
      )}
    </div>
  );
}

function ChoosePanel({ name, dispatch }: { name: string; dispatch: Dispatch }) {
  const { t } = useTranslation();
  const choose = (kind: Kind) => dispatch({ type: 'GAME', action: { type: 'CHOOSE', kind } });
  return (
    <section className="felt anim-pour px-4 pt-3.5 pb-4" data-testid="stb-choose">
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex flex-col text-center">
          <h3 className="font-sign text-[1.6rem] leading-tight text-capiz-50">
            {t('stb.hud.choose')}
          </h3>
          <p className="text-sm text-capiz-300">{t('stbui.chooser', { name })}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="btn min-h-20 border border-felt-600 bg-[linear-gradient(180deg,#2f7a52,#1d4d33)] font-sign text-[1.5rem] text-capiz-50 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_3px_0_#0f2a1c]"
            onClick={() => choose('truth')}
            data-testid="stb-truth"
          >
            {t('stb.hud.truth')}
          </button>
          <button
            type="button"
            className="btn btn-sili min-h-20 font-sign text-[1.5rem]"
            onClick={() => choose('dare')}
            data-testid="stb-dare"
          >
            {t('stb.hud.dare')}
          </button>
        </div>
      </div>
    </section>
  );
}

function TaskPanel({
  view,
  rules,
  nameOf,
  dispatch,
}: {
  view: View;
  rules: Rules;
  nameOf(id: string): string;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const locale = useSettings((s) => s.locale);
  const target = view.spin?.target;
  const prompt = view.prompt;
  const kind: Kind = prompt?.kind ?? view.chosen ?? 'truth';
  const fills = promptFills(
    view.order,
    prompt?.targets.player ?? target,
    prompt?.targets.random,
    nameOf,
  );
  const act = (type: 'DONE' | 'REFUSE') => dispatch({ type: 'GAME', action: { type } });
  return (
    <>
      {prompt ? (
        <PromptCard eyebrow={<KindBadge kind={kind} />} testId="stb-prompt">
          <PromptText text={promptText(prompt.item, locale)} fills={fills} />
        </PromptCard>
      ) : (
        <PromptCard eyebrow={<KindBadge kind={kind} />} testId="stb-prompt">
          <span data-testid="stb-freestyle">
            {t(kind === 'dare' ? 'stb.hud.freestyleDare' : 'stb.hud.freestyleTruth')}
          </span>
        </PromptCard>
      )}
      <div className="grid grid-cols-[1fr_1.15fr] gap-2.5">
        <button
          type="button"
          className="btn btn-wood min-h-16 flex-col gap-0.5 border-sili-500/60 px-2"
          onClick={() => act('REFUSE')}
          data-testid="stb-refuse"
        >
          <span className="text-[0.98rem] leading-tight text-[#ff8a6b]">{t('stb.hud.refuse')}</span>
          <span className="text-xs font-bold text-capiz-300">
            {t('stb.hud.refuseCost', { sips: rules.sips + 1 })}
          </span>
        </button>
        <button
          type="button"
          className="btn btn-brass min-h-16 font-sign text-[1.45rem]"
          onClick={() => act('DONE')}
          data-testid="stb-done"
        >
          {t('stb.hud.done')}
        </button>
      </div>
    </>
  );
}

function ResultPanel({ view, name, dispatch }: { view: View; name: string; dispatch: Dispatch }) {
  const { t } = useTranslation();
  const key =
    view.result === 'drank'
      ? 'stb.hud.drink'
      : view.result === 'free'
        ? 'stb.hud.free'
        : view.result === 'refused'
          ? 'stbui.refused'
          : 'stbui.done';
  const tone =
    view.result === 'done' || view.result === 'free'
      ? 'border-felt-600 bg-felt-800/95'
      : 'border-sili-500 bg-[#3a120b]/95';
  return (
    <>
      <section
        className={`anim-pour flex flex-col items-center gap-1 rounded-2xl border px-4 py-3.5 text-center shadow-xl ${tone}`}
        data-testid="stb-result"
        data-result={view.result ?? ''}
        role="status"
      >
        <span className="font-sign text-[1.45rem] leading-tight text-capiz-50 [overflow-wrap:anywhere]">
          {t(key, { name })}
        </span>
      </section>
      <button
        type="button"
        className="btn btn-brass min-h-16 w-full font-sign text-[1.6rem]"
        onClick={() => dispatch({ type: 'GAME', action: { type: 'NEXT' } })}
        data-testid="stb-next"
      >
        {t('stb.hud.next')}
      </button>
    </>
  );
}

export default function SpinTheBottleHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const spin = view.spin;
  const spinning = spin !== null && !spin.settled;
  const spinnerId = view.order[view.spinner];
  const spinnerName = spinnerId ? nameOf(spinnerId) : '';
  const targetName = spin ? nameOf(spin.target) : '';
  const landed = view.phase !== 'spin';
  const spinId = spin?.id ?? 0;

  // Safety net: if the scene never reports the landing (no WebGL), settle it from here.
  useEffect(() => {
    if (!spinning) return;
    const id = window.setTimeout(
      () =>
        settleOnce('stb', spinId, () =>
          dispatch({ type: 'GAME', action: { type: 'SETTLED', spinId } }),
        ),
      SETTLE_FALLBACK_MS,
    );
    return () => window.clearTimeout(id);
  }, [spinning, spinId, dispatch]);

  const doSpin = (power: number) => {
    if (spinning || view.phase !== 'spin') return;
    dispatch({ type: 'GAME', action: { type: 'SPIN', power } });
  };

  return (
    <div className="flex h-full flex-col">
      <GameHeader
        eyebrow={landed ? t('stbui.pickedOf') : spinning ? t('stb.hud.spinning') : t('play.turnOf')}
        name={landed ? targetName : spinnerName}
        tone={landed && view.result !== 'done' ? 'sili' : 'brass'}
      >
        <span className="chip" data-testid="stb-round">
          {t('stb.hud.round', { round: view.round })}
        </span>
        {landed && <span className="chip">{t('stb.hud.spinner', { name: spinnerName })}</span>}
      </GameHeader>

      <FlickPad enabled={view.phase === 'spin' && !spinning} onFlick={doSpin} />

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        {view.phase === 'spin' && (
          <button
            type="button"
            className="btn btn-brass min-h-16 w-full gap-3 font-sign text-[1.6rem]"
            disabled={spinning}
            // A button spin is a medium flick with a little variety.
            onClick={() => doSpin(0.45 + Math.random() * 0.3)}
            data-testid="stb-spin"
          >
            <IconSpin size={26} />
            {spinning ? t('stb.hud.spinning') : t('stb.hud.spin')}
          </button>
        )}
        {view.phase === 'choose' && (
          <ChoosePanel key={spinId} name={targetName} dispatch={dispatch} />
        )}
        {view.phase === 'prompt' && (
          <TaskPanel view={view} rules={r} nameOf={nameOf} dispatch={dispatch} />
        )}
        {view.phase === 'resolved' && (
          <ResultPanel view={view} name={targetName} dispatch={dispatch} />
        )}
      </section>
    </div>
  );
}
