import type { Face } from '@/core/primitives/dice';

// DOM-only die faces for the dice games' HUDs (Mexico, Ship Captain & Crew, Liar's Dice).
// Must not import three: HUDs load without the 3D chunk.

/** Pip centres per face in a [-1, 1] box; same layout as the 3D dice atlas. */
const PIPS: Readonly<Record<Face, readonly (readonly [number, number])[]>> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

export type DieTone = 'ivory' | 'brass' | 'ghost' | 'dim';

const FILL: Record<DieTone, { body: string; edge: string; pip: string }> = {
  ivory: { body: '#f4ead6', edge: '#c9b48c', pip: '#24160d' },
  brass: { body: '#f3c977', edge: '#a8772a', pip: '#24160d' },
  ghost: { body: 'none', edge: '#c9913a', pip: '#c9913a' },
  dim: { body: '#4d3423', edge: '#6b4a32', pip: '#a8916f' },
};

interface DieFaceProps {
  face: Face;
  /** Edge length in CSS px. */
  size?: number;
  tone?: DieTone;
  className?: string;
  /** Accessible name; defaults to the face value. Pass '' to hide it from screen readers. */
  label?: string;
}

/** A small ivory die seen from above. The 1 pip is red, like the 3D dice. */
export function DieFace({ face, size = 28, tone = 'ivory', className = '', label }: DieFaceProps) {
  const c = FILL[tone];
  const hidden = label === '';
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={hidden ? undefined : 'img'}
      aria-hidden={hidden || undefined}
      aria-label={hidden ? undefined : (label ?? String(face))}
    >
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        rx="9"
        fill={c.body}
        stroke={c.edge}
        strokeWidth={tone === 'ghost' ? 2.4 : 2}
        strokeDasharray={tone === 'ghost' ? '5 4' : undefined}
      />
      {tone !== 'ghost' && tone !== 'dim' && (
        <path
          d="M9 4.5h22"
          stroke="#ffffff"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
      {PIPS[face].map(([x, y], i) => (
        <circle
          key={i}
          cx={20 + x * 9.5}
          cy={20 + y * 9.5}
          r={face === 1 ? 5.4 : 3.7}
          fill={face === 1 && tone !== 'ghost' && tone !== 'dim' ? '#b3121f' : c.pip}
        />
      ))}
    </svg>
  );
}

/** Die faces in a row, e.g. a Mexico roll or a Liar's Dice hand. */
export function DiceRow({
  faces,
  size = 22,
  tone,
  toneOf,
  className = '',
}: {
  faces: readonly Face[];
  size?: number;
  tone?: DieTone;
  toneOf?(face: Face, index: number): DieTone;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {faces.map((f, i) => (
        <DieFace key={i} face={f} size={size} tone={toneOf ? toneOf(f, i) : tone} />
      ))}
    </span>
  );
}
