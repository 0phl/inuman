import { useId, type ReactNode } from 'react';
import { IconMinus, IconPlus } from './icons';

interface StepperProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange(value: number): void;
  label: string;
  format?(value: number): string;
  testId?: string;
}

export function Stepper({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  onChange,
  label,
  format,
  testId,
}: StepperProps) {
  const round = (v: number) => Math.round(v / step) * step;
  const clamp = (v: number) => Math.min(max, Math.max(min, round(v)));
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label} data-testid={testId}>
      <button
        type="button"
        className="icon-btn"
        aria-label={`${label} −`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - step))}
      >
        <IconMinus />
      </button>
      <output className="min-w-12 text-center font-sign text-xl text-capiz-50" aria-live="polite">
        {format ? format(value) : value}
      </output>
      <button
        type="button"
        className="icon-btn"
        aria-label={`${label} +`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + step))}
      >
        <IconPlus />
      </button>
    </div>
  );
}

export interface SegmentOption<T> {
  value: T;
  label: string;
}

interface SegmentedProps<T> {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange(value: T): void;
  label: string;
  testId?: string;
}

export function Segmented<T extends string | number | boolean>({
  value,
  options,
  onChange,
  label,
  testId,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className="flex w-full flex-wrap gap-1 rounded-[13px] border border-narra-600 bg-narra-950/70 p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        const compact = options.length > 3;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`min-h-11 flex-1 basis-[22%] rounded-[10px] font-bold whitespace-nowrap transition-colors ${
              compact ? 'px-1 text-[0.85rem]' : 'px-2 text-[0.95rem]'
            } ${
              on
                ? 'bg-brass-400 text-narra-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.4)]'
                : 'text-capiz-300 active:bg-narra-700'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  description?: ReactNode;
  testId?: string;
}

export function Toggle({ checked, onChange, label, description, testId }: ToggleProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? id : undefined}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-4 text-left"
    >
      <span className="flex flex-col">
        <span className="font-bold text-capiz-50">{label}</span>
        {description && (
          <span id={id} className="text-sm text-capiz-400">
            {description}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-brass-500 bg-brass-400' : 'border-narra-500 bg-narra-950'
        }`}
      >
        <span
          className={`absolute top-1/2 size-6 -translate-y-1/2 rounded-full shadow transition-all ${
            checked ? 'left-[26px] bg-narra-950' : 'left-[3px] bg-capiz-300'
          }`}
        />
      </span>
    </button>
  );
}

/** A labelled settings row: label (+ help) above, control below. */
export function FieldRow({
  label,
  help,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-col">
        <span className="font-bold text-capiz-50">{label}</span>
        {help && <span className="text-sm text-capiz-400">{help}</span>}
      </div>
      {children}
    </div>
  );
}

/** Label left, compact control right. */
export function InlineRow({
  label,
  help,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="font-bold text-capiz-50">{label}</span>
        {help && <span className="text-sm text-capiz-400">{help}</span>}
      </div>
      {children}
    </div>
  );
}
