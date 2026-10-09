import { Fragment, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { play } from '@/audio/engine';
import type { Kind } from '@/core/games/truth-or-dare/prompts';
import type { Slot } from './promptFill';

// The prompt card shared by the prompt games' HUDs (Truth or Dare, Spin the Bottle, Most Likely
// To): cream card stock with a brass inner rule, placeholders swapped for highlighted names.

const PLACEHOLDER = /(\{(?:player|random|left|right)\})/g;

/** Swaps `{player}` & co. for names, highlighted so the table sees who's being called out. */
export function PromptText({ text, fills }: { text: string; fills: Record<Slot, string> }) {
  const parts: ReactNode[] = text.split(PLACEHOLDER).map((part, i) => {
    const m = /^\{(player|random|left|right)\}$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    return (
      <span
        key={i}
        className="rounded-md bg-sili-500/12 px-1 text-sili-600 underline decoration-brass-500 decoration-2 underline-offset-4"
      >
        {fills[m[1] as Slot]}
      </span>
    );
  });
  return <>{parts}</>;
}

/** TRUTH in felt green, DARE in chili red: the same colours as the wheel's segments. */
export function KindBadge({ kind, className = '' }: { kind: Kind; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-3 font-sign text-[0.85rem] tracking-[0.06em] text-capiz-50 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] ${
        kind === 'dare' ? 'bg-sili-600' : 'bg-felt-700'
      } ${className}`}
      data-kind={kind}
    >
      {t(`tod.hud.${kind}`)}
    </span>
  );
}

/** Cream prompt card. `eyebrow` sits top-left (a kind badge or a round number). */
export function PromptCard({
  eyebrow,
  children,
  delay = 0,
  testId,
  className = '',
}: {
  eyebrow?: ReactNode;
  children: ReactNode;
  delay?: number;
  testId?: string;
  className?: string;
}) {
  // Dealt onto the table: snapped over, then down on the felt, in time with its pour-in.
  useEffect(() => {
    play('card.flip', { delay: delay / 1000 });
    play('card.place', { delay: delay / 1000 + 0.22, gain: 0.8 });
    // Once, as the card appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <article
      className={`anim-pour relative rounded-[18px] border border-brass-500/80 bg-[linear-gradient(165deg,#fbf6ea,#eadfc8)] px-5 pt-3.5 pb-4 text-narra-950 shadow-[0_18px_40px_-14px_rgb(0_0_0/0.95),inset_0_1px_0_rgb(255_255_255/0.7)] ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      data-testid={testId}
      aria-live="polite"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[5px] rounded-[14px] border border-brass-500/45"
      />
      {eyebrow && (
        <span className="relative mb-1.5 flex items-center gap-2 font-sign text-[0.8rem] tracking-[0.08em] text-sili-600">
          {eyebrow}
          <span aria-hidden className="h-px flex-1 bg-brass-500/50" />
        </span>
      )}
      <div className="relative text-[clamp(1.12rem,5vw,1.36rem)] leading-snug font-bold [overflow-wrap:anywhere]">
        {children}
      </div>
    </article>
  );
}
