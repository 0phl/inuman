import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Player } from '@/core/content/schemas';
import type { SessionEffect } from '@/core/engine/session';
import { useFx, type FxItem } from '@/store/fx';
import { useSettings } from '@/store/settings';
import { BottleCap } from './BottleCap';
import { drinkAmount } from './drinkText';
import { IconDrop } from './icons';
import { buzz, clink } from './sfx';

/** Let the card land before revealing what it means. */
const REVEAL_MS = 650;
/** Long enough to see the flipped card and the result banner before the cover. */
const PASS_DELAY_MS = 2300;
const TOAST_MS: Record<string, number> = { drinks: 4800, notice: 3600, error: 3000 };
const MAX_TOASTS = 3;

type DrinksFx = Extract<SessionEffect, { type: 'drinks' }>;
type PassFx = Extract<SessionEffect, { type: 'passTo' }>;

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
  // Game reasons are written for the drinkers ("Tagay mo na!"); when nobody here is drinking
  // alcohol, a neutral line replaces them instead of telling someone with juice to "tagay".
  const soft = fx.entries.every((e) => !e.alcoholic);
  return (
    <div className="flex flex-col gap-1.5">
      {many && (
        <span className="font-sign text-lg leading-tight text-brass-300">
          {t(
            fx.kind === 'social' ? (soft ? 'drink.everyoneSoft' : 'drink.everyone') : 'drink.group',
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
              {t('drink.line', { name: name(e.playerId), amount: drinkAmount(t, e) })}
            </span>
            {!e.alcoholic && !soft && (
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

function Toast({ item, players }: { item: FxItem; players: readonly Player[] }) {
  const { t } = useTranslation();
  const dismiss = useFx((s) => s.dismiss);
  const sound = useSettings((s) => s.sound);
  const haptics = useSettings((s) => s.haptics);
  const shown = useDelayed(item.at, item.fx.type === 'error' ? 0 : REVEAL_MS);

  useEffect(() => {
    if (!shown) return;
    if (item.fx.type === 'drinks') {
      if (sound) clink();
      if (haptics) buzz(70);
    }
    const timer = window.setTimeout(() => dismiss(item.id), TOAST_MS[item.fx.type] ?? 3500);
    return () => window.clearTimeout(timer);
    // Feedback fires once, when the toast appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  if (!shown) return null;
  const fx = item.fx;
  const tone =
    fx.type === 'error'
      ? 'border-sili-500/70 bg-[#2a0f0a]/95'
      : fx.type === 'drinks'
        ? 'border-brass-500/60 bg-narra-850/95'
        : 'border-felt-600 bg-felt-900/95';

  return (
    <button
      type="button"
      onClick={() => dismiss(item.id)}
      data-testid={`toast-${fx.type}`}
      className={`anim-pour pointer-events-auto w-full rounded-2xl border px-4 py-3 text-left shadow-[0_14px_30px_-12px_rgb(0_0_0/0.8)] backdrop-blur-sm ${tone}`}
    >
      {fx.type === 'drinks' && <DrinkToast fx={fx} players={players} />}
      {fx.type === 'notice' && (
        <span className="font-bold text-capiz-50">{t(fx.msg.key, fx.msg.params ?? {})}</span>
      )}
      {fx.type === 'error' && (
        <span className="font-bold text-capiz-50">{t(fx.msg.key, fx.msg.params ?? {})}</span>
      )}
    </button>
  );
}

/** Full-screen "Ipasa kay …" cover. Private covers are opaque so the next player's info stays hidden. */
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
      className={`anim-fade fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 px-6 text-center ${
        fx.private ? 'bg-narra-950' : 'bg-narra-950/85 backdrop-blur-md'
      }`}
    >
      <span className="eyebrow">{t('pass.eyebrow')}</span>
      <span className="flex flex-col items-center gap-2">
        <span className="text-2xl font-bold text-capiz-200">{t('pass.to')}</span>
        <span className="sign-pintor max-w-full text-[clamp(3rem,16vw,5.5rem)] break-words">
          {name}
        </span>
      </span>
      {fx.private && <span className="max-w-xs text-capiz-300">{t('pass.private')}</span>}
      <span className="btn btn-brass mt-4 px-8">{t('pass.tap')}</span>
    </button>
  );
}

/** The pass cover waits PASS_DELAY_MS after its action; true once that delay has run out. */
function usePassShown(pass: FxItem | undefined): boolean {
  const [shownId, setShownId] = useState<number | null>(null);
  useEffect(() => {
    if (!pass) return;
    const wait = Math.max(0, PASS_DELAY_MS - (Date.now() - pass.at));
    const t = window.setTimeout(() => setShownId(pass.id), wait);
    return () => window.clearTimeout(t);
  }, [pass]);
  return pass !== undefined && shownId === pass.id;
}

/**
 * Drains the effect queue: drink toasts, notices, errors and the pass-the-phone cover.
 * Toasts stack below the HUD's turn indicator (see `useToastAnchor`) so it stays readable.
 * `holdPass` keeps the pass cover queued while the table still has to settle something
 * (e.g. a Kings Cup "Sino iinom?"), so it doesn't cover the picker.
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
  const toasts = items.filter((i) => i.fx.type !== 'passTo').slice(0, MAX_TOASTS);
  const pass = holdPass ? undefined : items.find((i) => i.fx.type === 'passTo');
  const covered = usePassShown(pass);
  return (
    <>
      {pass && covered && (
        <PassCover key={pass.id} item={pass} fx={pass.fx as PassFx} players={players} />
      )}
      {/* Over the pass cover the turn indicator is hidden anyway: toasts go back up top, clear of the name. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+76px)] z-50 mx-auto flex w-full max-w-[440px] flex-col gap-2 px-4"
        style={anchor !== null && !covered ? { top: anchor + 8 } : undefined}
        aria-live="polite"
        data-testid="toasts"
      >
        {toasts.map((i) => (
          <Toast key={i.id} item={i} players={players} />
        ))}
      </div>
    </>
  );
}
