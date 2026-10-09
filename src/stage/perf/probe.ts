import { addAfterEffect, addEffect, addTail } from '@react-three/fiber';
import type { Camera, Scene, WebGLRenderer } from 'three';

// A frame probe on R3F's global render loop, for the perf overlay (?perf=1) and the bench (/bench).
// Nothing is hooked into the loop until someone subscribes, and it all comes off again when the
// last listener leaves, so it costs nothing in normal play.

export interface FrameSample {
  /** rAF timestamp of the frame (ms). */
  t: number;
  /** ms since the previous frame; NaN for the first frame after the loop was idle. */
  interval: number;
  /** Main-thread ms for the frame: every useFrame callback plus gl.render's command submission. */
  cpu: number;
  /** performance.now() when the frame's work ended. */
  end: number;
  /** renderer.info.render of the frame's last (main) render pass. */
  calls: number;
  triangles: number;
}

export type FrameListener = (sample: FrameSample) => void;

interface StageHandles {
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
}

let handles: StageHandles | null = null;
const listeners = new Set<FrameListener>();
let detach: (() => void) | null = null;
let frameT = 0;
let cpuStart = 0;
let lastT = -1;

/** Called by <StageProbe> inside the Canvas. */
export function setStageHandles(h: StageHandles | null): void {
  handles = h;
}

/** The live renderer, scene and camera, while the stage is mounted. */
export const stageHandles = (): StageHandles | null => handles;

function attach() {
  const offs = [
    addEffect((t) => {
      frameT = t;
      cpuStart = performance.now();
    }),
    addAfterEffect(() => {
      const end = performance.now();
      const interval = lastT < 0 ? NaN : frameT - lastT;
      lastT = frameT;
      const info = handles?.gl.info.render;
      const sample: FrameSample = {
        t: frameT,
        interval,
        cpu: end - cpuStart,
        end,
        calls: info?.calls ?? 0,
        triangles: info?.triangles ?? 0,
      };
      for (const l of listeners) l(sample);
    }),
    // The loop stopped (nothing invalidated): the next frame's interval would include idle time.
    addTail(() => {
      lastT = -1;
    }),
  ];
  detach = () => offs.forEach((off) => off());
}

/** Calls `listener` after every rendered frame until the returned function is called. */
export function subscribeFrames(listener: FrameListener): () => void {
  if (listeners.size === 0) attach();
  listeners.add(listener);
  return () => {
    if (!listeners.delete(listener) || listeners.size > 0) return;
    detach?.();
    detach = null;
    lastT = -1;
  };
}

/** Resolves after the next rendered frame (or after `timeoutMs` without one). */
export function nextFrame(timeoutMs = 5000): Promise<FrameSample | null> {
  return new Promise((resolve) => {
    const off = subscribeFrames((s) => {
      off();
      window.clearTimeout(timer);
      resolve(s);
    });
    const timer = window.setTimeout(() => {
      off();
      resolve(null);
    }, timeoutMs);
  });
}
