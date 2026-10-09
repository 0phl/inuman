import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rules, View } from '@/core/games/higher-lower/logic';
import { rankKey, suitOf, type Card } from '@/core/primitives/deck';
import { IconArrowDown, IconArrowUp } from '@/ui/icons';
import { useToastAnchor } from '@/ui/toastAnchor';
import type { GameViewProps } from '../types';

const SUIT_GLYPH = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' } as const;
/** Guess buttons stay locked while the card is in the air. */
const FLIGHT_MS = 850;
const BANNER_DELAY_MS = 600;
const BANNER_MS = 2400;

const cardLabel = (c: Card) => `${rankKey(c)}${SUIT_GLYPH[suitOf(c)]}`;
const isRedCard = (c: Card) => suitOf(c) === 'H' || suitOf(c) === 'D';

function CardChip({ card }: { card: Card }) {
  return (
    <span
      className={`inline-flex min-w-11 items-center justify-center rounded-md bg-capiz-50 px-1.5 py-0.5 font-bold ${
        isRedCard(card) ? 'text-[#b3121f]' : 'text-narra-950'
      }`}
    >
      {cardLabel(card)}
    </span>
  );
}

function OutcomeBanner({ last }: { last: NonNullable<View['last']> }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'wait' | 'show' | 'gone'>('wait');
  useEffect(() => {
    const a = window.setTimeout(() => setPhase('show'), BANNER_DELAY_MS);
    const b = window.setTimeout(() => setPhase('gone'), BANNER_DELAY_MS + BANNER_MS);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  if (phase !== 'show') return null;
  const tone =
    last.outcome === 'correct'
      ? 'border-felt-600 bg-felt-800/95'
      : last.outcome === 'wrong'
        ? 'border-sili-500 bg-[#3a120b]/95'
        : 'border-brass-500 bg-narra-800/95';
  return (
    <div
      role="status"
      data-testid="hl-outcome"
      data-outcome={last.outcome}
      className={`anim-pour mx-auto flex items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-xl ${tone}`}
    >
      <span className="font-sign text-2xl leading-none text-capiz-50">
        {t(`play.hl.outcome.${last.outcome}`)}
      </span>
      <span className="flex items-center gap-1.5 text-capiz-200">
        <CardChip card={last.prev} />
        <span aria-hidden>→</span>
        <CardChip card={last.card} />
      </span>
    </div>
  );
}

export default function HigherLowerHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const anchor = useToastAnchor<HTMLElement>();
  const current = view.pile[view.pile.length - 1];
  const turnId = view.order[view.turn];
  const name = players.find((p) => p.id === turnId)?.name ?? '';
  const [lockedUntilLast, setLockedUntilLast] = useState<View['last'] | undefined>(undefined);
  const prevLast = useRef(view.last);

  // Lock the buttons for the flip each time a new result arrives.
  useEffect(() => {
    if (view.last === prevLast.current) return;
    prevLast.current = view.last;
    const t0 = window.setTimeout(() => setLockedUntilLast(undefined), FLIGHT_MS);
    return () => window.clearTimeout(t0);
  }, [view.last]);

  const guess = (g: 'higher' | 'lower') => {
    const err = dispatch({ type: 'GAME', action: { type: 'GUESS', guess: g } });
    if (!err) setLockedUntilLast(view.last);
  };
  const locked = lockedUntilLast !== undefined;
  const dots = r.passAfter > 0 ? r.passAfter : 0;

  return (
    <div className="flex h-full flex-col justify-between">
      <section
        ref={anchor}
        className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-2 [&_.chip]:bg-narra-950/85 [&_.chip]:backdrop-blur-sm bg-[radial-gradient(closest-side,rgb(14_8_5/0.7),transparent)] pt-1 pb-2 text-center"
      >
        <span className="eyebrow rounded-full bg-narra-950/80 px-3 py-1 text-capiz-300">
          {t('play.turnOf')}
        </span>
        <h2
          className="sign-pintor max-w-full text-[clamp(2rem,10.5vw,3.4rem)] [overflow-wrap:anywhere]"
          data-testid="turn-name"
        >
          {name}
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {dots > 0 && (
            <span
              className="chip"
              aria-label={t('play.hl.streakAria', { streak: view.streak, need: dots })}
            >
              <span className="mr-0.5">{t('play.hl.streak')}</span>
              {Array.from({ length: dots }, (_, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={`size-2.5 rounded-full ${i < view.streak ? 'bg-brass-400 shadow-[0_0_6px_rgb(232_176_74/0.8)]' : 'bg-narra-500'}`}
                />
              ))}
            </span>
          )}
          <span className="chip" data-testid="deck-count">
            {t('play.hl.deckLeft', { count: view.deckCount })}
          </span>
          {current !== undefined && (
            <span className="chip">
              {t('play.hl.onTable')} <CardChip card={current} />
            </span>
          )}
        </div>
      </section>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-3">
        <div className="min-h-14">
          {view.last && <OutcomeBanner key={JSON.stringify(view.last)} last={view.last} />}
        </div>
        <p className="text-center text-sm text-capiz-300">{t('play.hl.prompt')}</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="btn btn-brass min-h-20 flex-col gap-1 font-sign text-lg"
            disabled={locked}
            onClick={() => guess('higher')}
            data-testid="guess-higher"
          >
            <IconArrowUp />
            {t('play.hl.higher')}
          </button>
          <button
            type="button"
            className="btn btn-wood min-h-20 flex-col gap-1 border-brass-600 font-sign text-lg text-brass-200"
            disabled={locked}
            onClick={() => guess('lower')}
            data-sfx="primary"
            data-testid="guess-lower"
          >
            <IconArrowDown />
            {t('play.hl.lower')}
          </button>
        </div>
      </section>
    </div>
  );
}
