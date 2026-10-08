import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TeamIndex } from '@/core/games/beer-pong/skill';
import { IconArrowUp } from '@/ui/icons';
import { holdPower, TEAM_COLORS } from './layout';

// HUD pieces shared by the skill games (Beer Pong, Quarters, Flip Cup). DOM only, no three.

/** "Team Pula" / "Team Asul" with the team's colour dot. */
export function TeamName({ team, className = '' }: { team: TeamIndex; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`} data-team={team}>
      <TeamDot team={team} />
      <span className="truncate">{t(`bp.team.${team}`)}</span>
    </span>
  );
}

export function TeamDot({ team, size = 10 }: { team: TeamIndex; size?: number }) {
  const c = TEAM_COLORS[team];
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: c.hud,
        boxShadow: `0 0 0 2px rgb(14 8 5 / 0.85), 0 0 10px ${c.glow}`,
      }}
    />
  );
}

/** One brass dot per thing still available (throws, misses), like the dice games' rolls chip. */
export function DotsChip({
  left,
  cap,
  label,
  testId,
  tone = 'brass',
}: {
  left: number;
  cap: number;
  label: string;
  testId: string;
  tone?: 'brass' | 'sili';
}) {
  const on =
    tone === 'sili'
      ? 'bg-sili-500 shadow-[0_0_6px_rgb(224_72_47/0.8)]'
      : 'bg-brass-400 shadow-[0_0_6px_rgb(232_176_74/0.8)]';
  return (
    <span className="chip" data-testid={testId} data-left={left}>
      {label}
      <span aria-hidden className="ml-0.5 flex gap-1">
        {Array.from({ length: cap }, (_, i) => (
          <span key={i} className={`size-2.5 rounded-full ${i < left ? on : 'bg-narra-500'}`} />
        ))}
      </span>
    </span>
  );
}

/** The flick zone's label: an up arrow and "swipe up". Not interactive, so swipes go through it. */
export function SwipeHint({ text, active }: { text: string; active: boolean }) {
  return (
    <span
      className={`chip anim-fade gap-1.5 bg-narra-950/80 px-3 py-1.5 text-[0.82rem] backdrop-blur-sm transition-colors ${
        active ? 'border-brass-400 text-brass-200' : 'text-capiz-200'
      }`}
      data-testid="swipe-hint"
    >
      <IconArrowUp size={16} className={active ? 'text-brass-300' : 'text-capiz-300'} />
      {text}
    </span>
  );
}

/** A pass-and-play friendly power reading: 0 … 100. */
const pct = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 100);

/**
 * The accessible throw: press and hold to fill the power meter (it rises, then falls back, and so
 * on), release to throw. Works with a finger, a mouse, and Space/Enter. Hold time is measured from
 * the input events' own timestamps, so a busy frame doesn't change the throw. `ideal` marks the
 * power that would land it (shown with aim help on).
 */
export function HoldThrowButton({
  label,
  hint,
  disabled,
  ideal,
  onHold,
  onRelease,
  testId,
  className = '',
}: {
  label: ReactNode;
  hint: string;
  disabled: boolean;
  /** 0 … 1, or null to hide the marker. */
  ideal: number | null;
  /** Live power while held (null once released or cancelled). */
  onHold?(power: number | null): void;
  onRelease(power: number): void;
  testId: string;
  className?: string;
}) {
  const [power, setPower] = useState<number | null>(null);
  const start = useRef<number | null>(null);
  const raf = useRef(0);
  const cb = useRef({ onHold, onRelease });
  useEffect(() => {
    cb.current = { onHold, onRelease };
  });

  const stop = () => {
    cancelAnimationFrame(raf.current);
    start.current = null;
    setPower(null);
    cb.current.onHold?.(null);
  };

  const begin = (timeStamp: number) => {
    if (disabled || start.current !== null) return;
    start.current = timeStamp;
    // The display follows the clock; the throw itself uses the release event's timestamp.
    const t0 = performance.now();
    const tick = () => {
      const p = holdPower(performance.now() - t0);
      setPower(p);
      cb.current.onHold?.(p);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const release = (timeStamp: number) => {
    const s = start.current;
    if (s === null) return;
    const p = holdPower(timeStamp - s);
    stop();
    if (!disabled) cb.current.onRelease(p);
  };

  // A disabled button drops a hold in progress (e.g. the turn moved on).
  useEffect(() => {
    if (disabled && start.current !== null) stop();
  }, [disabled]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const holding = power !== null;
  return (
    <button
      type="button"
      className={`btn btn-brass relative min-h-16 touch-none overflow-hidden px-5 select-none ${className}`}
      disabled={disabled}
      aria-describedby={`${testId}-hint`}
      data-testid={testId}
      data-ideal={ideal === null ? '' : ideal.toFixed(3)}
      data-holding={holding}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        begin(e.timeStamp);
      }}
      onPointerUp={(e) => release(e.timeStamp)}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          begin(e.timeStamp);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          release(e.timeStamp);
        }
      }}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Power fill, left to right, under the label. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-[linear-gradient(90deg,rgb(184_52_31/0.55),rgb(224_72_47/0.85))] transition-[width] duration-75"
        style={{ width: `${holding ? pct(power) : 0}%` }}
      />
      {ideal !== null && (
        // Two notches (top and bottom edge) mark the power that lands it.
        <span
          aria-hidden
          className="absolute inset-y-0 w-0 -translate-x-1/2 before:absolute before:top-0 before:-left-[2px] before:h-2.5 before:w-[4px] before:rounded-b-full before:bg-narra-950/75 after:absolute after:bottom-0 after:-left-[2px] after:h-2.5 after:w-[4px] after:rounded-t-full after:bg-narra-950/75"
          style={{ left: `${pct(ideal)}%` }}
          data-testid={`${testId}-ideal`}
        />
      )}
      <span className="relative flex flex-col items-center leading-none">
        <span className="font-sign text-[1.35rem]">{label}</span>
        <span id={`${testId}-hint`} className="mt-1 text-[0.68rem] font-bold opacity-75">
          {holding ? `${pct(power)}%` : hint}
        </span>
      </span>
    </button>
  );
}
