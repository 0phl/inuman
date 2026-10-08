import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { View } from '@/core/games/never-have-i-ever/logic';
import { leftOf, rightOf } from '@/core/primitives/turn';
import { useSettings } from '@/store/settings';
import { IconCheck } from '@/ui/icons';
import { useToastAnchor } from '@/ui/toastAnchor';
import type { GameViewProps } from '../types';

/** Next stays locked while the tent card spins to the new prompt (Scene SPIN_SECONDS). */
const NEXT_LOCK_MS = 850;
/** The prompt text lands as the tent card finishes its turn. */
const PROMPT_DELAY_MS = 380;

type Slot = 'player' | 'random' | 'left' | 'right';
const PLACEHOLDER = /(\{(?:player|random|left|right)\})/g;

/** Swaps `{player}` & co. for names, highlighted so the table sees who's being called out. */
function PromptText({ text, fills }: { text: string; fills: Record<Slot, string> }) {
  const parts: ReactNode[] = text.split(PLACEHOLDER).map((part, i) => {
    const m = /^\{(player|random|left|right)\}$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    return (
      <span
        key={i}
        className="rounded-md bg-sili-500/12 px-1 text-sili-600 underline decoration-brass-500 decoration-2 underline-offset-4"
      >
        {fills[m[1] as Slot]}
      </span>
    );
  });
  return <>{parts}</>;
}

function EndPanel({ empty }: { empty: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      className="panel anim-pour flex flex-col items-center gap-2 px-5 py-6 text-center"
      data-testid="nhie-end"
    >
      <h3 className="sign-pintor text-[clamp(1.8rem,8vw,2.6rem)]">{t('nhie.hud.done')}</h3>
      <p className="text-capiz-200">{empty ? t('nhie.hud.empty') : t('nhieui.endBody')}</p>
    </section>
  );
}

export default function NeverHaveIEverHud({ view, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const locale = useSettings((s) => s.locale);
  const anchor = useToastAnchor<HTMLElement>();
  const nameOf = (id: string | undefined) =>
    id ? (players.find((p) => p.id === id)?.name ?? '?') : '?';
  // The selection belongs to one round: a new prompt starts with nobody picked.
  const [sel, setSel] = useState<{ round: number; did: string[] }>({ round: view.round, did: [] });
  const did = sel.round === view.round ? sel.did : [];
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!locked) return;
    const t0 = window.setTimeout(() => setLocked(false), NEXT_LOCK_MS);
    return () => window.clearTimeout(t0);
  }, [locked]);

  const n = view.order.length;
  const readerId = n > 0 ? view.order[view.reader] : undefined;
  const current = view.current;

  const toggle = (id: string) =>
    setSel({
      round: view.round,
      did: did.includes(id) ? did.filter((x) => x !== id) : [...did, id],
    });

  const next = () => {
    const err = dispatch({ type: 'GAME', action: { type: 'NEXT', did } });
    if (err) return;
    setSel({ round: view.round, did: [] });
    setLocked(true);
  };

  const fills: Record<Slot, string> = {
    player: nameOf(readerId),
    random: nameOf(current?.targets.random),
    left: n > 0 ? nameOf(leftOf(view.order, view.reader)) : '?',
    right: n > 0 ? nameOf(rightOf(view.order, view.reader)) : '?',
  };
  const text = current ? (current.item.alt?.[locale] ?? current.item.text) : '';

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <section
        ref={anchor}
        className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-2 [&_.chip]:bg-narra-950/85 [&_.chip]:backdrop-blur-sm bg-[radial-gradient(closest-side,rgb(14_8_5/0.72),transparent)] pt-1 pb-2 text-center"
      >
        <span className="eyebrow rounded-full bg-narra-950/80 px-3 py-1 text-capiz-300">
          {t('nhieui.readOf')}
        </span>
        <h2
          className="sign-pintor max-w-full text-[clamp(1.9rem,9.5vw,3.1rem)] [overflow-wrap:anywhere]"
          data-testid="turn-name"
        >
          {nameOf(readerId)}
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="chip" data-testid="nhie-round">
            {t('nhie.hud.round', { round: view.round })}
          </span>
          <span className="chip" data-testid="nhie-remaining">
            {t('nhie.hud.remaining', { n: view.remaining })}
          </span>
        </div>
      </section>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-3">
        {current ? (
          <>
            <article
              key={view.round}
              className="anim-pour relative rounded-[18px] border border-brass-500/80 bg-[linear-gradient(165deg,#fbf6ea,#eadfc8)] px-5 pt-3.5 pb-4 text-narra-950 shadow-[0_18px_40px_-14px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.7)]"
              style={{ animationDelay: `${PROMPT_DELAY_MS}ms` }}
              data-testid="nhie-prompt"
              aria-live="polite"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-[5px] rounded-[14px] border border-brass-500/45"
              />
              <span className="relative mb-1 flex items-center gap-2 font-sign text-[0.8rem] tracking-[0.08em] text-sili-600">
                #{view.round}
                <span aria-hidden className="h-px flex-1 bg-brass-500/50" />
              </span>
              <p className="relative text-[clamp(1.15rem,5.2vw,1.4rem)] leading-snug font-bold [overflow-wrap:anywhere]">
                <PromptText text={text} fills={fills} />
              </p>
            </article>

            <div className="panel flex flex-col gap-2 px-3 pt-2 pb-3">
              <div className="flex flex-col">
                <h3 className="font-sign text-lg leading-tight whitespace-nowrap text-brass-300">
                  {t('nhie.hud.whoDid')}
                </h3>
                <span className="text-xs font-bold text-capiz-400">{t('nhieui.pickHint')}</span>
              </div>
              <div
                className="flex max-h-[24dvh] flex-wrap gap-2 overflow-y-auto"
                role="group"
                aria-label={t('nhie.hud.whoDid')}
              >
                {view.order.map((id) => {
                  const on = did.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(id)}
                      className={`inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-4 font-bold transition-colors ${
                        on
                          ? 'border-brass-300 bg-brass-400 text-narra-950 shadow-[0_0_0_3px_rgb(232_176_74/0.25)]'
                          : 'border-narra-500 bg-narra-950/70 text-capiz-50 active:bg-narra-800'
                      }`}
                      data-testid="nhie-player"
                    >
                      {on && <IconCheck size={16} className="shrink-0" />}
                      <span className="truncate">{nameOf(id)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-brass min-h-16 w-full flex-col gap-0.5"
              disabled={locked}
              onClick={next}
              data-testid="nhie-next"
            >
              <span className="font-sign text-[1.5rem] leading-none">{t('nhie.hud.next')}</span>
              <span className="text-xs font-bold opacity-80">
                {did.length === 0
                  ? t('nhie.hud.nobody')
                  : t('nhieui.drinkers', { count: did.length })}
              </span>
            </button>
          </>
        ) : (
          <EndPanel empty={view.round === 0} />
        )}
      </section>
    </div>
  );
}
