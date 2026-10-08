import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useDrag } from '@use-gesture/react';
import type { Flick } from './throwMath';

// Turns a swipe that starts in the "throw zone" (the bottom ~35% of the screen, clear of the
// screen edges where iOS back-swipe and the home indicator live) into a Flick: direction and power
// from the last ~80 ms of pointer samples. No three.js here: Hud code may use it. The flick → world
// mapping (flickToThrow) and aimAssist live in throwMath.ts and are re-exported below.

export {
  aimAssist,
  ASSIST_PULL,
  ballisticPath,
  flickToThrow,
  type AssistedThrow,
  type AssistLevel,
  type CameraLike,
  type Flick,
  type RawThrow,
} from './throwMath';

export interface ThrowZone {
  /** Where the zone starts, as a fraction of the viewport height from the top. */
  top: number;
  /** Pixels kept free at the left and right edges (iOS back / forward swipe). */
  edge: number;
  /** Pixels kept free at the bottom edge (home indicator), on top of the safe-area inset. */
  bottom: number;
}

export const DEFAULT_THROW_ZONE: Readonly<ThrowZone> = { top: 0.65, edge: 28, bottom: 18 };

export interface FlickTuning {
  /** Release velocity is measured over the last `windowMs` of the swipe. */
  windowMs: number;
  /** Slower than this (viewport heights / s) is not a throw; this is power 0. */
  minSpeed: number;
  /** This fast or faster is power 1. */
  maxSpeed: number;
  /** Shorter swipes than this (fraction of the viewport height) are taps, not throws. */
  minDistance: number;
}

export const DEFAULT_FLICK_TUNING: Readonly<FlickTuning> = {
  windowMs: 80,
  minSpeed: 0.5,
  maxSpeed: 4.5,
  minDistance: 0.035,
};

export interface FlickSample {
  x: number;
  y: number;
  /** ms */
  t: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Is the client point inside the throw zone of a `width` × `height` viewport? */
export function inThrowZone(
  x: number,
  y: number,
  width: number,
  height: number,
  zone: ThrowZone = DEFAULT_THROW_ZONE,
): boolean {
  return (
    y >= height * zone.top && y <= height - zone.bottom && x >= zone.edge && x <= width - zone.edge
  );
}

/**
 * The flick a swipe ends with: its velocity over the trailing `windowMs` (interpolated), clamped
 * to power 0 … 1. Null when it's too slow, too short, or not upward-ish (within ~78° of up).
 */
export function measureFlick(
  samples: readonly FlickSample[],
  width: number,
  height: number,
  tuning: FlickTuning = DEFAULT_FLICK_TUNING,
): Flick | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || samples.length < 2 || height <= 0) return null;
  const from = last.t - tuning.windowMs;
  // The (interpolated) position `windowMs` before release.
  let ref: FlickSample = first;
  for (let i = samples.length - 2; i >= 0; i--) {
    const a = samples[i] as FlickSample;
    if (a.t <= from) {
      const b = samples[i + 1] as FlickSample;
      const k = b.t > a.t ? (from - a.t) / (b.t - a.t) : 0;
      ref = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t: from };
      break;
    }
  }
  const dt = last.t - ref.t;
  if (dt < 8) return null;
  const vx = (last.x - ref.x) / dt;
  const vy = (last.y - ref.y) / dt;
  const v = Math.hypot(vx, vy);
  const speed = (v * 1000) / height;
  const dist = Math.hypot(last.x - first.x, last.y - first.y) / height;
  if (speed < tuning.minSpeed || dist < tuning.minDistance || v === 0) return null;
  const direction: [number, number] = [vx / v, vy / v];
  if (direction[1] > -0.2) return null;
  return {
    direction,
    power: clamp01((speed - tuning.minSpeed) / (tuning.maxSpeed - tuning.minSpeed)),
    speed,
    start: [first.x / width, first.y / height],
    end: [last.x / width, last.y / height],
    aspect: width / height,
  };
}

/** The live estimate while the finger is still down (for an aim preview). */
function estimateFlick(
  samples: readonly FlickSample[],
  width: number,
  height: number,
  tuning: FlickTuning,
): Flick | null {
  const live = measureFlick(samples, width, height, tuning);
  if (live) return live;
  // Moving slowly: keep the swipe's direction so far, at a middling strength.
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const d = Math.hypot(dx, dy);
  if (d / height < tuning.minDistance || dy / d > -0.2) return null;
  return {
    direction: [dx / d, dy / d],
    power: 0.5,
    speed: 0,
    start: [first.x / width, first.y / height],
    end: [last.x / width, last.y / height],
    aspect: width / height,
  };
}

const INTERACTIVE =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="slider"], [role="tab"], [data-no-flick]';

const isInteractive = (t: EventTarget | null): boolean =>
  typeof Element !== 'undefined' && t instanceof Element && t.closest(INTERACTIVE) !== null;

export interface UseFlickOptions {
  /** Called once per swipe that is fast and long enough to be a throw. */
  onFlick(flick: Flick): void;
  /** Live estimate while dragging (for an aim preview); null when the finger lifts or cancels. */
  onAim?(aim: Flick | null): void;
  /** Default true. While false nothing is listened to. */
  enabled?: boolean;
  /**
   * 'window' (default): listen everywhere and only start a flick inside the throw zone and not on
   * a button/link/input (or anything under [data-no-flick]). Or a ref to your own zone element
   * (give it `zoneStyle`): then the element *is* the zone.
   */
  target?: 'window' | RefObject<HTMLElement | null>;
  zone?: Partial<ThrowZone>;
  tuning?: Partial<FlickTuning>;
}

export interface UseFlickResult {
  /** A finger/mouse is down on a flick that started in the zone. */
  dragging: boolean;
  /** Absolute-position style for an optional zone element (touch-action: none, edges kept free). */
  zoneStyle: CSSProperties;
}

/**
 * Swipe-to-throw. While mounted (and enabled) it disables pull-to-refresh/overscroll on the page
 * and blocks touch scrolling for the duration of a flick, so a fast upward swipe never scrolls or
 * reloads. Taps and swipes that start outside the zone pass straight through to the HUD.
 */
export function useFlick(opts: UseFlickOptions): UseFlickResult {
  const enabled = opts.enabled ?? true;
  const target = opts.target ?? 'window';
  const zone: ThrowZone = { ...DEFAULT_THROW_ZONE, ...opts.zone };
  const tuning: FlickTuning = { ...DEFAULT_FLICK_TUNING, ...opts.tuning };
  const latest = useRef({ opts, zone, tuning, target });
  useEffect(() => {
    latest.current = { opts, zone, tuning, target };
  });
  const samples = useRef<FlickSample[]>([]);
  const armed = useRef(false);
  const [dragging, setDragging] = useState(false);

  // No pull-to-refresh / overscroll bounce while a throw scene is up; no touch scroll mid-flick.
  useEffect(() => {
    if (!enabled) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overscrollBehavior, body.style.overscrollBehavior];
    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    const block = (e: TouchEvent) => {
      if (armed.current && e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', block, { passive: false });
    return () => {
      document.removeEventListener('touchmove', block);
      html.style.overscrollBehavior = prev[0] ?? '';
      body.style.overscrollBehavior = prev[1] ?? '';
      armed.current = false;
    };
  }, [enabled]);

  useDrag(
    ({ first, last, xy, initial, event, cancel, canceled, timeStamp }) => {
      const { opts: o, zone: z, tuning: tu, target: tg } = latest.current;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (first) {
        const inZone = tg === 'window' ? inThrowZone(initial[0], initial[1], w, h, z) : true;
        if (!inZone || isInteractive(event.target)) {
          armed.current = false;
          cancel();
          return;
        }
        armed.current = true;
        samples.current = [{ x: initial[0], y: initial[1], t: timeStamp }];
        setDragging(true);
      }
      if (!armed.current) return;
      const buf = samples.current;
      const prevT = buf[buf.length - 1]?.t ?? timeStamp;
      buf.push({ x: xy[0], y: xy[1], t: Math.max(timeStamp, prevT) });
      // Keep the first sample (start point) and ~250 ms of history.
      while (buf.length > 3 && (buf[1] as FlickSample).t < timeStamp - 250) buf.splice(1, 1);
      if (last) {
        armed.current = false;
        setDragging(false);
        o.onAim?.(null);
        if (canceled) return;
        const flick = measureFlick(buf, w, h, tu);
        if (flick) o.onFlick(flick);
        return;
      }
      o.onAim?.(estimateFlick(buf, w, h, tu));
    },
    {
      target: target === 'window' ? (typeof window === 'undefined' ? undefined : window) : target,
      enabled,
      pointer: { capture: false, keys: false },
      eventOptions: { passive: false },
      filterTaps: false,
      threshold: 0,
    },
  );

  const zoneStyle: CSSProperties = {
    position: 'absolute',
    left: zone.edge,
    right: zone.edge,
    top: `${zone.top * 100}%`,
    bottom: `calc(env(safe-area-inset-bottom) + ${zone.bottom}px)`,
    touchAction: 'none',
    overscrollBehavior: 'contain',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };
  return { dragging, zoneStyle };
}
