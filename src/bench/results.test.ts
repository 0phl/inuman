import { describe, expect, it } from 'vitest';
import {
  COMPACT_COLUMNS,
  compactJson,
  gradeP95,
  gradeScene,
  type BenchRun,
  type SceneResult,
} from './results';

const scene = (over: Partial<SceneResult> = {}): SceneResult => ({
  id: 'higher-lower',
  tier: 'mid',
  prepMs: 12,
  firstRenderMs: 320,
  firstFrameMs: 4,
  frames: 300,
  fps: 59.8,
  p50: 16.7,
  p95: 17,
  max: 33,
  long: 0,
  cpuP50: 1.2,
  cpuP95: 3,
  calls: 19,
  tris: 44686,
  textures: 21,
  geometries: 25,
  programs: 14,
  heapMB: 30,
  longTasks: 0,
  longTaskMaxMs: 0,
  idleFrames: 0,
  actions: 4,
  ...over,
});

describe('bench grading', () => {
  it('uses 20 ms on mid/high and 33 ms on low', () => {
    expect(gradeP95(19.9, 'mid')).toBe('good');
    expect(gradeP95(25, 'mid')).toBe('warn');
    expect(gradeP95(40, 'high')).toBe('bad');
    expect(gradeP95(25, 'low')).toBe('good');
    expect(gradeP95(45, 'low')).toBe('warn');
    expect(gradeP95(60, 'low')).toBe('bad');
    expect(gradeP95(null, 'low')).toBe('none');
  });

  it('a scene is as bad as its worst of p95 and long frames; an error is bad', () => {
    expect(gradeScene(scene())).toBe('good');
    expect(gradeScene(scene({ long: 2 }))).toBe('warn');
    expect(gradeScene(scene({ long: 5 }))).toBe('bad');
    expect(gradeScene(scene({ error: 'boom' }))).toBe('bad');
  });
});

describe('compact JSON', () => {
  it('one row per scene in COMPACT_COLUMNS order, device info included', () => {
    const run: BenchRun = {
      v: 1,
      at: '2026-10-09T00:00:00.000Z',
      build: 'index-abc',
      device: {
        ua: 'UA',
        gpu: 'Adreno 610',
        detect: { tier: 1, type: 'BENCHMARK', gpu: 'adreno 610', fps: 30 },
        dpr: 2,
        viewport: [393, 851],
        canvas: [393, 851],
        cores: 8,
        memory: 4,
        appTier: 'low',
        quality: 'auto',
        maxTextureSize: 4096,
      },
      mode: 'current',
      scenes: [scene(), scene({ id: 'mexico', error: 'x' })],
      seconds: 120,
      leak: null,
    };
    const parsed = JSON.parse(compactJson(run)) as {
      cols: string[];
      scenes: unknown[][];
      device: { gpu: string };
    };
    expect(parsed.cols).toEqual([...COMPACT_COLUMNS]);
    expect(parsed.scenes[0]).toHaveLength(COMPACT_COLUMNS.length);
    expect(parsed.scenes[0]?.[COMPACT_COLUMNS.indexOf('p95')]).toBe(17);
    // An error is appended after the columns.
    expect(parsed.scenes[1]?.[COMPACT_COLUMNS.length]).toBe('x');
    expect(parsed.device.gpu).toBe('Adreno 610');
  });
});
