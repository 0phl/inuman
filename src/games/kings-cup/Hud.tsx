import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MAX_RULE_LENGTH, type Pending, type Rules, type View } from '@/core/games/kings-cup/logic';
import { RANK_KEYS, rankKey, suitOf, type Card, type RankKey } from '@/core/primitives/deck';
import { rightOf } from '@/core/primitives/turn';
import { useTx } from '@/i18n/tx';
import { IconCards, IconCrown } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { useToastAnchor } from '@/ui/toastAnchor';
import type { GameViewProps } from '../types';

const SUIT_GLYPH = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' } as const;
/** Bunot stays locked while the card flies out of the ring (Scene FLIGHT_SECONDS + a beat). */
const FLIGHT_MS = 950;
/** The meaning panel waits for the card to land face up. */
const REVEAL_MS = 620;

const isRedCard = (c: Card) => suitOf(c) === 'H' || suitOf(c) === 'D';

/** A tiny playing card: the rank in sign lettering, suit underneath when we know it. */
function RankBadge({
  rank,
  card,
  size = 'lg',
}: {
  rank: RankKey;
  card?: Card;
  size?: 'lg' | 'sm';
}) {
  const red = card !== undefined && isRedCard(card);
  const lg = size === 'lg';
  return (
    <span
      aria-hidden
      className={`relative flex shrink-0 flex-col items-center justify-center rounded-[9px] border border-[#d9c9a6] bg-[linear-gradient(160deg,#fbf7ec,#efe6d2)] font-sign leading-none shadow-[0_6px_14px_-6px_rgb(0_0_0/0.8)] ${
        lg ? 'h-[78px] w-14 gap-0.5 text-[1.75rem]' : 'h-12 w-9 text-lg'
      } ${red ? 'text-[#b3121f]' : 'text-narra-950'}`}
    >
      <span className={rank === '10' ? 'tracking-[-0.08em]' : ''}>{rank}</span>
      {card !== undefined && (
        <span className={lg ? 'text-xl' : 'text-sm'}>{SUIT_GLYPH[suitOf(card)]}</span>
      )}
    </span>
  );
}

function MeaningPanel({
  card,
  rules,
  drewBy,
  delay,
  onGuide,
}: {
  card: Card;
  rules: Rules;
  drewBy: string;
  delay: number;
  onGuide(): void;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  const rank = rankKey(card);
  const rule = rules.cards[rank];
  return (
    <section
      className="panel anim-pour relative flex gap-3 p-3 pr-2"
      style={{ animationDelay: `${delay}ms` }}
      data-testid="kc-meaning"
      data-rank={rank}
      aria-live="polite"
    >
      <RankBadge rank={rank} card={card} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <span className="eyebrow truncate text-[0.7rem]">{t('kcui.drewBy', { name: drewBy })}</span>
        <h3 className="font-sign text-[1.45rem] leading-[1.05] text-brass-300 [overflow-wrap:anywhere]">
          {tx(rule.title)}
        </h3>
        <p className="text-[0.95rem] leading-snug text-capiz-200 [overflow-wrap:anywhere]">
          {tx(rule.text)}
        </p>
      </div>
      <button
        type="button"
        className="icon-btn size-11 shrink-0 self-start text-brass-300"
        aria-label={t('kcui.guide')}
        onClick={onGuide}
        data-testid="kc-guide"
      >
        <IconCards />
      </button>
    </section>
  );
}

function FirstHint({ onGuide }: { onGuide(): void }) {
  const { t } = useTranslation();
  return (
    <section className="panel flex items-center gap-3 p-3 pr-2" data-testid="kc-meaning">
      <span className="grid h-[78px] w-14 shrink-0 place-items-center rounded-[9px] border border-dashed border-brass-500/60 text-brass-400">
        <IconCrown size={26} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-sign text-[1.45rem] leading-none text-brass-300">
          {t('kcui.firstTitle')}
        </h3>
        <p className="text-[0.95rem] leading-snug text-capiz-200">{t('kcui.firstBody')}</p>
      </div>
      <button
        type="button"
        className="icon-btn size-11 shrink-0 self-start text-brass-300"
        aria-label={t('kcui.guide')}
        onClick={onGuide}
        data-testid="kc-guide"
      >
        <IconCards />
      </button>
    </section>
  );
}

function PendingPanel({
  pending,
  order,
  nameOf,
  delay,
  dispatch,
}: {
  pending: Pending;
  order: readonly string[];
  nameOf(id: string): string;
  delay: number;
  dispatch: GameViewProps<View>['dispatch'];
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(null);
  const [text, setText] = useState('');
  const kind = pending.kind;
  const options = kind === 'mate' ? order.filter((id) => id !== pending.by) : order;
  const ruleLen = text.trim().length;
  const valid =
    kind === 'rule'
      ? ruleLen >= 1 && ruleLen <= MAX_RULE_LENGTH
      : target !== null && options.includes(target);
  const prompt = t(`kc.pending.${kind}`);

  const resolve = () => {
    if (!valid) return;
    dispatch({
      type: 'GAME',
      action:
        kind === 'rule' ? { type: 'RESOLVE', text: text.trim() } : { type: 'RESOLVE', target },
    });
  };
  const skip = () => dispatch({ type: 'GAME', action: { type: 'SKIP' } });

  return (
    <section
      className="felt anim-pour px-4 pt-3.5 pb-4"
      style={{ animationDelay: `${delay}ms` }}
      data-testid="kc-pending"
      data-kind={kind}
    >
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex flex-col">
          <h3 className="font-sign text-[1.5rem] leading-tight text-capiz-50">{prompt}</h3>
          <p className="text-sm text-capiz-300">
            {t(`kcui.hint.${kind}`, { name: nameOf(pending.by) })}
          </p>
        </div>

        {kind === 'rule' ? (
          <label className="flex flex-col gap-1">
            <span className="sr-only">{t('kcui.ruleLabel')}</span>
            <input
              className="field bg-narra-950/85"
              value={text}
              maxLength={MAX_RULE_LENGTH}
              placeholder={t('kc.hud.rulePlaceholder')}
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') resolve();
              }}
              data-testid="kc-rule-input"
            />
            <span className="self-end text-xs font-bold text-capiz-400" aria-hidden>
              {text.length}/{MAX_RULE_LENGTH}
            </span>
          </label>
        ) : (
          <div
            role="radiogroup"
            aria-label={prompt}
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
                  onClick={() => setTarget(id)}
                  className={`min-h-12 max-w-full truncate rounded-full border px-4 font-bold transition-colors ${
                    on
                      ? 'border-brass-300 bg-brass-400 text-narra-950 shadow-[0_0_0_3px_rgb(232_176_74/0.25)]'
                      : 'border-narra-500 bg-narra-950/70 text-capiz-50 active:bg-narra-800'
                  }`}
                  data-testid="kc-target"
                >
                  {nameOf(id)}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-2">
          <button type="button" className="btn btn-wood" onClick={skip} data-testid="kc-skip">
            {t('kc.hud.skip')}
          </button>
          <button
            type="button"
            className="btn btn-brass font-sign text-lg"
            disabled={!valid}
            onClick={resolve}
            data-testid="kc-resolve"
          >
            {t('kc.hud.confirm')}
          </button>
        </div>
      </div>
    </section>
  );
}

function GuideSheet({
  open,
  onClose,
  rules,
  current,
}: {
  open: boolean;
  onClose(): void;
  rules: Rules;
  current: RankKey | null;
}) {
  const { t } = useTranslation();
  const tx = useTx();
  return (
    <Sheet open={open} onClose={onClose} title={t('kcui.guide')} testId="kc-guide-sheet">
      <ul className="flex flex-col gap-1.5">
        {RANK_KEYS.map((rank) => {
          const rule = rules.cards[rank];
          return (
            <li
              key={rank}
              className={`flex items-start gap-3 rounded-xl px-2 py-2 ${
                rank === current ? 'bg-narra-700/70 ring-1 ring-brass-500/70' : ''
              }`}
            >
              <RankBadge rank={rank} size="sm" />
              <div className="flex min-w-0 flex-col">
                <span className="font-bold text-brass-300">{tx(rule.title)}</span>
                <span className="text-sm leading-snug text-capiz-300">{tx(rule.text)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
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
    <Sheet open={open} onClose={onClose} title={t('kc.hud.houseRules')} testId="kc-rules-sheet">
      {rules.length === 0 ? (
        <p className="text-capiz-300">{t('kcui.noRules')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl bg-narra-950/50 px-3 py-2.5">
              <span className="font-sign text-lg leading-6 text-brass-400">{i + 1}</span>
              {/* Literal text the group typed: rendered as text, never HTML. */}
              <span className="min-w-0 flex-1 leading-6 text-capiz-50 [overflow-wrap:anywhere]">
                {r}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}

export default function KingsCupHud({ view, rules, players, dispatch }: GameViewProps<View>) {
  const { t } = useTranslation();
  const r = rules as Rules;
  const anchor = useToastAnchor<HTMLElement>();
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const [sheet, setSheet] = useState<'guide' | 'rules' | null>(null);
  const [locked, setLocked] = useState(false);
  // Cards drawn before this HUD mounted (a resumed game) appear without the landing delay.
  const [mountDrawn] = useState(view.drawn.length);

  const drawnCount = view.drawn.length;
  useEffect(() => {
    const t0 = window.setTimeout(() => setLocked(false), FLIGHT_MS);
    return () => window.clearTimeout(t0);
  }, [drawnCount]);

  const current = view.drawn[drawnCount - 1];
  const n = view.order.length;
  // The turn already moved on after the draw; whoever drew sits one seat back.
  const drawer = current !== undefined && n > 0 ? rightOf(view.order, view.turn) : null;
  // While the table settles a card, it is still the drawer's moment.
  const turnId = view.pending ? view.pending.by : view.order[view.turn];
  const kingsLeft = Math.max(4 - view.kingsDrawn, 0);
  const delay = drawnCount > mountDrawn ? REVEAL_MS : 0;
  const { questionMaster, thumbMaster } = view.roles;
  const extras = Boolean(
    questionMaster || thumbMaster || view.mates.length || view.houseRules.length,
  );

  const draw = () => {
    const err = dispatch({ type: 'GAME', action: { type: 'DRAW' } });
    if (!err) setLocked(true);
  };

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <section
        ref={anchor}
        className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-2 [&_.chip]:bg-narra-950/85 [&_.chip]:backdrop-blur-sm bg-[radial-gradient(closest-side,rgb(14_8_5/0.72),transparent)] pt-1 pb-2 text-center"
      >
        <span className="eyebrow rounded-full bg-narra-950/80 px-3 py-1 text-capiz-300">
          {t('play.turnOf')}
        </span>
        <h2
          className="sign-pintor max-w-full text-[clamp(1.9rem,9.5vw,3.1rem)] [overflow-wrap:anywhere]"
          data-testid="turn-name"
        >
          {turnId !== undefined ? nameOf(turnId) : ''}
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span
            className="chip"
            data-testid="kc-kings"
            aria-label={`${kingsLeft} ${t('kc.hud.kingsLeft')}`}
          >
            <IconCrown size={16} className="text-brass-300" />
            <span className="font-sign text-[0.95rem] text-brass-200">{kingsLeft}</span>
            {t('kc.hud.kingsLeft')}
          </span>
          <span className="chip" data-testid="deck-count">
            <span className="font-sign text-[0.95rem] text-capiz-50">{view.deckCount}</span>
            {t('kc.hud.cardsLeft')}
          </span>
        </div>
        {extras && (
          <div
            className="flex max-w-full flex-wrap items-center justify-center gap-1.5"
            data-testid="kc-extras"
          >
            {questionMaster && (
              <span className="chip min-h-7 max-w-full border-brass-600/80 text-[0.78rem]">
                <span className="text-brass-300">{t('kc.role.questionMaster')}</span>
                <span className="truncate text-capiz-50">{nameOf(questionMaster)}</span>
              </span>
            )}
            {thumbMaster && (
              <span className="chip min-h-7 max-w-full border-brass-600/80 text-[0.78rem]">
                <span className="text-brass-300">{t('kc.role.thumbMaster')}</span>
                <span className="truncate text-capiz-50">{nameOf(thumbMaster)}</span>
              </span>
            )}
            {view.mates.length > 0 && (
              <span className="chip min-h-7 max-w-full text-[0.78rem]" data-testid="kc-mates">
                <span className="text-brass-300">{t('kc.hud.mates')}</span>
                <span className="truncate text-capiz-50">
                  {view.mates.map(([a, b]) => `${nameOf(a)} & ${nameOf(b)}`).join(' · ')}
                </span>
              </span>
            )}
            {view.houseRules.length > 0 && (
              <button
                type="button"
                className="chip min-h-7 border-brass-600/80 text-[0.78rem] active:bg-narra-800"
                onClick={() => setSheet('rules')}
                data-testid="kc-house-rules"
              >
                <span className="text-brass-300">{t('kc.hud.houseRules')}</span>
                <span className="grid min-w-5 place-items-center rounded-full bg-brass-400 px-1 font-sign text-[0.75rem] text-narra-950">
                  {view.houseRules.length}
                </span>
              </button>
            )}
          </div>
        )}
      </section>

      <section className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-2.5">
        {current === undefined ? (
          <FirstHint onGuide={() => setSheet('guide')} />
        ) : (
          <MeaningPanel
            key={drawnCount}
            card={current}
            rules={r}
            drewBy={drawer ? nameOf(drawer) : ''}
            delay={delay}
            onGuide={() => setSheet('guide')}
          />
        )}
        {view.pending ? (
          <PendingPanel
            key={drawnCount}
            pending={view.pending}
            order={view.order}
            nameOf={nameOf}
            delay={delay}
            dispatch={dispatch}
          />
        ) : (
          <button
            type="button"
            className="btn btn-brass min-h-16 w-full font-sign text-[1.6rem]"
            disabled={locked || view.over || view.deckCount === 0}
            onClick={draw}
            data-testid="kc-draw"
          >
            {t('kc.hud.draw')}
          </button>
        )}

        {/* Fixed-position sheets; inside this section so they get pointer events and stay out of the flex flow. */}
        <GuideSheet
          open={sheet === 'guide'}
          onClose={() => setSheet(null)}
          rules={r}
          current={current === undefined ? null : rankKey(current)}
        />
        <HouseRulesSheet
          open={sheet === 'rules'}
          onClose={() => setSheet(null)}
          rules={view.houseRules}
        />
      </section>
    </div>
  );
}
