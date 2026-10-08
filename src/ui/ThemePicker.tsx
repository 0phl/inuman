import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '@/core/content/schemas';
import type { SharePayload } from '@/core/share/codec';
import {
  CARD_BACKS,
  CUP_SWATCHES,
  DEFAULT_THEME,
  DICE_MATERIALS,
  ENVIRONMENTS,
  FELT_SWATCHES,
  sameTheme,
  useTheme,
} from '@/store/theme';
import { drawCardBack } from '@/three/cardArt';
import { IconCheck, IconShare, IconUndo } from './icons';
import { ShareSheet } from './ShareSheet';
import { Sheet } from './Sheet';
import { drawDie, drawTablePreview, feltSwatchCss } from './themeArt';
import { findSwatch, swatchName } from './themeNames';

// "Itsura ng mesa": edits the theme store (environment, card back, dice, cup and felt colours)
// with live, canvas-drawn previews. Used in Settings, from the Lobby (in a sheet) and, read-only,
// by the import preview for shared looks.

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A canvas that fills its box and redraws `draw` crisply at the device pixel ratio. */
function ArtCanvas({
  draw,
  className = '',
  label,
  testId,
  data,
}: {
  draw: Draw;
  className?: string;
  label?: string;
  testId?: string;
  data?: Record<string, string>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  });
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let alive = true;
    const paint = () => {
      if (!alive) return;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawRef.current(ctx, w, h);
    };
    paint();
    // The neon sign uses the display font; repaint once it has loaded.
    void document.fonts?.load("400 16px 'Bungee'").then(paint, () => {});
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null;
    ro?.observe(c);
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [draw]);
  const attrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <canvas
      ref={ref}
      className={`block ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid={testId}
      {...attrs}
    />
  );
}

/** The whole theme as a small lit table: room, felt, a card back and a king, the cup and dice. */
export function TablePreview({
  theme,
  className = '',
  testId,
}: {
  theme: Theme;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  const key = JSON.stringify(theme);
  // Redraw only when the look changes (the draw function's identity is the dependency).
  const [draw, setDraw] = useState<{ key: string; fn: Draw }>(() => ({
    key,
    fn: (ctx, w, h) => drawTablePreview(ctx, theme, w, h),
  }));
  if (draw.key !== key) setDraw({ key, fn: (ctx, w, h) => drawTablePreview(ctx, theme, w, h) });
  return (
    <ArtCanvas
      draw={draw.fn}
      className={className}
      label={t('theme.previewAria', {
        back: t(`cardBack.${theme.cardBack}`),
        felt: swatchName(t, 'felt', theme.feltColor),
      })}
      testId={testId}
      data={{
        env: theme.environmentId,
        back: theme.cardBack,
        dice: theme.diceMaterialId,
        cup: theme.cupColor,
        felt: theme.feltColor,
      }}
    />
  );
}

function Group({
  label,
  value,
  children,
  id,
}: {
  label: string;
  value: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={id} className="font-bold text-capiz-50">
          {label}
        </span>
        <span className="truncate text-sm font-bold text-brass-300">{value}</span>
      </div>
      {children}
    </div>
  );
}

/** Selected ring + a brass check badge in the corner. */
function Picked({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-brass-400 text-narra-950 shadow-[0_2px_6px_rgb(0_0_0/0.6)]"
    >
      <IconCheck size={14} />
    </span>
  );
}

const tileClass = (on: boolean) =>
  `relative flex min-h-12 flex-col items-center gap-1.5 rounded-xl border p-1.5 pb-2 text-center transition-colors ${
    on
      ? 'border-brass-300 bg-brass-400/12 ring-2 ring-brass-400/50'
      : 'border-narra-600 bg-narra-950/50 active:bg-narra-700'
  }`;

function EnvTiles({ theme, onPick }: { theme: Theme; onPick(id: string): void }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {ENVIRONMENTS.map((id) => {
        const on = theme.environmentId === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(id)}
            className={tileClass(on)}
            data-testid={`theme-env-${id}`}
          >
            <Picked on={on} />
            <TablePreview
              theme={{ ...theme, environmentId: id }}
              className="aspect-[16/10] w-full rounded-lg"
            />
            <span className="text-[0.95rem] leading-tight font-bold text-capiz-50">
              {t(`theme.env.${id}`)}
            </span>
            <span className="text-xs leading-snug text-capiz-400">{t(`theme.envHelp.${id}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

const backDraws: Record<string, Draw> = Object.fromEntries(
  CARD_BACKS.map((id) => [
    id,
    ((ctx, w, h) => drawCardBack(ctx, id, w, h, 'screen')) satisfies Draw,
  ]),
);

function BackTiles({ value, onPick }: { value: string; onPick(id: string): void }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-4 gap-2">
      {CARD_BACKS.map((id) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(id)}
            className={tileClass(on)}
            data-testid={`theme-back-${id}`}
          >
            <Picked on={on} />
            <ArtCanvas
              draw={backDraws[id] as Draw}
              className="aspect-[5/7] w-[78%] drop-shadow-[0_3px_4px_rgb(0_0_0/0.55)]"
            />
            <span className="text-[0.8rem] leading-tight font-bold text-capiz-50">
              {t(`cardBack.${id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const diceDraws: Record<string, Draw> = Object.fromEntries(
  DICE_MATERIALS.map((id) => [
    id,
    ((ctx, w, h) => {
      const s = Math.min(h * 0.62, w * 0.36);
      drawDie(ctx, id, 5, w * 0.34, h * 0.42, s);
      drawDie(ctx, id, 1, w * 0.68, h * 0.5, s);
    }) satisfies Draw,
  ]),
);

function DiceTiles({ value, onPick }: { value: string; onPick(id: string): void }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-3 gap-2">
      {DICE_MATERIALS.map((id) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(id)}
            className={tileClass(on)}
            data-testid={`theme-dice-${id}`}
          >
            <Picked on={on} />
            <ArtCanvas draw={diceDraws[id] as Draw} className="aspect-[2/1] w-full" />
            <span className="text-[0.85rem] leading-tight font-bold text-capiz-50">
              {t(`theme.diceName.${id}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A party cup in CSS: the swatch is the thing itself. */
function CupGlyph({ hex }: { hex: string }) {
  return (
    <span aria-hidden className="relative block h-9 w-8">
      <span
        className="absolute inset-x-0 top-1 bottom-0 [clip-path:polygon(0_0,100%_0,82%_100%,18%_100%)]"
        style={{
          background: `linear-gradient(90deg, color-mix(in srgb, ${hex} 55%, black), ${hex} 30%, color-mix(in srgb, ${hex} 65%, white) 44%, ${hex} 58%, color-mix(in srgb, ${hex} 45%, black))`,
        }}
      />
      <span
        className="absolute inset-x-0 top-0 h-2.5 rounded-[50%] border-2 bg-[#efe7d8]"
        style={{ borderColor: `color-mix(in srgb, ${hex} 80%, white)` }}
      />
    </span>
  );
}

function ColorSwatches({
  kind,
  value,
  onPick,
}: {
  kind: 'cup' | 'felt';
  value: string;
  onPick(hex: string): void;
}) {
  const { t } = useTranslation();
  const list = kind === 'cup' ? CUP_SWATCHES : FELT_SWATCHES;
  const preset = findSwatch(list, value);
  const custom = !preset;
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-2 ${kind === 'cup' ? 'grid-cols-6' : 'grid-cols-5'}`}>
        {list.map((s) => {
          const on = preset?.id === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={t(`theme.${kind}Name.${s.id}`)}
              title={t(`theme.${kind}Name.${s.id}`)}
              onClick={() => onPick(s.hex)}
              className={`relative grid min-h-12 place-items-center rounded-xl border transition-colors ${
                on
                  ? 'border-brass-300 bg-brass-400/12 ring-2 ring-brass-400/50'
                  : 'border-narra-600 bg-narra-950/50 active:bg-narra-700'
              }`}
              data-testid={`theme-${kind}-${s.id}`}
            >
              <Picked on={on} />
              {kind === 'cup' ? (
                <CupGlyph hex={s.hex} />
              ) : (
                <span
                  aria-hidden
                  className="size-9 rounded-full shadow-[inset_0_2px_5px_rgb(0_0_0/0.55),0_0_0_2px_var(--color-brass-500)]"
                  style={{ background: feltSwatchCss(s.hex) }}
                />
              )}
            </button>
          );
        })}
      </div>
      {/* Any other colour: the native picker sits invisibly over the whole row. */}
      <label
        className={`relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 transition-colors focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-brass-300 ${
          custom
            ? 'border-brass-300 bg-brass-400/12 ring-2 ring-brass-400/50'
            : 'border-narra-600 bg-narra-950/50'
        }`}
        data-testid={`theme-${kind}-custom-row`}
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-[conic-gradient(#e0482f,#e8b04a,#2a6645,#1f4fb0,#3d2a5c,#e2457c,#e0482f)]"
        >
          <span
            className="size-5 rounded-full border-2 border-narra-950"
            style={{ background: custom ? value : 'var(--color-narra-900)' }}
          />
        </span>
        <span className="flex-1 font-bold text-capiz-50">{t('theme.custom')}</span>
        <span className="font-mono text-sm text-capiz-300">
          {custom ? value.toUpperCase() : ''}
        </span>
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          aria-label={t('theme.customAria', {
            what: t(kind === 'cup' ? 'theme.cup' : 'settings.felt'),
          })}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          data-testid={`theme-${kind}-custom`}
        />
      </label>
    </div>
  );
}

/** The full picker. Changes apply at once (and to the live table). */
export function ThemePicker() {
  const { t } = useTranslation();
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const resetTheme = useTheme((s) => s.resetTheme);
  const [sharing, setSharing] = useState<SharePayload | null>(null);
  const isDefault = sameTheme(theme, DEFAULT_THEME);

  return (
    <div className="flex flex-col gap-6" data-testid="theme-picker">
      <figure className="flex flex-col gap-2">
        <div className="overflow-hidden rounded-xl border border-narra-500 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.6),0_10px_24px_-14px_rgb(0_0_0/0.9)]">
          <TablePreview theme={theme} className="aspect-[16/9] w-full" testId="theme-preview" />
        </div>
        <figcaption className="text-center text-sm text-capiz-400">
          {t('theme.previewCaption')}
        </figcaption>
      </figure>

      <Group
        id="theme-env-label"
        label={t('theme.environment')}
        value={t(`theme.env.${theme.environmentId}`)}
      >
        <EnvTiles theme={theme} onPick={(environmentId) => setTheme({ environmentId })} />
      </Group>

      <Group
        id="theme-back-label"
        label={t('settings.cardBack')}
        value={t(`cardBack.${theme.cardBack}`)}
      >
        <BackTiles value={theme.cardBack} onPick={(cardBack) => setTheme({ cardBack })} />
      </Group>

      <Group
        id="theme-dice-label"
        label={t('theme.dice')}
        value={t(`theme.diceName.${theme.diceMaterialId}`)}
      >
        <DiceTiles
          value={theme.diceMaterialId}
          onPick={(diceMaterialId) => setTheme({ diceMaterialId })}
        />
      </Group>

      <Group
        id="theme-cup-label"
        label={t('theme.cup')}
        value={swatchName(t, 'cup', theme.cupColor)}
      >
        <ColorSwatches
          kind="cup"
          value={theme.cupColor}
          onPick={(cupColor) => setTheme({ cupColor })}
        />
      </Group>

      <Group
        id="theme-felt-label"
        label={t('settings.felt')}
        value={swatchName(t, 'felt', theme.feltColor)}
      >
        <ColorSwatches
          kind="felt"
          value={theme.feltColor}
          onPick={(feltColor) => setTheme({ feltColor })}
        />
      </Group>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          className="btn btn-brass"
          onClick={() =>
            setSharing({ schema: 1, kind: 'theme', name: t('theme.shareName'), theme })
          }
          data-testid="theme-share"
        >
          <IconShare size={20} />
          {t('theme.share')}
        </button>
        <button
          type="button"
          className="btn btn-wood px-3.5"
          onClick={resetTheme}
          disabled={isDefault}
          data-testid="theme-reset"
        >
          <IconUndo size={18} />
          {t('theme.reset')}
        </button>
      </div>

      <ShareSheet
        open={sharing !== null}
        onClose={() => setSharing(null)}
        payload={sharing}
        title={t('theme.shareTitle')}
      />
    </div>
  );
}

/** Lobby shortcut: the current look in a strip, tap to change it in a sheet. */
export function ThemeQuickRow() {
  const { t } = useTranslation();
  const theme = useTheme((s) => s.theme);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="panel flex min-h-16 w-full items-center gap-3 p-2.5 pr-3 text-left active:brightness-110"
        onClick={() => setOpen(true)}
        data-testid="lobby-theme"
      >
        <span className="w-28 shrink-0 overflow-hidden rounded-lg border border-narra-500">
          <TablePreview theme={theme} className="aspect-[16/10] w-full" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="eyebrow text-capiz-300">{t('theme.title')}</span>
          <span className="truncate font-bold text-capiz-50">
            {t(`cardBack.${theme.cardBack}`)} · {swatchName(t, 'felt', theme.feltColor)}
          </span>
        </span>
        <span className="chip min-h-10 shrink-0 border-brass-500/70 px-3 text-brass-200">
          {t('theme.change')}
        </span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('theme.title')}
        testId="theme-sheet"
      >
        <ThemePicker />
      </Sheet>
    </>
  );
}
