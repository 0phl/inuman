// Ready-made sound cues for the game scenes: each schedules its sounds once, when an animation
// starts, at the exact offsets the animation will reach them (Web Audio timing, no per-frame work).
import {
  BALL_RADIUS,
  COIN_RADIUS,
  cupRadiusAt,
  glassRadiusAt,
  targetMouthY,
  THROW_GRAVITY,
  type ThrowKind,
} from '@/physics/throwConfig';
import type { SoundId } from './catalog';
import { play, playSequence, SILENT, type PlayOpts, type SoundHandle } from './engine';
import { haptic, hapticLater, type HapticPattern } from './haptics';
import { extractDiceImpacts, extractThrowImpacts, impactGain } from './impacts';

/** One handle for several sounds (stop them all, e.g. when a throw is superseded). */
export function group(
  handles: readonly SoundHandle[],
  cancels: readonly (() => void)[] = [],
): SoundHandle {
  if (!handles.length && !cancels.length) return SILENT;
  return {
    id: handles[0]?.id ?? null,
    stop: (ms) => {
      handles.forEach((h) => h.stop(ms));
      cancels.forEach((c) => c());
    },
    setRate: (r, ms) => handles.forEach((h) => h.setRate(r, ms)),
    setGain: (g, ms) => handles.forEach((h) => h.setGain(g, ms)),
  };
}

/** Plays `id` and a haptic `ms` later (the haptic is dropped if the cue is stopped first). */
export function withHaptic(id: SoundId, pattern: HapticPattern, opts: PlayOpts = {}): SoundHandle {
  const h = play(id, opts);
  const cancel = hapticLater(pattern, (opts.delay ?? 0) * 1000);
  return group([h], [cancel]);
}

/**
 * A card leaving the deck, turning over mid-flight and landing: `card.slide` now, `card.flip` at
 * `flipAt` of the way, `card.place` at the end (`seconds`). `flip: false` for a card that lands
 * face down / without turning.
 */
export function cardFlight(
  seconds: number,
  {
    flip = true,
    flipAt = 0.5,
    gain = 1,
    pan = 0,
    delay = 0,
  }: {
    flip?: boolean;
    flipAt?: number;
    gain?: number;
    pan?: number;
    delay?: number;
  } = {},
): SoundHandle {
  const s = Math.max(0.05, seconds);
  const hs = [play('card.slide', { gain: gain * 0.8, pan, delay })];
  if (flip) hs.push(play('card.flip', { gain, pan, delay: delay + s * flipAt }));
  hs.push(play('card.place', { gain, pan, delay: delay + s }));
  return group(hs);
}

/** Correct / wrong / tie / streak stings, `delay` seconds from now, with a matching haptic. */
export function outcome(
  kind: 'correct' | 'wrong' | 'tie' | 'streak',
  delay = 0,
  gain = 1,
): SoundHandle {
  const pattern: HapticPattern =
    kind === 'wrong'
      ? 'error'
      : kind === 'tie'
        ? 'select'
        : kind === 'streak'
          ? 'success'
          : 'impactLight';
  return withHaptic(`game.${kind}`, pattern, { delay, gain });
}

// ---------------------------------------------------------------- dice

export interface DiceThrowAudio {
  frames: Float32Array;
  steps: number;
  count: number;
  dt: number;
  dieSize: number;
  tray: { width: number; depth: number };
  obstacles?: readonly { p: readonly [number, number, number] }[];
  /** Stereo position (−1…1) of a point in the tray's local space. */
  pan?: (x: number, y: number, z: number) => number;
}

const DICE_ID = { table: 'dice.hitTable', wall: 'dice.hitWall', die: 'dice.hitDie' } as const;

/**
 * The sound of a recorded dice throw: `dice.throw` at release, then a knock for every impact found
 * in the recording, at its exact replay time, louder for harder hits and panned with the die.
 */
export function diceThrow(a: DiceThrowAudio): SoundHandle {
  const events = extractDiceImpacts({
    frames: a.frames,
    steps: a.steps,
    count: a.count,
    dt: a.dt,
    dieSize: a.dieSize,
    tray: a.tray,
    obstacles: a.obstacles,
  });
  const hs: SoundHandle[] = [play('dice.throw', { gain: 0.6 + 0.1 * Math.min(a.count, 4) })];
  for (const e of events) {
    const g = impactGain(e.speed, 0.9, 7);
    hs.push(
      play(DICE_ID[e.surface], {
        delay: e.step * a.dt,
        gain: g,
        // Harder knocks ring a touch brighter.
        rate: 0.94 + 0.1 * g,
        pan: a.pan ? a.pan(e.x, e.y, e.z) : 0,
      }),
    );
  }
  return group(hs);
}

// ---------------------------------------------------------------- throws (beer pong, quarters)

export interface ThrowAudio {
  kind: ThrowKind;
  frames: Float32Array;
  steps: number;
  dt: number;
  targets: readonly { position: readonly [number, number, number] }[];
  /** Ball in a cup / coin in the glass. */
  made: boolean;
  /** Step at which it went in (or was a sure miss). */
  resolvedStep: number;
  pan?: (x: number, y: number, z: number) => number;
}

/**
 * A recorded throw: `throw.whoosh` at release, each table bounce and rim knock at its replay
 * time, then the plop (ball in the beer) or ding (coin in the glass) with a haptic on a make.
 */
export function throwFlight(a: ThrowAudio): SoundHandle {
  const ball = a.kind === 'ball';
  const radius = ball ? BALL_RADIUS : COIN_RADIUS;
  const events = extractThrowImpacts({
    frames: a.frames,
    steps: a.steps,
    dt: a.dt,
    gravity: THROW_GRAVITY,
    radius,
    targets: a.targets,
    radiusAt: ball ? cupRadiusAt : glassRadiusAt,
    mouthY: targetMouthY(a.kind),
    until: a.made ? a.resolvedStep : Infinity,
  });
  const hs: SoundHandle[] = [play('throw.whoosh', { gain: 0.8 })];
  const cancels: (() => void)[] = [];
  for (const e of events) {
    const g = impactGain(e.speed, 0.6, ball ? 9 : 7);
    const id: SoundId =
      e.surface === 'rim' ? (ball ? 'ball.rim' : 'coin.rim') : ball ? 'ball.bounce' : 'coin.bounce';
    hs.push(play(id, { delay: e.step * a.dt, gain: g, pan: a.pan ? a.pan(e.x, e.y, e.z) : 0 }));
  }
  if (a.made) {
    const at = Math.max(0, a.resolvedStep) * a.dt;
    hs.push(play(ball ? 'ball.plop' : 'coin.ding', { delay: at }));
    cancels.push(hapticLater('impactMedium', at * 1000));
  }
  return group(hs, cancels);
}

/** Settings' "Subukan": a card, dice across the tray, then a toast, so the levels can be judged. */
export function testSample(): void {
  playSequence([
    ['card.slide', 0],
    ['card.flip', 0.18],
    ['card.place', 0.42],
    ['dice.throw', 0.85],
    ['dice.hitTable', 1.05],
    ['dice.hitDie', 1.16, { gain: 0.6 }],
    ['dice.hitTable', 1.3, { gain: 0.55, pan: 0.4 }],
    ['dice.hitWall', 1.42, { gain: 0.4, pan: 0.6 }],
    ['dice.hitTable', 1.6, { gain: 0.25 }],
    ['drink.cheers', 2.15],
  ]);
  haptic('success');
}
