import type { ReactNode } from 'react';
import { useToastAnchor } from '@/ui/toastAnchor';

// HUD pieces shared by the dice games (Mexico, Ship Captain & Crew, Liar's Dice). DOM only.

/**
 * Turn indicator: an eyebrow pill, the big hand-painted name, then chips. The eyebrow and chips sit
 * on dark pills (as in the party games' GameHeader) so they read over the neon sign behind the
 * table. Toasts stack below it.
 */
export function TurnHeader({
  eyebrow,
  name,
  aria,
  testId = 'turn-name',
  tone = 'brass',
  children,
}: {
  eyebrow: string;
  name: string;
  aria?: string;
  testId?: string;
  tone?: 'brass' | 'sili';
  children?: ReactNode;
}) {
  const anchor = useToastAnchor<HTMLElement>();
  return (
    <section
      ref={anchor}
      className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-1.5 bg-[radial-gradient(closest-side,rgb(14_8_5/0.72),transparent)] pt-1 pb-2 text-center [&_.chip]:bg-narra-950/85 [&_.chip]:backdrop-blur-sm"
    >
      <span className="eyebrow rounded-full bg-narra-950/80 px-3 py-1 text-capiz-300">
        {eyebrow}
      </span>
      <h2
        className={`sign-pintor max-w-full text-[clamp(1.9rem,10vw,3.2rem)] [overflow-wrap:anywhere] ${
          tone === 'sili' ? 'text-[#ff8a6b]' : ''
        }`}
        aria-label={aria}
        data-testid={testId}
      >
        {name}
      </h2>
      {children && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">{children}</div>
      )}
    </section>
  );
}

/** "Rolls left" with one brass dot per roll still available. */
export function RollsChip({ left, cap, label }: { left: number; cap: number; label: string }) {
  return (
    <span className="chip" data-testid="rolls-left" data-left={left}>
      {label}
      <span aria-hidden className="ml-0.5 flex gap-1">
        {Array.from({ length: cap }, (_, i) => (
          <span
            key={i}
            className={`size-2.5 rounded-full ${
              i < left ? 'bg-brass-400 shadow-[0_0_6px_rgb(232_176_74/0.8)]' : 'bg-narra-500'
            }`}
          />
        ))}
      </span>
    </span>
  );
}
