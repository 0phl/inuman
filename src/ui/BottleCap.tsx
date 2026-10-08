import type { ReactNode } from 'react';

const TEETH = 21; // a real crown cork has 21 crimps

function crownPath(r: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < TEETH * 2; i++) {
    const a = (i / (TEETH * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : inner;
    pts.push(`${(50 + Math.cos(a) * rr).toFixed(2)},${(50 + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const CROWN = crownPath(49, 44);

interface BottleCapProps {
  size?: number;
  tone?: 'brass' | 'sili' | 'tubig' | 'felt';
  children?: ReactNode;
  className?: string;
}

const TONES = {
  brass: { fill: '#e8b04a', ring: '#a8772a', ink: '#0e0805' },
  sili: { fill: '#e0482f', ring: '#8f2a17', ink: '#f6ecd9' },
  tubig: { fill: '#6fc3d6', ring: '#2f7f91', ink: '#0e0805' },
  felt: { fill: '#2a6645', ring: '#143826', ink: '#f6ecd9' },
};

/** Crown-cork badge: the app's mark, also used for drink amounts. */
export function BottleCap({ size = 44, tone = 'brass', children, className = '' }: BottleCapProps) {
  const c = TONES[tone];
  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="absolute inset-0" aria-hidden>
        <path d={CROWN} fill={c.fill} />
        <circle cx="50" cy="50" r="37" fill="none" stroke={c.ring} strokeWidth="3" />
        <circle cx="50" cy="50" r="31" fill="none" stroke="rgb(255 255 255 / 0.25)" strokeWidth="1.5" />
      </svg>
      <span className="relative font-sign leading-none" style={{ color: c.ink, fontSize: size * 0.4 }}>
        {children}
      </span>
    </span>
  );
}
