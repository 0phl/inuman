import { useTranslation } from 'react-i18next';
import type { PromptPack } from '@/core/content/schemas';
import { SPICE_LEVELS } from '@/core/content/schemas';
import { IconCheck } from './icons';

function SpiceDots({ level }: { level: number }) {
  return (
    <span className="flex gap-1" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-2.5 w-1.5 rounded-full ${i <= level ? 'bg-sili-500 shadow-[0_0_5px_rgb(224_72_47/0.7)]' : 'bg-narra-600'}`}
        />
      ))}
    </span>
  );
}

interface ContentPickerProps {
  packs: readonly PromptPack[];
  selected: readonly string[];
  onSelected(ids: string[]): void;
  maxSpice: number;
  /** i18n label of the game's `maxSpice` rule; its `_opt_N` keys name the levels. Omit to hide the selector. */
  spiceLabel?: string;
  onMaxSpice(level: number): void;
  /** Prompts that survive the pack + spice filters. */
  matchCount: number;
}

/** Lobby section for prompt games: which packs to deal from, and how spicy. */
export function ContentPicker({
  packs,
  selected,
  onSelected,
  maxSpice,
  spiceLabel,
  onMaxSpice,
  matchCount,
}: ContentPickerProps) {
  const { t } = useTranslation();
  const toggle = (id: string) =>
    onSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <section
      className="panel flex flex-col gap-3 p-4"
      aria-labelledby="lobby-packs"
      data-testid="content-picker"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="lobby-packs" className="eyebrow text-capiz-300">
          {t('lobby.packs.title')}
        </h2>
        <span
          className={`chip ${matchCount > 0 ? 'border-brass-600 text-brass-200' : 'border-sili-500 text-sili-500'}`}
          data-testid="prompt-count"
        >
          {t('lobby.packs.count', { count: matchCount })}
        </span>
      </div>
      <p className="-mt-1 text-sm text-capiz-400">{t('lobby.packs.help')}</p>

      <ul className="flex flex-col gap-2">
        {packs.map((p) => {
          const on = selected.includes(p.id);
          const match = p.items.filter((i) => i.spice <= maxSpice).length;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => toggle(p.id)}
                data-testid={`pack-${p.id}`}
                className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on
                    ? 'border-brass-500 bg-narra-700/80'
                    : 'border-narra-600 bg-narra-950/50 active:bg-narra-800'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid size-7 shrink-0 place-items-center rounded-lg border-2 ${
                    on
                      ? 'border-brass-300 bg-brass-400 text-narra-950'
                      : 'border-narra-500 text-transparent'
                  }`}
                >
                  <IconCheck size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 leading-snug font-bold text-capiz-50">
                    {p.name}
                  </span>
                  <span className="text-sm text-capiz-400">
                    {t('lobby.packs.items', { match, total: p.items.length })}
                  </span>
                </span>
                <span className="shrink-0 rounded-md border border-tubig-400/50 bg-tubig-400/10 px-2 py-0.5 text-xs font-bold tracking-wide text-tubig-300 uppercase">
                  {p.locale === 'any' ? t('lobby.packs.anyLocale') : t(`locale.${p.locale}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {spiceLabel && (
        <div className="flex flex-col gap-2 pt-1">
          <span className="font-bold text-capiz-50">{t('lobby.packs.spice')}</span>
          <div
            role="radiogroup"
            aria-label={t('lobby.packs.spice')}
            className="grid grid-cols-2 gap-2"
            data-testid="spice-picker"
          >
            {SPICE_LEVELS.map((level) => {
              const on = level === maxSpice;
              return (
                <button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onMaxSpice(level)}
                  className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 text-left text-[0.9rem] font-bold transition-colors ${
                    on
                      ? 'border-brass-300 bg-brass-400 text-narra-950'
                      : 'border-narra-600 bg-narra-950/60 text-capiz-200 active:bg-narra-800'
                  }`}
                >
                  <span className="min-w-0 leading-tight">
                    {t(`${spiceLabel}_opt_${level}`, { defaultValue: String(level) })}
                  </span>
                  <SpiceDots level={level} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {matchCount === 0 && (
        <p className="font-bold text-sili-500" role="alert" data-testid="no-prompts">
          {t('lobby.packs.none')}
        </p>
      )}
    </section>
  );
}
