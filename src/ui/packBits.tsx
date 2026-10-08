import { Fragment, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { PACK_GAMES, SPICE_LEVELS, type PackGame, type PromptItem } from '@/core/content/schemas';
import {
  ITEM_KINDS,
  PACK_LOCALES,
  PLACEHOLDERS,
  type ItemKind,
  type PackLocale,
} from '@/store/packs';
import { Segmented } from './controls';

// Small, shared pieces of the Packs screens, the share/import previews and the lobby picker.

/** Spice level as 1–3 lit chili "pips" (0 = none lit). */
export function SpiceDots({ level, size = 'md' }: { level: number; size?: 'sm' | 'md' }) {
  const pip = size === 'sm' ? 'h-2 w-1.5' : 'h-2.5 w-1.5';
  return (
    <span className="flex gap-1" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`${pip} rounded-full ${i <= level ? 'bg-sili-500 shadow-[0_0_5px_rgb(224_72_47/0.7)]' : 'bg-narra-600'}`}
        />
      ))}
    </span>
  );
}

const SPREAD_TONE = ['bg-capiz-300', 'bg-brass-400', 'bg-sili-500', 'bg-sili-600'] as const;

/** How a pack's prompts split across spice 0..3: a stacked bar, optionally with counts. */
export function SpiceSpread({
  spread,
  legend = false,
  className = '',
}: {
  spread: readonly number[];
  legend?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const total = spread.reduce((a, b) => a + b, 0) || 1;
  const label = SPICE_LEVELS.map((l) => `${t(`spice.${l}`)}: ${spread[l] ?? 0}`).join(', ');
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} role="img" aria-label={label}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-narra-950 ring-1 ring-narra-600">
        {SPICE_LEVELS.map((l) =>
          spread[l] ? (
            <span
              key={l}
              className={`${SPREAD_TONE[l]} h-full border-r border-narra-950/60 last:border-r-0`}
              style={{ width: `${((spread[l] ?? 0) / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-capiz-400" aria-hidden>
          {SPICE_LEVELS.map((l) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${SPREAD_TONE[l]}`} />
              {t(`spice.${l}`)} <b className="text-capiz-200 tabular-nums">{spread[l] ?? 0}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Spice 0–3 as four 48px chips. */
export function SpicePicker({
  value,
  onChange,
  testId,
}: {
  value: number;
  onChange(level: number): void;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t('packs.spiceLabel')}
      className="grid grid-cols-4 gap-1.5"
      data-testid={testId}
    >
      {SPICE_LEVELS.map((level) => {
        const on = level === value;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t(`spice.${level}`)}
            title={t(`spice.${level}`)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onChange(level)}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border transition-colors ${
              on
                ? 'border-brass-300 bg-brass-400 text-narra-950'
                : 'border-narra-600 bg-narra-950/60 text-capiz-300 active:bg-narra-800'
            }`}
          >
            <span className="font-sign text-sm leading-none">{level}</span>
            <SpiceDots level={level} size="sm" />
          </button>
        );
      })}
    </div>
  );
}

export function LocaleBadge({ locale }: { locale: PackLocale }) {
  const { t } = useTranslation();
  return (
    <span className="shrink-0 rounded-md border border-tubig-400/50 bg-tubig-400/10 px-2 py-0.5 text-xs font-bold tracking-wide text-tubig-300 uppercase">
      {locale === 'any' ? t('lobby.packs.anyLocale') : t(`locale.${locale}`)}
    </span>
  );
}

const PLACEHOLDER_SPLIT = /(\{(?:player|random|left|right)\})/g;

/**
 * A prompt as plain text, with `{player}`-style slots shown as little tags. Never renders HTML:
 * shared packs are untrusted, and React text nodes keep them inert.
 */
export function PromptText({ text }: { text: string }) {
  const { t } = useTranslation();
  const parts: ReactNode[] = text.split(PLACEHOLDER_SPLIT).map((part, i) => {
    const m = /^\{(player|random|left|right)\}$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    return (
      <span
        key={i}
        className="mx-0.5 inline-block rounded-md border border-brass-500/50 bg-brass-400/15 px-1.5 text-[0.85em] leading-snug font-bold text-brass-200"
      >
        {t(`placeholder.${m[1]}`)}
      </span>
    );
  });
  return <>{parts}</>;
}

/** `{player}` `{random}` `{left}` `{right}` chips. They don't steal focus from the textarea. */
export function PlaceholderChips({
  onInsert,
  textareaRef,
}: {
  onInsert(token: string): void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t('packs.placeholders')}>
        {PLACEHOLDERS.map((token) => (
          <button
            key={token}
            type="button"
            className="chip min-h-12 justify-center gap-0.5 rounded-xl border-brass-600/70 px-1 text-[0.8rem] text-brass-200 active:bg-narra-700"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              onInsert(token);
              textareaRef?.current?.focus();
            }}
            aria-label={t('packs.insert', { name: t(`placeholder.${token.slice(1, -1)}`) })}
            data-testid={`ph-${token.slice(1, -1)}`}
          >
            <span className="text-brass-400">+</span>
            {token}
          </button>
        ))}
      </div>
      <p className="text-xs leading-snug text-capiz-400">{t('packs.placeholderHelp')}</p>
    </div>
  );
}

export function GamePicker({
  value,
  onChange,
  testId,
}: {
  value: PackGame;
  onChange(game: PackGame): void;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t('packs.game')}
      className="flex flex-col gap-1.5"
      data-testid={testId}
    >
      {PACK_GAMES.map((g) => {
        const on = g === value;
        return (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(g)}
            data-testid={testId ? `${testId}-${g}` : undefined}
            className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 text-left font-bold transition-colors ${
              on
                ? 'border-brass-400 bg-narra-700/80 text-capiz-50'
                : 'border-narra-600 bg-narra-950/50 text-capiz-300 active:bg-narra-800'
            }`}
          >
            <span
              aria-hidden
              className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-brass-300' : 'border-narra-500'}`}
            >
              {on && <span className="size-2.5 rounded-full bg-brass-300" />}
            </span>
            {t(`game.${g}.title`)}
          </button>
        );
      })}
    </div>
  );
}

export function LocalePicker({
  value,
  onChange,
  testId,
}: {
  value: PackLocale;
  onChange(locale: PackLocale): void;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t('packs.locale')}
      value={value}
      onChange={onChange}
      testId={testId}
      options={PACK_LOCALES.map((l) => ({
        value: l,
        label: l === 'any' ? t('lobby.packs.anyLocale') : t(`locale.${l}`),
      }))}
    />
  );
}

export function KindPicker({ value, onChange }: { value: ItemKind; onChange(k: ItemKind): void }) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t('packs.kindLabel')}
      value={value}
      onChange={onChange}
      options={ITEM_KINDS.map((k) => ({ value: k, label: t(`packs.kind.${k}`) }))}
    />
  );
}

/** Truth/dare/prompt as a short tag (truth-or-dare packs only). */
export function KindTag({ kind }: { kind: PromptItem['kind'] }) {
  const { t } = useTranslation();
  const k = kind ?? 'prompt';
  const tone =
    k === 'dare'
      ? 'border-sili-500/60 text-sili-500'
      : k === 'truth'
        ? 'border-tubig-400/60 text-tubig-300'
        : 'border-narra-500 text-capiz-300';
  return (
    <span className={`rounded-md border px-1.5 text-xs font-bold uppercase ${tone}`}>
      {t(`packs.kind.${k}`)}
    </span>
  );
}

/** "12/280" that warms up near the limit. */
export function CharCount({ n, max }: { n: number; max: number }) {
  const tone = n > max ? 'text-sili-500' : n > max - 20 ? 'text-brass-300' : 'text-capiz-400';
  return (
    <span className={`text-xs font-bold tabular-nums ${tone}`} aria-hidden>
      {n}/{max}
    </span>
  );
}
