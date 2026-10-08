import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isMexico,
  mexicoRank,
  type Result,
  type Rules,
  type View,
} from '@/core/games/mexico/logic';
import type { Face } from '@/core/primitives/dice';
import type { GameViewProps } from '../types';
import { DiceRow } from './DieFace';
import { RollsChip, TurnHeader } from './hudKit';

type Kind = 'mexico' | 'doubles' | 'score';

/** How a Mexico roll reads: 2-1 is Mexico, then doubles (5-5), then high-first scores (63). */
function outcomeOf(faces: readonly Face[]): { kind: Kind; value: string; rank: number } {
  const rank = mexicoRank(faces);
  const a = Math.max(...faces);
  const b = Math.min(...faces);
  if (isMexico(faces)) return { kind: 'mexico', value: '2-1', rank };
  if (a === b) return { kind: 'doubles', value: `${a}-${b}`, rank };
  return { kind: 'score', value: `${a}${b}`, rank };
}

const highFirst = (faces: readonly Face[]): Face[] => [...faces].sort((x, y) => y - x);
const sameFaces = (a: readonly Face[], b: readonly Face[]) =>
  a.length === b.length && a.every((f, i) => f === b[i]);

function ResultBanner({
  faces,
  rollId,
  who,
}: {
  faces: Face[];
  rollId: number;
  who: string | null;
}) {
  const { t } = useTranslation();
  const o = outcomeOf(faces);
  const label =
    o.kind === 'mexico' ? '2-1' : o.kind === 'doubles' ? t('mx.hud.doubles') : t('mx.hud.score');
  const mexico = o.kind === 'mexico';
  return (
    <div
      role="status"
      data-testid="mx-result"
      data-roll-id={rollId}
      data-rank={o.rank}
      data-kind={o.kind}
      className={`anim-pour mx-auto flex items-center gap-3 rounded-2xl border px-4 py-2 shadow-xl ${
        mexico
          ? 'border-sili-500 bg-[#3a120b]/95 shadow-[0_0_28px_-6px_rgb(224_72_47/0.7)]'
          : 'border-brass-500/70 bg-narra-850/95'
      }`}
    >
      <DiceRow faces={highFirst(faces)} size={36} />
      <span className="flex min-w-0 flex-col items-start">
        <span className="eyebrow truncate text-[0.7rem]">{who ? `${who} · ${label}` : label}</span>
        <span
          className={`leading-none ${mexico ? 'sign-pintor text-[2.3rem]' : 'font-sign text-[2.3rem] text-brass-300'}`}
        >
          {mexico ? t('mx.hud.mexico') : o.value}
        </span>
      </span>
    </div>
  );
}

interface StandingsProps {
  view: View;
  nameOf(id: string): string;
}

/** This round's results by stage (roll-offs marked), plus who still has to roll. */
function Standings({ view, nameOf }: StandingsProps) {
  const { t } = useTranslation();
  const over = view.phase === 'roundOver';
  const stages = [
    ...new Set([...view.results.map((r) => r.stage), ...(over ? [] : [view.stage])]),
  ].sort((a, b) => a - b);
  const lastStage = Math.max(...stages);

  const row = (key: string, name: string, body: ReactNode, mark: ReactNode, dim = false) => (
    <li
      key={key}
      className={`flex min-h-8 items-center gap-2 border-b border-white/6 py-1 last:border-0 ${dim ? 'opacity-60' : ''}`}
    >
      <span className="min-w-0 flex-1 truncate text-left font-bold text-capiz-50">{name}</span>
      {body}
      <span className="w-[6.2rem] shrink-0 text-right text-xs font-bold">{mark}</span>
    </li>
  );

  return (
    <section
      className="panel max-h-[18dvh] overflow-y-auto px-3 py-1.5 text-sm"
      aria-label={t('mx.hud.standings')}
      data-testid="mx-standings"
    >
      {stages.map((stage) => {
        const results = view.results.filter((r) => r.stage === stage);
        const low = results.length ? Math.min(...results.map((r) => r.rank)) : null;
        const markLow = results.length > 1 || stage < lastStage || over;
        const pending = !over && stage === view.stage ? view.turnOrder.slice(view.turn) : [];
        return (
          <div key={stage}>
            {stage > 0 && (
              <h4 className="eyebrow mt-1 flex items-center gap-2 text-brass-400">
                {t('mx.hud.rolloff')}
                {lastStage > 1 ? ` ${stage}` : ''}
                <span className="h-px flex-1 bg-narra-600" aria-hidden />
              </h4>
            )}
            <ul>
              {results.map((r: Result, i) => {
                const o = outcomeOf(r.faces);
                const lost = over && stage === lastStage && view.losers.includes(r.player);
                const lowest = !over && markLow && r.rank === low && stage === lastStage;
                return row(
                  `${stage}:${i}`,
                  nameOf(r.player),
                  <span className="flex items-center gap-2">
                    <DiceRow faces={highFirst(r.faces)} size={20} />
                    <span
                      className={`w-11 text-right font-sign ${o.kind === 'mexico' ? 'text-sili-500' : 'text-brass-300'}`}
                    >
                      {o.kind === 'mexico' ? t('mx.hud.mexico') : o.value}
                    </span>
                  </span>,
                  lost ? (
                    <span className="text-sili-500" data-testid="mx-loser-mark">
                      {t('mx.hud.loser')}
                    </span>
                  ) : lowest ? (
                    <span className="text-[#ff8a6b]">{t('mx.hud.lowest')}</span>
                  ) : stage < lastStage && r.rank !== low ? (
                    <span className="text-capiz-400">✓</span>
                  ) : null,
                  stage < lastStage,
                );
              })}
              {pending.map((id) =>
                row(
                  `p:${id}`,
                  nameOf(id),
                  null,
                  <span className="font-normal text-capiz-400">{t('mx.hud.notRolled')}</span>,
                  true,
                ),
              )}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

export default function MexicoHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const act = (type: 'ROLL' | 'KEEP' | 'NEXT_ROUND') =>
    dispatch({ type: 'GAME', action: { type } });
  const roll = view.roll;
  const rolling = roll !== null && !roll.settled;
  const over = view.phase === 'roundOver';

  // The roll on the felt: the current player's, or the one that just ended someone's turn
  // (a Mexico, the last allowed roll, or KEEP). Never shown before the dice settle.
  const last = view.results[view.results.length - 1];
  const own = !over && view.rollsUsed > 0 && roll?.settled ? roll : null;
  const ended = !own && roll?.settled && last && sameFaces(last.faces, roll.faces) ? last : null;

  const chips = (
    <>
      <span className="chip" data-testid="mx-round">
        {t('mx.hud.round', { round: view.round })}
      </span>
      {view.stage > 0 && !over && (
        <span className="chip border-brass-500 text-brass-300" data-testid="mx-rolloff">
          {t('mx.hud.rolloff')}
        </span>
      )}
      {!over && (
        <RollsChip
          left={view.rollsLeft}
          cap={view.cap}
          label={t('mx.hud.rollsLeft', { n: view.rollsLeft })}
        />
      )}
      {!over && view.cap < r.maxRolls && (
        <span className="chip" data-testid="mx-limit">
          {t('mx.hud.limit', { n: view.cap })}
        </span>
      )}
      {over && (
        <span className="chip border-sili-500/70 text-capiz-50" data-testid="mx-stake">
          {t('mx.hud.stake', { sips: view.stake })}
        </span>
      )}
      {view.mexicos > 0 && (
        <span className="chip border-sili-500/70" data-testid="mx-mexicos">
          {t('mx.hud.mexicos', { count: view.mexicos })}
        </span>
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col justify-between">
      {over ? (
        <TurnHeader
          eyebrow={t(view.losers.length > 1 ? 'mx.hud.losers' : 'mx.hud.loser')}
          name={view.losers.map(nameOf).join(' & ')}
          testId="mx-losers"
          tone="sili"
        >
          {chips}
        </TurnHeader>
      ) : (
        <TurnHeader
          eyebrow={t('play.turnOf')}
          name={view.current ? nameOf(view.current) : ''}
          aria={view.current ? t('mx.hud.turn', { name: nameOf(view.current) }) : undefined}
        >
          {chips}
        </TurnHeader>
      )}

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        {(!over || ended) && (
          <div className="flex min-h-[60px] items-center justify-center">
            {rolling ? (
              <span
                className="chip anim-fade min-h-10 px-4 text-base text-capiz-200"
                data-testid="mx-rolling"
              >
                {t('mx.hud.rolling')}
              </span>
            ) : own ? (
              <ResultBanner key={own.id} faces={own.faces} rollId={own.id} who={null} />
            ) : ended && roll ? (
              <ResultBanner
                key={roll.id}
                faces={ended.faces}
                rollId={roll.id}
                who={nameOf(ended.player)}
              />
            ) : null}
          </div>
        )}

        {(view.results.length > 0 || over || view.stage > 0) && (
          <Standings view={view} nameOf={nameOf} />
        )}

        {over ? (
          <button
            type="button"
            className="btn btn-brass min-h-16 font-sign text-xl"
            onClick={() => act('NEXT_ROUND')}
            data-testid="mx-next"
          >
            {t('mx.hud.nextRound')}
          </button>
        ) : view.rollsUsed === 0 ? (
          <button
            type="button"
            className="btn btn-brass min-h-16 font-sign text-xl"
            disabled={rolling}
            onClick={() => act('ROLL')}
            data-testid="mx-roll"
          >
            {t('mx.hud.roll')}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="btn btn-wood min-h-16 border-brass-600 font-sign text-lg text-brass-200"
              disabled={rolling}
              onClick={() => act('KEEP')}
              data-testid="mx-keep"
            >
              {t('mx.hud.keep')}
            </button>
            <button
              type="button"
              className="btn btn-brass min-h-16 font-sign text-lg"
              disabled={rolling || view.rollsLeft === 0}
              onClick={() => act('ROLL')}
              data-testid="mx-roll"
            >
              {t('mx.hud.rollAgain')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
