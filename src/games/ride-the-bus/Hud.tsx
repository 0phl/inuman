import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Action, LastAnswer, Rules, View } from '@/core/games/ride-the-bus/logic';
import { SUITS, rankKey, suitOf, type Card, type Suit } from '@/core/primitives/deck';
import { IconArrowDown, IconArrowUp } from '@/ui/icons';
import { GameHeader } from '../truth-or-dare/hudKit';
import type { GameViewProps } from '../types';

type Dispatch = GameViewProps<View>['dispatch'];

const SUIT_GLYPH: Record<Suit, string> = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };
/** Answer buttons stay locked while the card flies to its spot (Scene FLY_S + a beat). */
const FLIGHT_MS = 850;
/** FLIP stays locked while the pyramid card turns and the matches fly in. */
const FLIP_LOCK_MS = 1100;
const BANNER_DELAY_MS = 650;
const BANNER_MS = 2200;

const isRedCard = (c: Card) => suitOf(c) === 'H' || suitOf(c) === 'D';

function CardChip({ card, size = 'md' }: { card: Card; size?: 'md' | 'lg' }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border border-[#d9c9a6] bg-capiz-50 font-bold leading-none ${
        size === 'lg' ? 'min-w-14 px-2 py-1.5 text-xl' : 'min-w-11 px-1.5 py-0.5'
      } ${isRedCard(card) ? 'text-[#b3121f]' : 'text-narra-950'}`}
    >
      {rankKey(card)}
      {SUIT_GLYPH[suitOf(card)]}
    </span>
  );
}

/** "Tama!" / "Mali!" once the card has landed in its spot. */
function OutcomeBanner({ last }: { last: LastAnswer }) {
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
  return (
    <div
      role="status"
      data-testid="rtb-outcome"
      data-correct={last.correct}
      className={`anim-pour mx-auto flex items-center gap-3 rounded-2xl border px-4 py-2 shadow-xl ${
        last.correct ? 'border-felt-600 bg-felt-800/95' : 'border-sili-500 bg-[#3a120b]/95'
      }`}
    >
      <span className="font-sign text-2xl leading-none text-capiz-50">
        {t(last.correct ? 'rtb.hud.correct' : 'rtb.hud.wrong')}
      </span>
      <CardChip card={last.card} />
    </div>
  );
}

function AnswerButton({
  guess,
  onClick,
  disabled,
  className,
  children,
}: {
  guess: string;
  onClick(): void;
  disabled: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn min-h-[4.5rem] flex-col gap-0.5 ${className}`}
      disabled={disabled}
      onClick={onClick}
      data-testid="rtb-answer"
      data-guess={guess}
    >
      {children}
    </button>
  );
}

/** The question for the next card, with the cards it is judged against, and its answers. */
function QuestionPad({
  question,
  run,
  locked,
  answer,
}: {
  question: NonNullable<View['question']>;
  run: readonly Card[];
  locked: boolean;
  answer(a: Action): void;
}) {
  const { t } = useTranslation();
  const q = ['RED_BLACK', 'HIGHER_LOWER', 'INSIDE_OUTSIDE', 'SUIT'].indexOf(question) + 1;
  const a = run[0];
  const b = run[1];
  let pad: ReactNode = null;
  switch (question) {
    case 'RED_BLACK':
      pad = (
        <div className="grid grid-cols-2 gap-3">
          <AnswerButton
            guess="red"
            disabled={locked}
            onClick={() => answer({ type: 'RED_BLACK', guess: 'red' })}
            className="btn-sili font-sign text-[1.35rem]"
          >
            <span aria-hidden className="text-lg leading-none">
              ♥︎♦︎
            </span>
            {t('rtb.hud.red')}
          </AnswerButton>
          <AnswerButton
            guess="black"
            disabled={locked}
            onClick={() => answer({ type: 'RED_BLACK', guess: 'black' })}
            className="border border-narra-500 bg-[linear-gradient(180deg,#2a221d,#0e0805)] font-sign text-[1.35rem] text-capiz-50 shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_3px_0_#000]"
          >
            <span aria-hidden className="text-lg leading-none">
              ♠︎♣︎
            </span>
            {t('rtb.hud.black')}
          </AnswerButton>
        </div>
      );
      break;
    case 'HIGHER_LOWER':
      pad = (
        <div className="grid grid-cols-2 gap-3">
          <AnswerButton
            guess="higher"
            disabled={locked}
            onClick={() => answer({ type: 'HIGHER_LOWER', guess: 'higher' })}
            className="btn-brass font-sign text-lg"
          >
            <IconArrowUp />
            {t('rtb.hud.higher')}
          </AnswerButton>
          <AnswerButton
            guess="lower"
            disabled={locked}
            onClick={() => answer({ type: 'HIGHER_LOWER', guess: 'lower' })}
            className="btn-wood border-brass-600 font-sign text-lg text-brass-200"
          >
            <IconArrowDown />
            {t('rtb.hud.lower')}
          </AnswerButton>
        </div>
      );
      break;
    case 'INSIDE_OUTSIDE':
      pad = (
        <div className="grid grid-cols-2 gap-3">
          <AnswerButton
            guess="inside"
            disabled={locked}
            onClick={() => answer({ type: 'INSIDE_OUTSIDE', guess: 'inside' })}
            className="btn-brass font-sign text-lg"
          >
            <span aria-hidden className="text-xl leading-none">
              → ←
            </span>
            {t('rtb.hud.inside')}
          </AnswerButton>
          <AnswerButton
            guess="outside"
            disabled={locked}
            onClick={() => answer({ type: 'INSIDE_OUTSIDE', guess: 'outside' })}
            className="btn-wood border-brass-600 font-sign text-lg text-brass-200"
          >
            <span aria-hidden className="text-xl leading-none">
              ← →
            </span>
            {t('rtb.hud.outside')}
          </AnswerButton>
        </div>
      );
      break;
    case 'SUIT':
      pad = (
        <div className="grid grid-cols-4 gap-2">
          {SUITS.map((s) => (
            <AnswerButton
              key={s}
              guess={s}
              disabled={locked}
              onClick={() => answer({ type: 'SUIT', guess: s })}
              className="border border-[#d9c9a6] bg-[linear-gradient(180deg,#fbf7ec,#e6dcc4)] px-1 shadow-[0_3px_0_#a8916f]"
            >
              <span
                aria-hidden
                className={`text-[2rem] leading-none ${s === 'H' || s === 'D' ? 'text-[#b3121f]' : 'text-narra-950'}`}
              >
                {SUIT_GLYPH[s]}
              </span>
              <span className="text-[0.78rem] font-bold text-narra-800">
                {t(`rtb.hud.suit.${s}`)}
              </span>
            </AnswerButton>
          ))}
        </div>
      );
      break;
  }
  return (
    <section
      className="felt px-3.5 pt-3 pb-3.5"
      data-testid="rtb-question"
      data-question={question}
    >
      <div className="relative z-10 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-sign text-[1.3rem] leading-tight text-capiz-50">
            {t(`rtb.hud.q${q}`)}
          </h3>
          {question === 'HIGHER_LOWER' && a !== undefined && <CardChip card={a} />}
          {question === 'INSIDE_OUTSIDE' && a !== undefined && b !== undefined && (
            <span className="flex items-center gap-1.5">
              <CardChip card={a} />
              <span aria-hidden className="text-capiz-300">
                –
              </span>
              <CardChip card={b} />
            </span>
          )}
        </div>
        {pad}
      </div>
    </section>
  );
}

function useLock(ms: number): [boolean, () => void] {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!locked) return;
    const id = window.setTimeout(() => setLocked(false), ms);
    return () => window.clearTimeout(id);
  }, [locked, ms]);
  return [locked, () => setLocked(true)];
}

function PyramidPanel({ view, dispatch }: { view: View; dispatch: Dispatch }) {
  const { t } = useTranslation();
  const [locked, lock] = useLock(FLIP_LOCK_MS);
  const next = view.pyramid[view.flipped];
  const shown = view.flipped > 0 ? view.pyramid[view.flipped - 1] : undefined;
  return (
    <>
      <section className="panel flex items-center gap-3 px-3.5 py-2.5" data-testid="rtb-pyramid">
        {shown?.card != null ? (
          <CardChip card={shown.card} size="lg" />
        ) : (
          <span className="grid h-10 min-w-14 place-items-center rounded-md border border-dashed border-brass-500/60 font-sign text-brass-400">
            ?
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="font-bold text-capiz-50">
            {shown ? t('rtbui.lastFlip') : t('rtbui.pyramidHint')}
          </span>
          {next && (
            <span className="text-sm text-capiz-300" data-testid="rtb-row">
              {t('rtb.hud.row', { row: next.row, sips: next.row })}
            </span>
          )}
        </div>
      </section>
      <button
        type="button"
        className="btn btn-brass min-h-16 w-full font-sign text-[1.6rem]"
        disabled={locked}
        onClick={() => {
          if (!dispatch({ type: 'GAME', action: { type: 'FLIP' } })) lock();
        }}
        data-testid="rtb-flip"
      >
        {t('rtb.hud.flip')}
      </button>
    </>
  );
}

function BoardPanel({
  view,
  nameOf,
  dispatch,
}: {
  view: View;
  nameOf(id: string): string;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const rider = view.bus?.rider;
  return (
    <>
      <section className="panel flex flex-col gap-1.5 px-3.5 py-3" data-testid="rtb-board-panel">
        <span className="eyebrow">{t('rtbui.leftovers')}</span>
        <ul className="flex flex-wrap gap-1.5">
          {view.order.map((id, i) => (
            <li
              key={id}
              className={`chip min-h-8 ${id === rider ? 'border-sili-500 text-[#ff8a6b]' : ''}`}
            >
              <span className="max-w-[7rem] truncate">{nameOf(id)}</span>
              <span className="text-capiz-300">
                {t('rtb.hud.leftover', { n: view.leftover?.[i] ?? 0 })}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <button
        type="button"
        className="btn btn-sili min-h-16 w-full font-sign text-[1.5rem]"
        onClick={() => dispatch({ type: 'GAME', action: { type: 'BOARD' } })}
        data-testid="rtb-board"
      >
        {t('rtb.hud.board')}
      </button>
    </>
  );
}

export default function RideTheBusHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const [locked, lock] = useLock(FLIGHT_MS);
  // Fresh answers (not one restored on reload) get the outcome banner.
  const [mountLast] = useState(view.last);

  const answer = (a: Action) => {
    if (!dispatch({ type: 'GAME', action: a })) lock();
  };

  const bus = view.bus;
  const run: readonly Card[] =
    view.phase === 'bus' ? (bus?.cards ?? []) : (view.hands[view.turn] ?? []);
  const q = view.question
    ? ['RED_BLACK', 'HIGHER_LOWER', 'INSIDE_OUTSIDE', 'SUIT'].indexOf(view.question) + 1
    : 0;

  let eyebrow = t('play.turnOf');
  let name = view.current ? nameOf(view.current) : '';
  let tone: 'brass' | 'sili' = 'brass';
  if (view.phase === 'pyramid') {
    eyebrow = t('rtbui.pyramidEyebrow');
    name = t('rtb.hud.pyramid');
  } else if (view.phase === 'board') {
    eyebrow = t('rtbui.riderEyebrow');
    tone = 'sili';
  } else if (view.phase === 'bus') {
    eyebrow = t('rtbui.busEyebrow');
    tone = 'sili';
  } else if (view.phase === 'over') {
    eyebrow = bus ? nameOf(bus.rider) : t('game.ride-the-bus.title');
    name = bus?.outcome === 'released' ? t('rtb.hud.released') : t('rtb.hud.offBus');
  }

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <GameHeader eyebrow={eyebrow} name={name} tone={tone}>
        {view.question && (
          <span className="chip" data-testid="rtb-qnum">
            {t('rtb.hud.question', { q })}
          </span>
        )}
        {(view.phase === 'bus' || view.phase === 'board') && bus && (
          <span className="chip border-sili-500/70" data-testid="rtb-attempt">
            {t('rtb.hud.attempt', { attempt: bus.attempt, max: r.busMaxAttempts })}
          </span>
        )}
        {view.phase === 'pyramid' && (
          <span className="chip" data-testid="rtb-flipped">
            {t('rtbui.flipped', { n: view.flipped, total: view.pyramid.length })}
          </span>
        )}
        {(view.phase === 'deal' || view.phase === 'bus') && (
          <span className="chip" data-testid="deck-count">
            {t('rtb.hud.deck', { n: view.deckCount })}
          </span>
        )}
      </GameHeader>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        <div className="min-h-12">
          {view.last && view.last !== mountLast && view.phase !== 'board' && (
            <OutcomeBanner key={JSON.stringify(view.last)} last={view.last} />
          )}
        </div>
        {view.question && (
          <QuestionPad question={view.question} run={run} locked={locked} answer={answer} />
        )}
        {view.phase === 'pyramid' && <PyramidPanel view={view} dispatch={dispatch} />}
        {view.phase === 'board' && <BoardPanel view={view} nameOf={nameOf} dispatch={dispatch} />}
        {view.phase === 'over' && (
          <section
            className="panel anim-pour flex flex-col items-center gap-1 px-5 py-5 text-center"
            data-testid="rtb-over"
            data-outcome={bus?.outcome ?? ''}
          >
            <h3 className="sign-pintor text-[clamp(1.8rem,8vw,2.4rem)]">
              {bus?.outcome === 'released' ? t('rtb.hud.released') : t('rtb.hud.offBus')}
            </h3>
          </section>
        )}
      </section>
    </div>
  );
}
