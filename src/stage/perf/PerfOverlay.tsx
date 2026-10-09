import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { stageHandles, subscribeFrames, type FrameSample } from './probe';
import { percentile } from './stats';

/** How often the readout refreshes (ms). Text is written straight to the DOM: no React renders. */
const REFRESH_MS = 300;
/** No frame for this long reads as idle (frameloop="demand" with nothing moving). */
const IDLE_MS = 600;

/** Frames kept on `window.__inumanPerf` for automated profiling while the overlay is on. */
const LOG_MAX = 3000;

interface PerfLog {
  frames: FrameSample[];
}

const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
const kilo = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

/**
 * The `?perf=1` overlay: FPS, frame time, main-thread time per frame, draw calls and triangles of
 * the live stage. Mounted only while the flag is on; it subscribes to the frame probe on mount and
 * unsubscribes on unmount, so the off state costs nothing.
 */
export function PerfOverlay({ tier, visible }: { tier: string; visible: boolean }) {
  const text = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let intervals: number[] = [];
    let cpu: number[] = [];
    let lastFrameAt = 0;
    let idleFrames = 0;
    let calls = 0;
    let triangles = 0;
    const w = window as Window & { __inumanPerf?: PerfLog };
    const log = (w.__inumanPerf ??= { frames: [] });
    const off = subscribeFrames((s) => {
      log.frames.push(s);
      if (log.frames.length > LOG_MAX) log.frames.splice(0, log.frames.length - LOG_MAX);
      lastFrameAt = performance.now();
      if (Number.isFinite(s.interval)) intervals.push(s.interval);
      else idleFrames++;
      cpu.push(s.cpu);
      calls = s.calls;
      triangles = s.triangles;
    });
    const timer = window.setInterval(() => {
      const el = text.current;
      if (!el) return;
      const idle = performance.now() - lastFrameAt > IDLE_MS;
      const sorted = [...intervals].sort((a, b) => a - b);
      const mean = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
      const cpuMean = cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length);
      const mem = stageHandles()?.gl.info.memory;
      const lines = [
        idle
          ? `idle (demand) · tier ${tier}`
          : `${fmt(1000 / mean, 0)} fps · ${fmt(mean)} ms · p95 ${fmt(percentile(sorted, 95))}`,
        idle ? `bursts ${idleFrames}` : `cpu ${fmt(cpuMean)} ms · tier ${tier}`,
        `${calls} calls · ${kilo(triangles)} tris`,
        mem ? `${mem.textures} tex · ${mem.geometries} geo` : '',
      ];
      el.textContent = lines.filter(Boolean).join('\n');
      if (!idle) {
        intervals = [];
        cpu = [];
      }
    }, REFRESH_MS);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [tier]);

  return createPortal(
    <pre
      ref={text}
      data-testid="perf-overlay"
      aria-hidden
      style={{
        position: 'fixed',
        left: 4,
        bottom: 'calc(env(safe-area-inset-bottom) + 4px)',
        zIndex: 70,
        margin: 0,
        padding: '3px 6px',
        font: '10px/1.3 ui-monospace, Menlo, Consolas, monospace',
        color: '#d9ffd9',
        background: 'rgba(0,0,0,0.62)',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre',
        display: visible ? 'block' : 'none',
      }}
    />,
    document.body,
  );
}
