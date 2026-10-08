import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Result, View } from '@/core/games/most-likely-to/logic';
import { useSettings } from '@/store/settings';
import { BottleCap } from '@/ui/BottleCap';
import { IconCheck } from '@/ui/icons';
import { GameHeader } from '../truth-or-dare/hudKit';
import { promptFills, promptText } from '../truth-or-dare/promptFill';
import { PromptCard, PromptText } from '../truth-or-dare/promptKit';
import type { GameViewProps } from '../types';

type Dispatch = GameViewProps<View>['dispatch'];

/** Buttons stay locked while the tent card turns to the next prompt (Scene SPIN_SECONDS). */
const NEXT_LOCK_MS = 850;
/** The tallies grow in after the caps start dropping. */
const TALLY_DELAY_MS = 250;

function chipClass(on: boolean): string {
  return `inline-flex min-h-12 max-w-full items-center gap-1.5 rounded-full border px-4 font-bold transition-colors ${
    on
      ? 'border-brass-300 bg-brass-400 text-narra-950 shadow-[0_0_0_3px_rgb(232_176_74/0.25)]'
      : 'border-narra-500 bg-narra-950/70 text-capiz-50 active:bg-narra-800'
  }`;
}

/** Point mode: the table points on three, the reader taps everyone who got pointed at. */
function PointPanel({
  view,
  nameOf,
  dispatch,
}: {
  view: View;
  nameOf(id: string): string;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<{ round: number; ids: string[] }>({ round: view.round, ids: [] });
  const ids = sel.round === view.round ? sel.ids : [];
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    if (!locked) return;
    const id = window.setTimeout(() => setLocked(false), NEXT_LOCK_MS);
    return () => window.clearTimeout(id);
  }, [locked]);

  const toggle = (id: string) =>
    setSel({
      round: view.round,
      ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    });
  const send = (action: { type: 'PICK'; players: string[] } | { type: 'NEXT' }) => {
    if (dispatch({ type: 'GAME', action })) return;
    setSel({ round: view.round, ids: [] });
    setLocked(true);
  };

  return (
    <>
      <div className="panel flex flex-col gap-2 px-3 pt-2 pb-3">
        <div className="flex flex-col">
          <h3 className="font-sign text-lg leading-tight text-brass-300">
            {t('mlt.hud.whoPicked')}
          </h3>
          <span className="text-xs font-bold text-capiz-400">{t('mlt.hud.point')}</span>
        </div>
        <div
          className="flex max-h-[22dvh] flex-wrap gap-2 overflow-y-auto"
          role="group"
          aria-label={t('mlt.hud.whoPicked')}
        >
          {view.order.map((id) => {
            const on = ids.includes(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(id)}
                className={chipClass(on)}
                data-testid="mlt-player"
              >
                {on && <IconCheck size={16} className="shrink-0" />}
                <span className="truncate">{nameOf(id)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-2">
        <button
          type="button"
          className="btn btn-wood"
          disabled={locked}
          onClick={() => send({ type: 'NEXT' })}
          data-testid="mlt-skip"
        >
          {t('mlt.hud.skip')}
        </button>
        <button
          type="button"
          className="btn btn-brass min-h-14 flex-col gap-0.5"
          disabled={locked || ids.length === 0}
          onClick={() => send({ type: 'PICK', players: ids })}
          data-testid="mlt-pick"
        >
          <span className="font-sign text-[1.35rem] leading-none">{t('mlt.hud.pick')}</span>
          {ids.length > 0 && (
            <span className="text-xs font-bold opacity-80">
              {t('nhieui.drinkers', { count: ids.length })}
            </span>
          )}
        </button>
      </div>
    </>
  );
}

/**
 * Secret mode: only the current voter's question and their own pick. The selection belongs to
 * this voter (keyed by who and how many have voted), so nothing carries over to the next one.
 */
function VotePanel({
  view,
  nameOf,
  dispatch,
}: {
  view: View;
  nameOf(id: string): string;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const cast = view.voted.filter(Boolean).length;
  const key = `${view.round}:${view.voter}:${cast}`;
  const [sel, setSel] = useState<{ key: string; id: string | null }>({ key, id: null });
  const choice = sel.key === key ? sel.id : null;
  const voter = view.voter;

  const vote = () => {
    if (!choice) return;
    if (!dispatch({ type: 'GAME', action: { type: 'VOTE', for: choice } }))
      setSel({ key, id: null });
  };

  return (
    <section className="felt px-4 pt-3 pb-3.5" data-testid="mlt-voting">
      <div className="relative z-10 flex flex-col gap-2.5">
        <div className="flex flex-col">
          <h3
            className="font-sign text-[1.2rem] leading-tight text-capiz-50"
            data-testid="mlt-vote-ask"
          >
            {t('mltui.voteAsk', { name: voter ? nameOf(voter) : '?' })}
          </h3>
          <span className="text-xs font-bold text-capiz-300">{t('mltui.secretHint')}</span>
        </div>
        <div
          role="radiogroup"
          aria-label={t('mltui.voteAsk', { name: voter ? nameOf(voter) : '?' })}
          className="flex max-h-[22dvh] flex-wrap gap-2 overflow-y-auto"
        >
          {view.order.map((id) => {
            const on = id === choice;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSel({ key, id })}
                className={chipClass(on)}
                data-testid="mlt-choice"
              >
                <span className="truncate">{nameOf(id)}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn-brass min-h-14 w-full font-sign text-[1.4rem]"
          disabled={!choice}
          onClick={vote}
          data-testid="mlt-vote"
        >
          {t('mlt.hud.vote')}
        </button>
      </div>
    </section>
  );
}

function TallyPanel({
  result,
  order,
  nameOf,
  dispatch,
}: {
  result: Result;
  order: readonly string[];
  nameOf(id: string): string;
  dispatch: Dispatch;
}) {
  const { t } = useTranslation();
  const tally = result.tally ?? [];
  const top = Math.max(1, ...tally);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setGrown(true), TALLY_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      <section
        className="panel anim-pour flex flex-col gap-1.5 px-3 py-2.5"
        data-testid="mlt-reveal"
      >
        <ul
          className="flex max-h-[34dvh] flex-col gap-1.5 overflow-y-auto"
          aria-label={t('mlt.hud.reveal')}
        >
          {order.map((id, i) => {
            const n = tally[i] ?? 0;
            const most = result.picked.includes(id);
            return (
              <li
                key={id}
                className={`grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-2.5 rounded-xl px-2 py-1 ${
                  most ? 'bg-sili-600/20 ring-1 ring-sili-500/70' : ''
                }`}
                data-testid="mlt-tally"
                data-most={most}
                data-votes={n}
                aria-label={t('mlt.hud.votes', { n }) + ` · ${nameOf(id)}`}
              >
                <span className="flex min-w-0 flex-col leading-tight">
                  <span
                    className={`truncate font-bold ${most ? 'text-[#ff8a6b]' : 'text-capiz-50'}`}
                  >
                    {nameOf(id)}
                  </span>
                  {most && (
                    <span className="text-[0.7rem] font-bold tracking-[0.08em] text-brass-300 uppercase">
                      {t('mlt.hud.most')}
                    </span>
                  )}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-narra-950/80 ring-1 ring-narra-600">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                      most
                        ? 'bg-[linear-gradient(90deg,#b8341f,#ef6a4f)]'
                        : 'bg-[linear-gradient(90deg,#a8772a,#e8b04a)]'
                    }`}
                    style={{
                      width: grown ? `${(n / top) * 100}%` : '0%',
                      transitionDelay: `${i * 90}ms`,
                    }}
                  />
                </span>
                <BottleCap size={30} tone={most ? 'sili' : n > 0 ? 'brass' : 'felt'}>
                  {n}
                </BottleCap>
              </li>
            );
          })}
        </ul>
      </section>
      <button
        type="button"
        className="btn btn-brass min-h-16 w-full font-sign text-[1.6rem]"
        onClick={() => dispatch({ type: 'GAME', action: { type: 'NEXT' } })}
        data-testid="mlt-next"
      >
        {t('mlt.hud.next')}
      </button>
    </>
  );
}

function EndPanel({ empty }: { empty: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      className="panel anim-pour flex flex-col items-center gap-2 px-5 py-6 text-center"
      data-testid="mlt-end"
    >
      <h3 className="sign-pintor text-[clamp(1.8rem,8vw,2.6rem)]">{t('mlt.hud.done')}</h3>
      {empty && <p className="text-capiz-200">{t('mlt.hud.empty')}</p>}
    </section>
  );
}

export default function MostLikelyToHud({ view, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const locale = useSettings((s) => s.locale);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const reader = view.order[view.reader];
  const prompt = view.prompt;
  const fills = promptFills(view.order, reader, prompt?.targets.random, nameOf);
  const cast = view.voted.filter(Boolean).length;
  const reveal = view.phase === 'reveal' ? view.last : null;

  let eyebrow: string = t('nhieui.readOf');
  let name = reader ? nameOf(reader) : '';
  if (view.phase === 'vote' && view.voter) {
    eyebrow = t('mltui.voterOf');
    name = nameOf(view.voter);
  } else if (reveal) {
    eyebrow = t('mlt.hud.reveal');
    name = reveal.picked.map(nameOf).join(' & ');
  } else if (view.phase === 'over') {
    eyebrow = t('game.most-likely-to.title');
    name = t('mlt.hud.done');
  }

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <GameHeader eyebrow={eyebrow} name={name} tone={reveal ? 'sili' : 'brass'}>
        {view.round > 0 && (
          <span className="chip" data-testid="mlt-round">
            {t('mlt.hud.round', { round: view.round })}
          </span>
        )}
        {view.phase === 'vote' && (
          <>
            <span className="chip" data-testid="mlt-voted">
              {t('mlt.hud.voted', { n: cast, total: view.order.length })}
            </span>
            {reader && (
              <span className="chip">{t('mlt.hud.reader', { name: nameOf(reader) })}</span>
            )}
          </>
        )}
        {view.phase === 'read' && (
          <span className="chip" data-testid="mlt-remaining">
            {t('mlt.hud.remaining', { n: view.remaining })}
          </span>
        )}
      </GameHeader>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        {(view.phase === 'read' || view.phase === 'vote') && prompt && (
          <PromptCard key={view.round} eyebrow={`#${view.round}`} testId="mlt-prompt">
            <PromptText text={promptText(prompt.item, locale)} fills={fills} />
          </PromptCard>
        )}
        {view.phase === 'read' && <PointPanel view={view} nameOf={nameOf} dispatch={dispatch} />}
        {view.phase === 'vote' && <VotePanel view={view} nameOf={nameOf} dispatch={dispatch} />}
        {reveal && (
          <TallyPanel
            key={reveal.round}
            result={reveal}
            order={view.order}
            nameOf={nameOf}
            dispatch={dispatch}
          />
        )}
        {view.phase === 'over' && <EndPanel empty={view.round === 0} />}
      </section>
    </div>
  );
}
