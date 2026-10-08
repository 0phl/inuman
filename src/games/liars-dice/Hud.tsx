import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Action, Rules, View } from '@/core/games/liars-dice/logic';
import { Stepper } from '@/ui/controls';
import { DiceRow, DieFace } from '../mexico/DieFace';
import { TurnHeader } from '../mexico/hudKit';
import type { GameViewProps } from '../types';
import {
  clampDraft,
  FACES,
  isLegalBid,
  legalFaces,
  minQuantity,
  suggestBid,
  type BidDraft,
} from './bidding';
import { peekKeyOf, usePeek, usePeeking, usePrivateView } from './privateView';

/** Matches the cups' shake in the scene; bidding waits for it. */
const SHAKE_MS = 1100;

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function IconEye({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BidChip({ bid, name, latest }: { bid: BidDraft; name: string; latest: boolean }) {
  return (
    <li
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-bold ${
        latest ? 'border-brass-500 bg-narra-800 text-capiz-50' : 'border-narra-600 bg-black/30 text-capiz-300'
      }`}
      data-testid="ld-bid-chip"
    >
      <span className="max-w-[6.5rem] truncate">{name}</span>
      <span className="font-sign text-brass-300">{bid.quantity}×</span>
      <DieFace face={bid.face} size={18} tone={latest ? 'ivory' : 'dim'} />
    </li>
  );
}

/** Quantity stepper + face picker that can't go below the smallest legal raise, and the calls. */
function Composer({
  view,
  rules,
  locked,
  act,
}: {
  view: View;
  rules: Rules;
  locked: boolean;
  act(a: Action): void;
}) {
  const { t } = useTranslation();
  const last = view.lastBid;
  const total = view.totalDice;
  const key = `${view.round}:${view.bids.length}:${view.current}`;
  const [draft, setDraft] = useState(() => ({ key, ...suggestBid(last, total, rules.onesWild) }));
  let d = draft;
  if (d.key !== key) {
    // A new bidder starts from a fresh suggestion (adjusting state while rendering).
    d = { key, ...suggestBid(last, total, rules.onesWild) };
    setDraft(d);
  }
  const minQ = minQuantity(last, d.face);
  const { quantity } = clampDraft(d, last, total);
  const legal = isLegalBid({ quantity, face: d.face }, last, total);
  const faces = legalFaces(last, total);

  return (
    <section className="felt px-3.5 pt-3 pb-3.5" data-testid="ld-composer">
      <div className="relative z-10 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <Stepper
            value={quantity}
            min={Math.min(minQ, total)}
            max={total}
            onChange={(q) => setDraft({ ...d, quantity: q })}
            label={t('ld.hud.quantity')}
            testId="ld-quantity"
          />
          <span className="flex items-center gap-2 font-sign text-[1.6rem] leading-none text-capiz-50" aria-hidden>
            {quantity}
            <span className="text-brass-400">×</span>
            <DieFace face={d.face} size={38} />
          </span>
        </div>
        <div role="radiogroup" aria-label={t('ld.hud.face')} className="grid grid-cols-6 gap-1.5">
          {FACES.map((f) => {
            const ok = faces.includes(f);
            const on = f === d.face;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={String(f)}
                disabled={!ok}
                onClick={() => setDraft({ ...d, face: f, quantity: Math.max(quantity, minQuantity(last, f)) })}
                className={`grid min-h-12 place-items-center rounded-xl border transition-colors disabled:opacity-30 ${
                  on ? 'border-brass-400 bg-brass-400/25 shadow-[0_0_12px_rgb(232_176_74/0.45)]' : 'border-narra-600 bg-narra-950/60'
                }`}
                data-testid={`ld-face-${f}`}
              >
                <DieFace face={f} size={30} tone={on ? 'brass' : 'ivory'} label="" />
              </button>
            );
          })}
        </div>
        <div className={`grid gap-2 ${rules.spotOn ? 'grid-cols-[1.25fr_1fr_0.85fr]' : 'grid-cols-[1.2fr_1fr]'}`}>
          <button
            type="button"
            className="btn btn-brass min-h-14 px-2 font-sign text-lg"
            disabled={locked || !legal}
            onClick={() => act({ type: 'BID', quantity, face: d.face })}
            data-testid="ld-bid"
          >
            {t('ld.hud.bid')} {quantity}×{d.face}
          </button>
          <button
            type="button"
            className="btn btn-sili min-h-14 px-2 font-sign text-[1.05rem]"
            disabled={locked || !last}
            onClick={() => act({ type: 'CHALLENGE' })}
            data-testid="ld-challenge"
          >
            {t('ld.hud.challenge')}
          </button>
          {rules.spotOn && (
            <button
              type="button"
              className="btn btn-wood min-h-14 border-brass-600 px-2 font-sign text-[1.05rem] text-brass-200"
              disabled={locked || !last}
              onClick={() => act({ type: 'SPOT_ON' })}
              data-testid="ld-spoton"
            >
              {t('ld.hud.spotOn')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RevealPanel({
  view,
  nameOf,
  act,
}: {
  view: View;
  nameOf(id: string): string;
  act(a: Action): void;
}) {
  const { t } = useTranslation();
  const rv = view.reveal;
  if (!rv) return null;
  const reason =
    rv.call === 'challenge'
      ? rv.correct
        ? 'ld.reason.caught'
        : 'ld.reason.badCall'
      : rv.correct
        ? 'ld.reason.spotOn'
        : 'ld.reason.spotOnMiss';
  return (
    <section
      className="felt anim-pour px-4 pt-3 pb-4"
      data-testid="ld-reveal"
      data-count={rv.count}
      data-quantity={rv.bid.quantity}
      data-correct={rv.correct}
    >
      <div className="relative z-10 flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-sign text-xl text-brass-300">
            {t(rv.call === 'challenge' ? 'ld.hud.challenge' : 'ld.hud.spotOn')}
          </span>
          <span className="text-sm text-capiz-300">{t('ld.hud.caller', { name: nameOf(rv.caller) })}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 font-sign text-[2.4rem] leading-none text-capiz-50" data-testid="ld-count">
            {rv.count}
            <span className="text-brass-400">×</span>
            <DieFace face={rv.bid.face} size={40} />
          </span>
          <span className="flex min-w-0 flex-col text-sm leading-snug text-capiz-200">
            <span>{t('ld.hud.count', { count: rv.count })}</span>
            <span className="truncate">
              {t('ld.hud.lastBid', { name: nameOf(rv.bid.player), quantity: rv.bid.quantity, face: rv.bid.face })}
            </span>
          </span>
        </div>
        <p className="font-bold text-capiz-50" data-testid="ld-verdict">
          {t(reason)}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="eyebrow">{t('drink.group')}</span>
          {rv.losers.map((id) => (
            <span key={id} className="chip border-sili-500/70 text-capiz-50" data-testid="ld-loser">
              {nameOf(id)}
            </span>
          ))}
          {rv.out.map((id) => (
            <span key={`out:${id}`} className="chip border-capiz-400/50 text-capiz-400">
              {nameOf(id)} · {t('ld.hud.out')}
            </span>
          ))}
        </div>
        {view.winner === null && (
          <button
            type="button"
            className="btn btn-brass mt-1 min-h-14 font-sign text-xl"
            onClick={() => act({ type: 'NEXT_ROUND' })}
            data-testid="ld-next"
          >
            {t('ld.hud.nextRound')}
          </button>
        )}
      </div>
    </section>
  );
}

export default function LiarsDiceHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const act = (action: Action) => dispatch({ type: 'GAME', action });
  const bidding = view.phase === 'bidding' && view.current !== null;

  // Private peek: only the current bidder's own projection, only while open.
  const peeking = usePeeking(view);
  const openPeek = usePeek((s) => s.open);
  const closePeek = usePeek((s) => s.close);
  const mine = usePrivateView<View>(peeking ? view.current : null)?.mine ?? null;
  useEffect(() => () => closePeek(), [closePeek]);

  // Cups shake at the start of every round; bidding opens when they're down.
  const [shookRoll, setShookRoll] = useState(() =>
    view.phase === 'bidding' && view.bids.length === 0 ? -1 : view.roll.id,
  );
  const shaking = view.phase === 'bidding' && shookRoll !== view.roll.id;
  useEffect(() => {
    if (shookRoll === view.roll.id) return;
    const id = view.roll.id;
    const timer = window.setTimeout(() => setShookRoll(id), prefersReducedMotion() ? 0 : SHAKE_MS);
    return () => window.clearTimeout(timer);
  }, [shookRoll, view.roll.id]);

  const strip = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [view.bids.length]);

  const last = view.lastBid;
  const reveal = view.phase === 'reveal' ? view.reveal : null;

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex flex-col gap-2">
        {reveal ? (
          <TurnHeader
            eyebrow={t('ld.hud.reveal')}
            name={reveal.losers.map(nameOf).join(' & ')}
            testId="ld-losers"
            tone="sili"
          >
            <span className="chip">{t('ld.hud.round', { round: view.round })}</span>
            <span className="chip">{t('ld.hud.totalDice', { n: view.totalDice })}</span>
          </TurnHeader>
        ) : (
          <TurnHeader
            eyebrow={t('play.turnOf')}
            name={view.current ? nameOf(view.current) : ''}
            aria={view.current ? t('ld.hud.turn', { name: nameOf(view.current) }) : undefined}
          >
            <span className="chip" data-testid="ld-round">
              {t('ld.hud.round', { round: view.round })}
            </span>
            <span className="chip" data-testid="ld-total">
              {t('ld.hud.totalDice', { n: view.totalDice })}
            </span>
            {r.onesWild && <span className="chip text-brass-200">{t('ld.hud.wild')}</span>}
            {shaking ? (
              <span className="chip anim-fade w-full justify-center border-brass-500/60 text-capiz-200" data-testid="ld-shaking">
                {t('ld.hud.shaking')}
              </span>
            ) : (
              <span
                className={`chip w-full justify-center ${last ? 'border-brass-500/70 text-capiz-50' : 'text-capiz-300'}`}
                data-testid="ld-last-bid"
              >
                {last ? (
                  <>
                    {t('ld.hud.lastBid', { name: nameOf(last.player), quantity: last.quantity, face: last.face })}
                    <DieFace face={last.face} size={20} />
                  </>
                ) : (
                  t('ld.hud.noBid')
                )}
              </span>
            )}
          </TurnHeader>
        )}

        {peeking && mine && (
          <section
            className="panel anim-pour pointer-events-auto mx-auto flex w-full max-w-[440px] items-center gap-3 border-brass-500/70 p-3"
            data-testid="ld-peek-panel"
            aria-live="polite"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="eyebrow text-brass-300">{t('ld.hud.yourDice')}</span>
              <DiceRow faces={mine} size={38} className="flex-wrap gap-1.5" />
            </div>
            <button type="button" className="btn btn-wood min-h-12 px-4" onClick={closePeek} data-testid="ld-hide">
              {t('ld.hud.hide')}
            </button>
          </section>
        )}
      </div>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        {reveal ? (
          <RevealPanel view={view} nameOf={nameOf} act={act} />
        ) : bidding ? (
          <>
            <div className="flex items-center gap-2">
              <ul
                ref={strip}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]"
                aria-label={t('ld.hud.bids')}
                data-testid="ld-bids"
              >
                {view.bids.map((b, i) => (
                  <BidChip key={i} bid={b} name={nameOf(b.player)} latest={i === view.bids.length - 1} />
                ))}
              </ul>
              {!peeking && (
                <button
                  type="button"
                  className="btn btn-wood min-h-11 shrink-0 gap-1.5 border-brass-600 px-3 text-sm text-brass-200"
                  onClick={() => {
                    const key = peekKeyOf(view);
                    if (key) openPeek(key);
                  }}
                  data-testid="ld-peek"
                >
                  <IconEye size={18} />
                  {t('diceui.ld.peekMine')}
                </button>
              )}
            </div>
            <Composer view={view} rules={r} locked={shaking} act={act} />
          </>
        ) : null}
      </section>

      {view.winner !== null && (
        // Sits over the play screen's game-over cover so the winner is named there too.
        <div
          className="anim-pour pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-[31] mx-auto flex max-w-[440px] flex-col items-center px-4 text-center"
          data-testid="ld-winner"
        >
          <span className="eyebrow text-brass-300">{t('game.liars-dice.title')}</span>
          <span className="sign-pintor max-w-full text-[clamp(1.8rem,9vw,2.8rem)] [overflow-wrap:anywhere]">
            {t('ld.hud.winner', { name: nameOf(view.winner) })}
          </span>
        </div>
      )}
    </div>
  );
}
