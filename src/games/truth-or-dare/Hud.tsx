import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rules, View } from '@/core/games/truth-or-dare/logic';
import type { Kind } from '@/core/games/truth-or-dare/prompts';
import { useSettings } from '@/store/settings';
import { SETTLE_FALLBACK_MS, settleOnce } from '../spin-the-bottle/settle';
import type { GameViewProps } from '../types';
import { GameHeader } from './hudKit';
import { promptFills, promptText } from './promptFill';
import { KindBadge, PromptCard, PromptText } from './promptKit';

type Dispatch = GameViewProps<View>['dispatch'];

/** In player mode the prompt lands as the wheel finishes swinging round (Scene NUDGE_SECONDS). */
const NUDGE_DELAY_MS = 750;

function ChoicePanel({
  wheel,
  spinning,
  dispatch,
}: {
  wheel: boolean;
  spinning: boolean;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const choose = (kind: Kind) => dispatch({ type: 'GAME', action: { type: 'CHOOSE', kind } });
  if (wheel) {
    return (
      <button
        type="button"
        className="btn btn-brass min-h-16 w-full font-sign text-[1.45rem]"
        disabled={spinning}
        onClick={() => dispatch({ type: 'GAME', action: { type: 'SPIN_WHEEL' } })}
        data-testid="tod-spin"
      >
        {spinning ? t('tod.hud.spinning') : t('tod.hud.spinWheel')}
      </button>
    );
  }
  return (
    <section className="felt anim-pour px-4 pt-3.5 pb-4" data-testid="tod-choose">
      <div className="relative z-10 flex flex-col gap-3">
        <h3 className="text-center font-sign text-[1.6rem] leading-tight text-capiz-50">
          {t('tod.hud.choose')}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="btn min-h-20 border border-felt-600 bg-[linear-gradient(180deg,#2f7a52,#1d4d33)] font-sign text-[1.5rem] text-capiz-50 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_3px_0_#0f2a1c]"
            onClick={() => choose('truth')}
            data-testid="tod-truth"
          >
            {t('tod.hud.truth')}
          </button>
          <button
            type="button"
            className="btn btn-sili min-h-20 font-sign text-[1.5rem]"
            onClick={() => choose('dare')}
            data-testid="tod-dare"
          >
            {t('tod.hud.dare')}
          </button>
        </div>
      </div>
    </section>
  );
}

function OverPanel({ empty }: { empty: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      className="panel anim-pour flex flex-col items-center gap-2 px-5 py-6 text-center"
      data-testid="tod-over"
    >
      <h3 className="sign-pintor text-[clamp(1.8rem,8vw,2.6rem)]">{t('tod.hud.over')}</h3>
      {empty && <p className="text-capiz-200">{t('tod.hud.empty')}</p>}
    </section>
  );
}

export default function TruthOrDareHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const locale = useSettings((s) => s.locale);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const wheelMode = r.choice === 'wheel';
  const spinning = view.wheel !== null && !view.wheel.settled;
  const wheelId = view.wheel?.id ?? 0;
  const player = view.player;

  // Safety net: if the scene never reports the landing (no WebGL), settle it from here.
  useEffect(() => {
    if (!spinning) return;
    const id = window.setTimeout(
      () =>
        settleOnce('tod', wheelId, () =>
          dispatch({ type: 'GAME', action: { type: 'SETTLED', wheelId } }),
        ),
      SETTLE_FALLBACK_MS,
    );
    return () => window.clearTimeout(id);
  }, [spinning, wheelId, dispatch]);

  // Player mode: DONE / REFUSE wait for the prompt card, which lands as the wheel swings round.
  const stepKey = `${view.round}:${view.phase}`;
  const [shownKey, setShownKey] = useState(stepKey);
  useEffect(() => {
    if (view.phase !== 'prompt') return;
    const id = window.setTimeout(() => setShownKey(stepKey), wheelMode ? 0 : NUDGE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [stepKey, view.phase, wheelMode]);
  const landing = view.phase === 'prompt' && !wheelMode && shownKey !== stepKey;

  const prompt = view.prompt;
  const sips = prompt ? (prompt.item.sips ?? r.refuseSips) : r.refuseSips;
  const fills = promptFills(
    view.order,
    prompt?.targets.player ?? player,
    prompt?.targets.random,
    nameOf,
  );
  const act = (type: 'DONE' | 'REFUSE') => dispatch({ type: 'GAME', action: { type } });

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <GameHeader
        eyebrow={
          view.phase === 'over'
            ? t('tod.hud.over')
            : spinning
              ? t('tod.hud.spinning')
              : t('play.turnOf')
        }
        name={player ? nameOf(player) : t('game.truth-or-dare.title')}
      >
        {view.round > 0 && (
          <span className="chip" data-testid="tod-round">
            {r.rounds > 0
              ? t('tod.hud.roundOf', { round: view.round, total: r.rounds })
              : t('tod.hud.round', { round: view.round })}
          </span>
        )}
      </GameHeader>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        {view.phase === 'choose' && (
          <ChoicePanel wheel={wheelMode} spinning={spinning} dispatch={dispatch} />
        )}
        {view.phase === 'prompt' && prompt && (
          <>
            <PromptCard
              key={view.round}
              eyebrow={<KindBadge kind={prompt.kind} />}
              delay={wheelMode ? 0 : NUDGE_DELAY_MS}
              testId="tod-prompt"
            >
              <PromptText text={promptText(prompt.item, locale)} fills={fills} />
            </PromptCard>
            <div className="grid grid-cols-[1fr_1.15fr] gap-2.5">
              <button
                type="button"
                className="btn btn-wood min-h-16 flex-col gap-0.5 border-sili-500/60 px-2"
                disabled={landing}
                onClick={() => act('REFUSE')}
                data-testid="tod-refuse"
              >
                <span className="text-[0.98rem] leading-tight text-[#ff8a6b]">
                  {t('tod.hud.refuse')}
                </span>
                {sips > 0 && (
                  <span className="text-xs font-bold text-capiz-300" data-testid="tod-refuse-cost">
                    {t('tod.hud.refuseCost', { sips })}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="btn btn-brass min-h-16 font-sign text-[1.45rem]"
                disabled={landing}
                onClick={() => act('DONE')}
                data-testid="tod-done"
              >
                {t('tod.hud.done')}
              </button>
            </div>
          </>
        )}
        {view.phase === 'over' && <OverPanel empty={view.round === 0} />}
      </section>
    </div>
  );
}
