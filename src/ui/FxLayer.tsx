import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Player } from '@/core/content/schemas';
import type { SessionEffect } from '@/core/engine/session';
import { useFx, type FxItem } from '@/store/fx';
import { useSettings } from '@/store/settings';
import { BottleCap } from './BottleCap';
import { drinkAmount } from './drinkText';
import { IconArrowRight, IconDrop } from './icons';
import { buzz, clink } from './sfx';

/** Let the card land before revealing what it means. */
const REVEAL_MS = 650;
/** A private pass covers the screen: long enough to see the result before the cover. */
const PASS_DELAY_MS = 2300;
/** A public pass is only a banner, so it can come right after the drink toast. */
const BANNER_DELAY_MS = 900;
/** The banner goes away by itself after this long. */
const BANNER_MS = 4500;
const TOAST_MS: Record<string, number> = { drinks: 4800, notice: 3600, error: 3000 };
const MAX_TOASTS = 3;

type DrinksFx = Extract<SessionEffect, { type: 'drinks' }>;
type PassFx = Extract<SessionEffect, { type: 'passTo' }>;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/*
 * Stacking order on the play screen (keep in sync when adding overlays):
 *   HUD (auto) < toasts z-20 < pass banner / "see results" z-25 < game-over cover z-30
 *   < winner line z-31 < sheets + private pass cover z-40 < lost-GL cover z-60.
 * Toasts never draw over a modal cover; their timers pause while the private cover is up.
 */

function useDelayed(at: number, delay: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const wait = Math.max(0, delay - (Date.now() - at));
    const t = window.setTimeout(() => setShown(true), wait);
    return () => window.clearTimeout(t);
  }, [at, delay]);
  return shown;
}

function DrinkToast({ fx, players }: { fx: DrinksFx; players: readonly Player[] }) {
  const { t } = useTranslation();
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const many = fx.entries.length > 1;
  const give = fx.kind === 'give';
  // Game reasons are written for the drinkers ("Tagay mo na!"); when nobody here is drinking
  // alcohol, a neutral line replaces them instead of telling someone with juice to "tagay".
  // Sips being handed out aren't drunk by these players, so their reason always stands.
  const soft = !give && fx.entries.every((e) => !e.alcoholic);
  return (
    <div className="flex flex-col gap-1.5">
      {many && (
        <span className="font-sign text-lg leading-tight text-brass-300">
          {t(
            give
              ? 'drink.giveGroup'
              : fx.kind === 'social'
                ? soft
                  ? 'drink.everyoneSoft'
                  : 'drink.everyone'
                : 'drink.group',
          )}
        </span>
      )}
      {fx.entries.map((e) => (
        <div key={e.playerId} className="flex items-center gap-3">
          <BottleCap
            size={many ? 36 : 46}
            tone={!e.alcoholic ? 'tubig' : e.finish ? 'sili' : 'brass'}
            className="anim-cap"
          >
            {e.finish ? '!' : e.amount}
          </BottleCap>
          <div className="flex min-w-0 flex-col">
            <span className={`truncate font-bold text-capiz-50 ${many ? 'text-base' : 'text-lg'}`}>
              {t(give ? 'drink.giveLine' : 'drink.line', {
                name: name(e.playerId),
                amount: drinkAmount(t, e),
              })}
            </span>
            {!e.alcoholic && !soft && !give && (
              <span className="flex items-center gap-1 text-xs font-bold text-tubig-300">
                <IconDrop size={13} />
                {t('drink.nonAlc')}
              </span>
            )}
          </div>
        </div>
      ))}
      {soft ? (
        <span
          className="flex items-center gap-1.5 text-sm font-bold text-tubig-300"
          data-testid="drink-soft-reason"
        >
          <IconDrop size={15} className="shrink-0" />
          {t('drink.nonAlcoholicReason')}
        </span>
      ) : (
        <span className="text-sm text-capiz-300">{t(fx.reason.key, fx.reason.params ?? {})}</span>
      )}
    </div>
  );
}

/** One-line version for compact mode: a cap and "Name: 2 lagok" per drinker, no reason line. */
function DrinkChip({ fx, players }: { fx: DrinksFx; players: readonly Player[] }) {
  const { t } = useTranslation();
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const give = fx.kind === 'give';
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
      {fx.entries.map((e) => (
        <span key={e.playerId} className="flex min-w-0 items-center gap-1.5">
          <BottleCap size={26} tone={!e.alcoholic ? 'tubig' : e.finish ? 'sili' : 'brass'}>
            <span className="text-xs">{e.finish ? '!' : e.amount}</span>
          </BottleCap>
          <span className="truncate text-sm font-bold text-capiz-50">
            {t(give ? 'drink.giveLine' : 'drink.line', {
              name: name(e.playerId),
              amount: drinkAmount(t, e),
            })}
          </span>
        </span>
      ))}
    </span>
  );
}

function Toast({
  item,
  players,
  compact,
  paused,
}: {
  item: FxItem;
  players: readonly Player[];
  compact: boolean;
  paused: boolean;
}) {
  const { t } = useTranslation();
  const dismiss = useFx((s) => s.dismiss);
  const sound = useSettings((s) => s.sound);
  const haptics = useSettings((s) => s.haptics);
  const shown = useDelayed(item.at, item.fx.type === 'error' ? 0 : REVEAL_MS);
  const fedBack = useRef(false);

  useEffect(() => {
    if (!shown) return;
    if (item.fx.type === 'drinks' && !fedBack.current) {
      fedBack.current = true;
      if (sound) clink();
      if (haptics) buzz(70);
    }
    // Under a modal cover nobody can read it: the clock starts once it's back in view.
    if (paused) return;
    const timer = window.setTimeout(() => dismiss(item.id), TOAST_MS[item.fx.type] ?? 3500);
    return () => window.clearTimeout(timer);
    // Feedback fires once, when the toast appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, paused]);

  if (!shown) return null;
  const fx = item.fx;
  const tone =
    fx.type === 'error'
      ? 'border-sili-500/70 bg-[#2a0f0a]/95'
      : fx.type === 'drinks'
        ? 'border-brass-500/60 bg-narra-850/95'
        : 'border-felt-600 bg-felt-900/95';
  const message =
    fx.type === 'notice' || fx.type === 'error' ? t(fx.msg.key, fx.msg.params ?? {}) : null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        data-testid={`toast-${fx.type}`}
        data-compact="true"
        className={`anim-pour pointer-events-auto flex max-w-full items-center rounded-full border py-1.5 pr-3.5 text-left shadow-[0_10px_22px_-12px_rgb(0_0_0/0.85)] backdrop-blur-sm ${
          fx.type === 'drinks' ? 'pl-1.5' : 'pl-3.5'
        } ${tone}`}
      >
        {fx.type === 'drinks' && <DrinkChip fx={fx} players={players} />}
        {message !== null && (
          <span className="truncate text-sm font-bold text-capiz-50">{message}</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => dismiss(item.id)}
      data-testid={`toast-${fx.type}`}
      className={`anim-pour pointer-events-auto w-full rounded-2xl border px-4 py-3 text-left shadow-[0_14px_30px_-12px_rgb(0_0_0/0.8)] backdrop-blur-sm ${tone}`}
    >
      {fx.type === 'drinks' && <DrinkToast fx={fx} players={players} />}
      {message !== null && <span className="font-bold text-capiz-50">{message}</span>}
    </button>
  );
}

/** Full-screen, opaque "Ipasa kay …" cover for private passes: the next player's info stays hidden. */
function PassCover({
  item,
  fx,
  players,
}: {
  item: FxItem;
  fx: PassFx;
  players: readonly Player[];
}) {
  const { t } = useTranslation();
  const dismiss = useFx((s) => s.dismiss);
  const name = players.find((p) => p.id === fx.player)?.name ?? '?';
  return (
    <button
      type="button"
      data-testid="pass-cover"
      aria-label={t('pass.aria', { name })}
      onClick={() => dismiss(item.id)}
      className="anim-fade fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-narra-950 px-6 text-center"
    >
      <span className="eyebrow">{t('pass.eyebrow')}</span>
      <span className="flex flex-col items-center gap-2">
        <span className="text-2xl font-bold text-capiz-200">{t('pass.to')}</span>
        <span className="sign-pintor max-w-full text-[clamp(3rem,16vw,5.5rem)] break-words">
          {name}
        </span>
      </span>
      <span className="max-w-xs text-capiz-300">{t('pass.private')}</span>
      <span className="btn btn-brass mt-4 px-8">{t('pass.tap')}</span>
    </button>
  );
}

/**
 * Public pass: a banner that slides in over the turn indicator (which already names the same
 * player), leaving the table, the result and the card meaning in view. Tap or wait to dismiss.
 */
function PassBanner({
  item,
  fx,
  players,
}: {
  item: FxItem;
  fx: PassFx;
  players: readonly Player[];
}) {
  const { t } = useTranslation();
  const dismiss = useFx((s) => s.dismiss);
  const name = players.find((p) => p.id === fx.player)?.name ?? '?';
  const card = useRef<HTMLButtonElement>(null);
  const fuse = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [item.id, dismiss]);

  useEffect(() => {
    if (reducedMotion()) return;
    const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    const slide = card.current?.animate(
      [
        { transform: 'translateX(28%)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 340, easing: ease },
    );
    // The brass fuse along the bottom burns down until the banner leaves.
    const burn = fuse.current?.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: BANNER_MS,
      easing: 'linear',
      fill: 'forwards',
    });
    return () => {
      slide?.cancel();
      burn?.cancel();
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+66px)] z-[25] mx-auto w-full max-w-[440px] px-4"
      aria-live="polite"
    >
      <button
        ref={card}
        type="button"
        data-testid="pass-banner"
        data-player={fx.player}
        aria-label={t('pass.aria', { name })}
        onClick={() => dismiss(item.id)}
        className="pointer-events-auto relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-2xl border border-brass-500/70 bg-narra-950/92 py-2 pr-2.5 pl-4 text-left shadow-[0_16px_32px_-14px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_235_200/0.08)] backdrop-blur-md"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="eyebrow text-brass-300/90">{t('pass.eyebrow')}</span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-bold text-capiz-200">{t('pass.to')}</span>
            <span className="truncate font-sign text-[1.6rem] leading-tight text-brass-300">
              {name}
            </span>
          </span>
        </span>
        <span
          aria-hidden
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-[linear-gradient(180deg,var(--color-brass-300),var(--color-brass-500))] text-narra-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_2px_0_var(--color-brass-600)]"
        >
          <IconArrowRight size={24} />
        </span>
        <span
          ref={fuse}
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-brass-400/85"
        />
      </button>
    </div>
  );
}

/** True once `delay` ms have passed since the pass was queued (false while there's none). */
function usePassShown(pass: FxItem | undefined, delay: number): boolean {
  const [shownId, setShownId] = useState<number | null>(null);
  useEffect(() => {
    if (!pass) return;
    const wait = Math.max(0, delay - (Date.now() - pass.at));
    const t = window.setTimeout(() => setShownId(pass.id), wait);
    return () => window.clearTimeout(t);
  }, [pass, delay]);
  return pass !== undefined && shownId === pass.id;
}

/**
 * Drains the effect queue: drink toasts, notices, errors and the pass-the-phone prompt.
 * Toasts stack below the HUD's turn indicator (see `useToastAnchor`) so it stays readable, and
 * shrink to chips in compact mode (`useCompactToasts`). A public pass is a banner; a private one
 * (secret dice, secret votes) is an opaque full-screen cover.
 * `holdPass` keeps the pass queued while the table still has to settle something
 * (e.g. a Kings Cup "Sino iinom?"), so it doesn't land on top of the picker.
 */
export function FxLayer({
  players,
  holdPass = false,
}: {
  players: readonly Player[];
  holdPass?: boolean;
}) {
  const items = useFx((s) => s.items);
  const anchor = useFx((s) => s.anchor);
  const compact = useFx((s) => s.compact);
  const toasts = items.filter((i) => i.fx.type !== 'passTo').slice(0, MAX_TOASTS);
  const pass = holdPass ? undefined : items.find((i) => i.fx.type === 'passTo');
  const secret = pass !== undefined && (pass.fx as PassFx).private;
  const covered = usePassShown(secret ? pass : undefined, PASS_DELAY_MS);
  const bannered = usePassShown(pass && !secret ? pass : undefined, BANNER_DELAY_MS);
  // Without a turn indicator to hang from, toasts default to the slot the banner uses.
  const top =
    anchor !== null ? anchor + 8 : bannered ? 'calc(env(safe-area-inset-top) + 146px)' : undefined;

  return (
    <>
      {pass && covered && (
        <PassCover key={pass.id} item={pass} fx={pass.fx as PassFx} players={players} />
      )}
      {pass && bannered && (
        <PassBanner key={pass.id} item={pass} fx={pass.fx as PassFx} players={players} />
      )}
      <div
        className={`pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+76px)] z-20 mx-auto flex w-full max-w-[440px] px-4 ${
          compact ? 'flex-row flex-wrap justify-center gap-1.5' : 'flex-col gap-2'
        }`}
        style={top !== undefined ? { top } : undefined}
        aria-live="polite"
        data-testid="toasts"
        data-compact={compact}
      >
        {toasts.map((i) => (
          <Toast key={i.id} item={i} players={players} compact={compact} paused={covered} />
        ))}
      </div>
    </>
  );
}
