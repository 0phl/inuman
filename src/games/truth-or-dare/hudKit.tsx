import type { ReactNode } from 'react';
import { useToastAnchor } from '@/ui/toastAnchor';

// HUD pieces shared by Spin the Bottle, Truth or Dare, Most Likely To and Ride the Bus. DOM only.

/**
 * Whose moment it is: an eyebrow pill, the big hand-painted name, then chips. Everything sits on
 * dark pills so it reads over the neon sign behind the table. Toasts stack below it.
 */
export function GameHeader({
  eyebrow,
  name,
  tone = 'brass',
  testId = 'turn-name',
  children,
}: {
  eyebrow: ReactNode;
  name: ReactNode;
  tone?: 'brass' | 'sili';
  testId?: string;
  children?: ReactNode;
}) {
  const anchor = useToastAnchor<HTMLElement>();
  return (
    <section
      ref={anchor}
      className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col items-center gap-2 bg-[radial-gradient(closest-side,rgb(14_8_5/0.72),transparent)] pt-1 pb-2 text-center [&_.chip]:bg-narra-950/85 [&_.chip]:backdrop-blur-sm"
    >
      <span className="eyebrow rounded-full bg-narra-950/80 px-3 py-1 text-capiz-300">
        {eyebrow}
      </span>
      <h2
        className={`sign-pintor max-w-full text-[clamp(1.9rem,9.5vw,3.1rem)] [overflow-wrap:anywhere] ${
          tone === 'sili' ? 'text-[#ff8a6b]' : ''
        }`}
        data-testid={testId}
      >
        {name}
      </h2>
      {children && (
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </section>
  );
}
