import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameId } from '@/core/engine/types';
import { getLogic } from '@/core/games/registry';
import { useTx } from '@/i18n/tx';
import { MAX_PRESET_NAME, useRules } from '@/store/rules';
import { Segmented, Stepper, Toggle } from './controls';
import { IconChevron, IconClose, IconShare } from './icons';
import { getAt, rulesFields, setAt, type FieldNode, type Primitive } from './rulesForm';

interface FieldProps {
  field: FieldNode;
  value: unknown;
  onChange(next: unknown): void;
  invalid: ReadonlySet<string>;
  depth: number;
}

function useLabels() {
  const { t, i18n } = useTranslation();
  return {
    label: (f: FieldNode) => (f.label ? t(f.label) : f.key),
    option: (f: FieldNode, v: Primitive) =>
      f.label ? t(`${f.label}_opt_${String(v)}`, { defaultValue: String(v) }) : String(v),
    help: (f: FieldNode) =>
      f.label && i18n.exists(`${f.label}_help`) ? t(`${f.label}_help`) : undefined,
  };
}

function Field({ field, value, onChange, invalid, depth }: FieldProps) {
  const tx = useTx();
  const { t } = useTranslation();
  const L = useLabels();
  const raw = getAt(value, field.path);
  const set = (v: unknown) => onChange(setAt(value, field.path, v));
  const pathKey = field.path.join('.');
  const bad = invalid.has(pathKey);
  const help = L.help(field);
  const label = L.label(field);

  const shell = (control: ReactNode, inline = false) => (
    <div
      className={`flex gap-3 py-3 ${inline ? 'items-center justify-between' : 'flex-col'} ${
        bad ? '-mx-2 rounded-lg px-2 ring-2 ring-sili-500' : ''
      }`}
      data-field={pathKey}
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-bold text-capiz-50">{label}</span>
        {help && <span className="text-sm text-capiz-300/80">{help}</span>}
        {bad && <span className="text-sm font-bold text-sili-500">{t('rulesUi.fieldError')}</span>}
      </div>
      {control}
    </div>
  );

  switch (field.kind) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : (field.min ?? 0);
      return shell(
        <Stepper
          value={n}
          min={field.min}
          max={field.max}
          step={field.step}
          label={label}
          onChange={set}
        />,
        true,
      );
    }
    case 'enum':
      return shell(
        <Segmented
          label={label}
          value={raw as Primitive}
          options={field.options.map((o) => ({ value: o, label: L.option(field, o) }))}
          onChange={set}
        />,
      );
    case 'boolean':
      return (
        <div
          className={`py-1.5 ${bad ? 'rounded-lg ring-2 ring-sili-500' : ''}`}
          data-field={pathKey}
        >
          <Toggle checked={raw === true} onChange={set} label={label} description={help} />
        </div>
      );
    case 'string':
      return shell(
        <input
          className="field"
          value={typeof raw === 'string' ? tx(raw) : ''}
          maxLength={field.maxLength}
          aria-label={label}
          // Editing turns a built-in (i18n:) default into the group's own literal text.
          onChange={(e) => set(e.target.value)}
        />,
      );
    case 'group':
      return (
        <details
          className={`rounded-xl border bg-narra-950/35 ${bad || hasInvalidChild(field, invalid) ? 'border-sili-500' : 'border-white/10'} ${depth > 0 ? 'my-1.5' : 'my-2'}`}
          data-field={pathKey}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 font-bold text-capiz-50 [&::-webkit-details-marker]:hidden">
            <IconChevron className="shrink-0 text-brass-400 transition-transform [details[open]>summary>&]:rotate-90" />
            <span className="flex-1">{label}</span>
            <GroupPreview field={field} value={value} />
          </summary>
          <div className="divide-y divide-white/8 px-3 pb-2">
            {field.children.map((c) => (
              <Field
                key={c.key}
                field={c}
                value={value}
                onChange={onChange}
                invalid={invalid}
                depth={depth + 1}
              />
            ))}
          </div>
        </details>
      );
    case 'unsupported':
      return null;
  }
}

/** A peek at the group's first text value (e.g. a Kings Cup card's title) so closed groups still read. */
function GroupPreview({
  field,
  value,
}: {
  field: Extract<FieldNode, { kind: 'group' }>;
  value: unknown;
}) {
  const tx = useTx();
  const firstText = field.children.find((c) => c.kind === 'string');
  if (!firstText) return null;
  const v = getAt(value, firstText.path);
  return typeof v === 'string' && v ? (
    <span className="max-w-[45%] truncate text-sm font-normal text-capiz-400">{tx(v)}</span>
  ) : null;
}

function hasInvalidChild(field: FieldNode, invalid: ReadonlySet<string>): boolean {
  const prefix = `${field.path.join('.')}.`;
  for (const p of invalid) if (p.startsWith(prefix)) return true;
  return false;
}

interface RulesEditorProps {
  gameId: GameId;
  value: unknown;
  onChange(next: unknown): void;
  /** Dot-joined paths that failed validation. */
  invalid?: ReadonlySet<string>;
  /** Shows a "share these rules" button next to the preset controls. */
  onShare?(): void;
}

const NONE: ReadonlySet<string> = new Set();

/** Rules form generated from the game's zod rulesSchema (via z.toJSONSchema). */
export function RulesEditor({
  gameId,
  value,
  onChange,
  invalid = NONE,
  onShare,
}: RulesEditorProps) {
  const { t } = useTranslation();
  const logic = getLogic(gameId);
  const fields = useMemo(() => rulesFields(logic.rulesSchema), [logic]);
  const presets = useRules((s) => s.byGame[gameId]?.presets);
  const reset = useRules((s) => s.reset);
  const savePreset = useRules((s) => s.savePreset);
  const applyPreset = useRules((s) => s.applyPreset);
  const deletePreset = useRules((s) => s.deletePreset);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const err = savePreset(gameId, name);
    setError(err);
    if (!err) {
      setNaming(false);
      setName('');
    }
  };

  return (
    <div data-testid="rules-editor">
      <div className="divide-y divide-white/8">
        {fields.map((f) => (
          <Field
            key={f.key}
            field={f}
            value={value}
            onChange={onChange}
            invalid={invalid}
            depth={0}
          />
        ))}
      </div>

      {presets && presets.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <span className="eyebrow">{t('rulesUi.presets')}</span>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <span key={p.name} className="chip pr-0">
                <button
                  type="button"
                  className="min-h-10 font-bold text-capiz-50"
                  onClick={() => applyPreset(gameId, p.name)}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="grid size-10 place-items-center text-capiz-400"
                  aria-label={t('rulesUi.deletePreset', { name: p.name })}
                  onClick={() => deletePreset(gameId, p.name)}
                >
                  <IconClose size={16} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {naming ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            className="field flex-1"
            autoFocus
            value={name}
            maxLength={MAX_PRESET_NAME}
            placeholder={t('rulesUi.presetPlaceholder')}
            aria-label={t('rulesUi.presetName')}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-brass">
            {t('rulesUi.save')}
          </button>
        </form>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-wood text-[0.95rem]"
            onClick={() => reset(gameId)}
            data-testid="rules-reset"
          >
            {t('rulesUi.reset')}
          </button>
          <button
            type="button"
            className="btn btn-wood text-[0.95rem]"
            onClick={() => setNaming(true)}
          >
            {t('rulesUi.savePreset')}
          </button>
          {onShare && (
            <button
              type="button"
              className="btn btn-ghost col-span-2 min-h-12 text-[0.95rem] text-brass-300"
              onClick={onShare}
              data-testid="rules-share"
            >
              <IconShare size={20} />
              {t('rulesUi.share')}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-sili-500">{t(error)}</p>}
    </div>
  );
}
