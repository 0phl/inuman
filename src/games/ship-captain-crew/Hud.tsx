import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ROLE_FACE,
  ROLES,
  type Die,
  type Score,
  type View,
} from '@/core/games/ship-captain-crew/logic';
import type { Face } from '@/core/primitives/dice';
import { DiceRow, DieFace } from '../mexico/DieFace';
import { RollsChip, TurnHeader } from '../mexico/hudKit';
import type { GameViewProps } from '../types';

const lockedCount = (dice: readonly Die[]) => dice.filter((d) => d.lockedAs !== null).length;
const nextRole = (dice: readonly Die[]) => ROLES.find((r) => !dice.some((d) => d.lockedAs === r));

/** Ship ✓ Captain ✓ Crew ·: which roles are locked, and the face the next one needs. */
function Lineup({ dice }: { dice: readonly Die[] }) {
  const { t } = useTranslation();
  const next = nextRole(dice);
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <ul
        className="flex items-center gap-1 rounded-full border border-narra-600 bg-black/30 p-1"
        data-testid="scc-lineup"
        data-locked={lockedCount(dice)}
      >
        {ROLES.map((role) => {
          const done = dice.some((d) => d.lockedAs === role);
          const isNext = role === next;
          return (
            <li
              key={role}
              data-testid={`scc-role-${role}`}
              data-done={done}
              className={`flex min-h-7 items-center gap-1 rounded-full px-2 text-[0.8rem] font-bold ${
                done
                  ? 'bg-brass-400 text-narra-950'
                  : isNext
                    ? 'text-brass-300 ring-1 ring-brass-500/70'
                    : 'text-capiz-400'
              }`}
            >
              <DieFace
                face={ROLE_FACE[role]}
                size={17}
                tone={done ? 'ivory' : isNext ? 'ghost' : 'dim'}
                label=""
              />
              {t(`scc.hud.${role}`)}
              {done && <span aria-hidden>✓</span>}
            </li>
          );
        })}
      </ul>
      {next && (
        <span className="chip text-brass-200" data-testid="scc-need">
          {t('scc.hud.need', { face: ROLE_FACE[next] })}
        </span>
      )}
    </div>
  );
}

/** The current dice after a settle, or the result that just ended someone's turn. */
function ResultBanner({
  rollId,
  faces,
  locked,
  qualified,
  score,
  need,
  who,
}: {
  rollId: number;
  faces: Face[];
  locked: boolean[];
  qualified: boolean;
  score: number;
  need: Face | null;
  who: string | null;
}) {
  const { t } = useTranslation();
  const label = qualified ? t('scc.hud.cargo') : who ? t('scc.hud.noCrew') : t('scc.hud.score');
  return (
    <div
      role="status"
      data-testid="scc-result"
      data-roll-id={rollId}
      data-qualified={qualified}
      data-score={score}
      className={`anim-pour mx-auto flex max-w-full items-center gap-3 rounded-2xl border px-3.5 py-2 shadow-xl ${
        qualified ? 'border-brass-500/80 bg-narra-850/95' : 'border-narra-500 bg-narra-900/95'
      }`}
    >
      <DiceRow faces={faces} size={28} toneOf={(_, i) => (locked[i] ? 'brass' : 'ivory')} />
      <span className="flex min-w-0 flex-col items-start">
        <span className="eyebrow truncate text-[0.68rem]">{who ? `${who} · ${label}` : label}</span>
        {qualified || who ? (
          <span className="font-sign text-[2.2rem] leading-none text-brass-300">{score}</span>
        ) : (
          <span className="font-sign text-[1.15rem] leading-tight text-capiz-200">
            {need ? t('scc.hud.need', { face: need }) : score}
          </span>
        )}
      </span>
    </div>
  );
}

function Standings({ view, nameOf }: { view: View; nameOf(id: string): string }) {
  const { t } = useTranslation();
  const over = view.phase === 'roundOver';
  const byPlayer = new Map<string, Score>(view.scores.map((s) => [s.player, s]));
  return (
    <section
      className="panel max-h-[18dvh] overflow-y-auto px-3 py-1.5 text-sm"
      aria-label={t('scc.hud.standings')}
      data-testid="scc-standings"
    >
      <ul>
        {view.turnOrder.map((id) => {
          const s = byPlayer.get(id);
          const lost = over && view.losers.includes(id);
          const won = over && view.winners.includes(id);
          let mark: ReactNode = null;
          if (lost) mark = <span className="text-sili-500">{t('scc.hud.loser')}</span>;
          else if (won) mark = <span className="text-brass-300">{t('scc.hud.winner')}</span>;
          return (
            <li
              key={id}
              className={`flex min-h-8 items-center gap-2 border-b border-white/6 py-1 last:border-0 ${s ? '' : 'opacity-60'}`}
            >
              <span className="min-w-0 flex-1 truncate font-bold text-capiz-50">{nameOf(id)}</span>
              {s ? (
                <>
                  <DiceRow
                    faces={s.faces}
                    size={16}
                    tone={s.qualified ? 'ivory' : 'dim'}
                    className="gap-0.5"
                  />
                  <span
                    className={`w-14 text-right font-sign ${s.qualified ? 'text-brass-300' : 'text-capiz-400'}`}
                    title={s.qualified ? undefined : t('scc.hud.noCrew')}
                  >
                    {s.score}
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-capiz-400">
                  {id === view.current && (
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-brass-400 shadow-[0_0_6px_rgb(232_176_74/0.8)]"
                    />
                  )}
                  {t('scc.hud.notRolled')}
                </span>
              )}
              <span className="w-14 shrink-0 text-right text-xs font-bold">{mark}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function SccHud({ view, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const act = (type: 'ROLL' | 'KEEP' | 'NEXT_ROUND') =>
    dispatch({ type: 'GAME', action: { type } });
  const roll = view.roll;
  const rolling = roll !== null && !roll.settled;
  const over = view.phase === 'roundOver';
  const last = view.scores[view.scores.length - 1];
  const own = !over && view.rollsUsed > 0 && roll?.settled ? roll : null;
  const ended = !own && roll?.settled && view.rollsUsed === 0 && last ? last : null;
  const next = nextRole(view.dice);

  const chips = (
    <>
      <span className="chip" data-testid="scc-round">
        {t('scc.hud.round', { round: view.round })}
      </span>
      {!over && (
        <RollsChip
          left={view.rollsLeft}
          cap={view.cap}
          label={t('scc.hud.rollsLeft', { n: view.rollsLeft })}
        />
      )}
      {over && view.winners.length > 0 && (
        <span className="chip border-brass-500 text-brass-200" data-testid="scc-winners">
          {t(view.winners.length > 1 ? 'scc.hud.winners' : 'scc.hud.winner')}:{' '}
          {view.winners.map(nameOf).join(', ')}
        </span>
      )}
    </>
  );

  const rollLabel =
    view.rollsUsed === 0
      ? t('scc.hud.roll')
      : view.qualified
        ? t('scc.hud.rollCargo')
        : t('scc.hud.rollAgain');

  return (
    <div className="flex h-full flex-col justify-between">
      {over ? (
        <TurnHeader
          eyebrow={t(view.losers.length > 1 ? 'scc.hud.losers' : 'scc.hud.loser')}
          name={view.losers.map(nameOf).join(' & ')}
          testId="scc-losers"
          tone="sili"
        >
          {chips}
        </TurnHeader>
      ) : (
        <TurnHeader
          eyebrow={t('play.turnOf')}
          name={view.current ? nameOf(view.current) : ''}
          aria={view.current ? t('scc.hud.turn', { name: nameOf(view.current) }) : undefined}
        >
          {chips}
          <Lineup dice={view.dice} />
        </TurnHeader>
      )}

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        <div className="flex min-h-[58px] items-center justify-center">
          {rolling ? (
            <span
              className="chip anim-fade min-h-10 px-4 text-base text-capiz-200"
              data-testid="scc-rolling"
            >
              {t('scc.hud.rolling')}
            </span>
          ) : own ? (
            <ResultBanner
              key={own.id}
              rollId={own.id}
              faces={view.dice.map((d) => d.face ?? 1)}
              locked={view.dice.map((d) => d.lockedAs !== null)}
              qualified={view.qualified}
              score={view.cargo}
              need={next ? ROLE_FACE[next] : null}
              who={null}
            />
          ) : ended && roll ? (
            <ResultBanner
              key={roll.id}
              rollId={roll.id}
              faces={ended.faces}
              locked={ended.faces.map(() => false)}
              qualified={ended.qualified}
              score={ended.score}
              need={null}
              who={nameOf(ended.player)}
            />
          ) : null}
        </div>

        {(view.scores.length > 0 || over) && <Standings view={view} nameOf={nameOf} />}

        {over ? (
          <button
            type="button"
            className="btn btn-brass min-h-16 font-sign text-xl"
            onClick={() => act('NEXT_ROUND')}
            data-testid="scc-next"
          >
            {t('scc.hud.nextRound')}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="btn btn-wood min-h-16 border-brass-600 px-2 font-sign text-base text-brass-200"
              disabled={rolling || !view.qualified || view.rollsUsed === 0}
              onClick={() => act('KEEP')}
              data-testid="scc-keep"
            >
              {t('scc.hud.keep')}
            </button>
            <button
              type="button"
              className="btn btn-brass min-h-16 px-2 font-sign text-lg"
              disabled={rolling || view.rollsLeft === 0}
              onClick={() => act('ROLL')}
              data-testid="scc-roll"
            >
              {rollLabel}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
