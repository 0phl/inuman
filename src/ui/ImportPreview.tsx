import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { PromptPack, Theme } from '@/core/content/schemas';
import type { SharePayload } from '@/core/share/codec';
import type { GameId } from '@/core/engine/types';
import { getLogic, hasLogic } from '@/core/games/registry';
import { useTx } from '@/i18n/tx';
import { spiceSpread, usePacks } from '@/store/packs';
import { MAX_PRESET_NAME, useRules } from '@/store/rules';
import { sameTheme, useTheme } from '@/store/theme';
import { checkPayload } from './importCheck';
import { KindTag, LocaleBadge, PromptText, SpiceDots, SpiceSpread } from './packBits';
import { rulesDiff, type RuleChange } from './rulesDiff';
import type { Primitive } from './rulesForm';
import { TablePreview } from './ThemePicker';
import { feltSwatchCss } from './themeArt';
import { swatchName } from './themeNames';
import { feedback } from '@/audio/feedback';

const PREVIEW_ITEMS = 10;

/** Friendly card for codec / validation error keys. */
export function ImportError({ error }: { error: string }) {
  const { t } = useTranslation();
  return (
    <section
      className="panel anim-pour flex flex-col items-center gap-3 border-sili-500/60 px-5 py-8 text-center"
      role="alert"
      data-testid="import-error"
      data-error={error}
    >
      <h2 className="sign-pintor text-[clamp(2rem,10vw,2.8rem)]">{t('import.oops')}</h2>
      <p className="max-w-[24rem] text-lg leading-snug text-capiz-200">
        {t(`${error}`, { defaultValue: t('share.invalid') })}
      </p>
      <p className="text-sm text-capiz-400">{t('import.errorHint')}</p>
    </section>
  );
}

function PackPreview({ pack }: { pack: PromptPack }) {
  const { t } = useTranslation();
  const spread = useMemo(() => spiceSpread(pack.items), [pack.items]);
  const shown = pack.items.slice(0, PREVIEW_ITEMS);
  const more = pack.items.length - shown.length;
  const tod = pack.game === 'truth-or-dare';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2
          className="font-sign text-[1.55rem] leading-tight text-brass-300 [overflow-wrap:anywhere]"
          data-testid="import-name"
        >
          {pack.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip text-capiz-50">{t(`game.${pack.game}.title`)}</span>
          <LocaleBadge locale={pack.locale} />
          <span className="chip" data-testid="import-count">
            {t('packs.count', { count: pack.items.length })}
          </span>
        </div>
        {!hasLogic(pack.game) && <p className="text-sm text-capiz-400">{t('import.noGameYet')}</p>}
      </div>

      <SpiceSpread spread={spread} legend />

      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t('import.firstItems', { count: shown.length })}</span>
        <ol className="flex flex-col gap-1.5" data-testid="import-items">
          {shown.map((item, i) => (
            <li
              key={item.id}
              className="flex gap-3 rounded-xl border border-white/8 bg-narra-950/40 px-3 py-2.5"
            >
              <span className="w-5 shrink-0 pt-0.5 font-sign text-xs text-brass-500 tabular-nums">
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="leading-snug text-capiz-50 [overflow-wrap:anywhere]">
                  <PromptText text={item.text} />
                </span>
                <span className="flex items-center gap-2">
                  <SpiceDots level={item.spice} size="sm" />
                  {tod && <KindTag kind={item.kind} />}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {more > 0 && (
          <p className="text-center text-sm text-capiz-400">{t('import.more', { count: more })}</p>
        )}
      </div>
    </div>
  );
}

function useRuleValue() {
  const { t } = useTranslation();
  const tx = useTx();
  return (c: RuleChange, v: unknown): string => {
    const f = c.field;
    if (f.kind === 'boolean') return v === true ? t('import.on') : t('import.off');
    if (f.kind === 'enum' && f.label)
      return t(`${f.label}_opt_${String(v as Primitive)}`, { defaultValue: String(v) });
    if (typeof v === 'string') return tx(v) || '—';
    return v === undefined || v === null ? '—' : String(v);
  };
}

function RulesPreview({
  gameId,
  rules,
  name,
  onName,
}: {
  gameId: GameId;
  rules: unknown;
  name: string;
  onName(name: string): void;
}) {
  const { t } = useTranslation();
  const value = useRuleValue();
  const diff = useMemo(() => rulesDiff(getLogic(gameId).rulesSchema, rules), [gameId, rules]);
  const label = (c: RuleChange) => c.trail.map((f) => (f.label ? t(f.label) : f.key)).join(' › ');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">{t('import.rulesFor')}</span>
        <h2 className="font-sign text-[1.55rem] leading-tight text-brass-300">
          {t(`game.${gameId}.title`)}
        </h2>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="font-bold text-capiz-50">{t('rulesUi.presetName')}</span>
        <input
          className="field"
          value={name}
          maxLength={MAX_PRESET_NAME}
          onChange={(e) => onName(e.target.value)}
          data-testid="import-preset-name"
        />
      </label>
      <div className="flex flex-col gap-2">
        <span className="eyebrow">{t('import.changes')}</span>
        {diff.length === 0 ? (
          <p className="text-capiz-300">{t('import.noChanges')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="import-diff">
            {diff.map((c) => (
              <li
                key={c.field.path.join('.')}
                className="flex flex-col gap-1 rounded-xl border border-white/8 bg-narra-950/40 px-3 py-2.5"
              >
                <span className="text-sm font-bold text-capiz-200">{label(c)}</span>
                <span className="flex flex-wrap items-baseline gap-x-2 [overflow-wrap:anywhere]">
                  <s className="text-capiz-400 decoration-sili-500/70">{value(c, c.from)}</s>
                  <span aria-hidden className="text-brass-400">
                    →
                  </span>
                  <b className="text-capiz-50">{value(c, c.to)}</b>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThemeImportPreview({ name, theme }: { name: string; theme: Theme }) {
  const { t } = useTranslation();
  const current = useTheme((s) => s.theme);
  const same = sameTheme(current, theme);
  const dot = (hex: string, felt = false) => (
    <span
      aria-hidden
      className="size-5 shrink-0 rounded-full border border-narra-950 shadow-[0_0_0_1.5px_var(--color-brass-500)]"
      style={{ background: felt ? feltSwatchCss(hex) : hex }}
    />
  );
  const rows: { key: keyof Theme; label: string; value: string; swatch?: ReactNode }[] = [
    {
      key: 'environmentId',
      label: t('theme.environment'),
      value: t(`theme.env.${theme.environmentId}`),
    },
    { key: 'cardBack', label: t('settings.cardBack'), value: t(`cardBack.${theme.cardBack}`) },
    {
      key: 'diceMaterialId',
      label: t('theme.dice'),
      value: t(`theme.diceName.${theme.diceMaterialId}`),
    },
    {
      key: 'cupColor',
      label: t('theme.cup'),
      value: swatchName(t, 'cup', theme.cupColor),
      swatch: dot(theme.cupColor),
    },
    {
      key: 'feltColor',
      label: t('settings.felt'),
      value: swatchName(t, 'felt', theme.feltColor),
      swatch: dot(theme.feltColor, true),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="eyebrow">{t('theme.title')}</span>
        <h2
          className="font-sign text-[1.55rem] leading-tight text-brass-300 [overflow-wrap:anywhere]"
          data-testid="import-name"
        >
          {name}
        </h2>
      </div>
      <div className="overflow-hidden rounded-xl border border-narra-500">
        <TablePreview
          theme={theme}
          className="aspect-[16/9] w-full"
          testId="import-theme-preview"
        />
      </div>
      <ul className="flex flex-col gap-1.5" data-testid="import-theme-rows">
        {rows.map((r) => {
          const changed =
            String(current[r.key]).toLowerCase() !== String(theme[r.key]).toLowerCase();
          return (
            <li
              key={r.key}
              className="flex min-h-11 items-center gap-3 rounded-xl border border-white/8 bg-narra-950/40 px-3 py-2"
              data-changed={changed}
            >
              <span className="min-w-0 flex-1 text-sm font-bold text-capiz-200">{r.label}</span>
              {r.swatch}
              <span className="font-bold text-capiz-50">{r.value}</span>
              {changed && (
                <span className="chip min-h-6 border-brass-500/70 px-2 text-[0.7rem] text-brass-200">
                  {t('import.themeNew')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {same && <p className="text-center text-capiz-300">{t('import.themeSame')}</p>}
    </div>
  );
}

type Saved =
  | { kind: 'pack'; id: string }
  | { kind: 'rules'; gameId: GameId; name: string }
  | { kind: 'theme'; previous: Theme; undone: boolean };

interface ImportPreviewProps {
  payload: SharePayload;
  onCancel(): void;
  /** Shown inside the Packs screen: "Sa mga pack" just closes the sheet. */
  onBackToPacks?(): void;
}

/** Shows what's inside a share link or file; saves it as a new custom pack or a rules preset. */
export function ImportPreview({ payload, onCancel, onBackToPacks }: ImportPreviewProps) {
  const { t } = useTranslation();
  const checked = useMemo(() => checkPayload(payload), [payload]);
  const hydrated = usePacks((s) => s.hydrated);
  const importPack = usePacks((s) => s.importPack);
  const addPreset = useRules((s) => s.addPreset);
  const setTheme = useTheme((s) => s.setTheme);
  const [presetName, setPresetName] = useState(() =>
    checked.kind === 'rules' ? checked.name.slice(0, MAX_PRESET_NAME) : '',
  );
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (checked.kind === 'error') return <ImportError error={checked.error} />;

  if (saved) {
    return (
      <section
        className="felt anim-pour flex flex-col items-center gap-3 px-5 py-8 text-center"
        data-testid="import-done"
        role="status"
      >
        <h2 className="sign-pintor relative z-10 text-[clamp(2.2rem,11vw,3rem)]">
          {saved.kind === 'theme'
            ? saved.undone
              ? t('import.themeUndone')
              : t('import.themeApplied')
            : t('import.saved')}
        </h2>
        <p className="relative z-10 text-capiz-200">
          {saved.kind === 'pack'
            ? t('import.savedPack')
            : saved.kind === 'theme'
              ? saved.undone
                ? t('import.themeUndoneBody')
                : t('import.themeAppliedBody')
              : t('import.savedRules', {
                  name: saved.name,
                  game: t(`game.${saved.gameId}.title`),
                })}
        </p>
        <div className="relative z-10 mt-2 flex w-full flex-col gap-2">
          {saved.kind === 'theme' ? (
            <>
              <Link
                to="/settings"
                className="btn btn-brass min-h-14"
                data-testid="import-to-settings"
              >
                {t('import.themeToSettings')}
              </Link>
              {!saved.undone && (
                <button
                  type="button"
                  className="btn btn-wood"
                  onClick={() => {
                    setTheme(saved.previous);
                    setSaved({ ...saved, undone: true });
                  }}
                  data-testid="import-theme-undo"
                >
                  {t('import.themeUndo')}
                </button>
              )}
            </>
          ) : saved.kind === 'pack' ? (
            <>
              <Link
                to={`/packs/${saved.id}`}
                className="btn btn-brass min-h-14"
                data-testid="import-open"
              >
                {t('import.openPack')}
              </Link>
              {onBackToPacks ? (
                <button
                  type="button"
                  className="btn btn-wood"
                  onClick={onBackToPacks}
                  data-testid="import-to-packs"
                >
                  {t('import.toPacks')}
                </button>
              ) : (
                <Link to="/packs" className="btn btn-wood" data-testid="import-to-packs">
                  {t('import.toPacks')}
                </Link>
              )}
            </>
          ) : (
            <Link to={`/games/${saved.gameId}`} className="btn btn-brass min-h-14">
              {t('import.openLobby')}
            </Link>
          )}
        </div>
      </section>
    );
  }

  const save = () => {
    if (checked.kind === 'theme') {
      setSaved({ kind: 'theme', previous: useTheme.getState().theme, undone: false });
      setTheme(checked.theme);
      feedback('success');
      return;
    }
    if (checked.kind === 'pack') {
      const res = importPack(checked.pack);
      feedback(res.ok ? 'success' : 'error');
      if (res.ok) setSaved({ kind: 'pack', id: res.value });
      else setError(res.error);
    } else {
      const res = addPreset(checked.gameId, presetName, checked.rules);
      feedback('name' in res ? 'success' : 'error');
      if ('name' in res) setSaved({ kind: 'rules', gameId: checked.gameId, name: res.name });
      else setError(res.error);
    }
  };
  const waiting = checked.kind === 'pack' && !hydrated;

  return (
    <div className="flex flex-col gap-4" data-testid="import-preview" data-kind={checked.kind}>
      <article className="panel anim-rise relative overflow-hidden p-4 pt-5">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(90deg,var(--color-brass-500)_0_14px,transparent_14px_22px)] opacity-70"
        />
        {checked.kind === 'pack' ? (
          <PackPreview pack={checked.pack} />
        ) : checked.kind === 'theme' ? (
          <ThemeImportPreview name={checked.name} theme={checked.theme} />
        ) : (
          <RulesPreview
            gameId={checked.gameId}
            rules={checked.rules}
            name={presetName}
            onName={setPresetName}
          />
        )}
      </article>
      <p className="text-center text-sm text-capiz-400">
        {checked.kind === 'pack'
          ? t('import.packNote')
          : checked.kind === 'theme'
            ? t('import.themeNote')
            : t('import.rulesNote')}
      </p>
      {error && (
        <p className="text-center font-bold text-sili-500" role="alert">
          {t(error)}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-brass min-h-16 font-sign text-xl"
          disabled={waiting}
          onClick={save}
          data-sfx="none"
          data-testid="import-save"
        >
          {waiting
            ? t('import.loading')
            : checked.kind === 'theme'
              ? t('import.themeApply')
              : t('import.save')}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCancel}
          data-testid="import-cancel"
        >
          {t('import.cancel')}
        </button>
      </div>
    </div>
  );
}
