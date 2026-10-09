import { detectGpu } from '@/stage/detectTier';
import { stageHandles } from '@/stage/perf/probe';
import { useSettings } from '@/store/settings';
import type { DeviceInfo } from './results';

/** The GPU renderer string of a WebGL context (unmasked where the browser allows it). */
function rendererOf(gl: WebGLRenderingContext | WebGL2RenderingContext): string | null {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

export async function collectDevice(): Promise<DeviceInfo> {
  const s = useSettings.getState();
  const detect = await detectGpu();
  const gl = stageHandles()?.gl ?? null;
  const ctx = gl?.getContext() ?? null;
  const canvas = gl?.domElement ?? null;
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    ua: navigator.userAgent,
    gpu: ctx ? rendererOf(ctx) : null,
    detect: { tier: detect.gpuTier, type: detect.type, gpu: detect.gpu, fps: detect.fps },
    dpr: Math.round(window.devicePixelRatio * 100) / 100,
    viewport: [window.innerWidth, window.innerHeight],
    canvas: canvas ? [canvas.width, canvas.height] : null,
    cores: navigator.hardwareConcurrency || null,
    memory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    appTier: s.quality === 'auto' ? (s.detectedTier ?? detect.tier) : s.quality,
    quality: s.quality,
    maxTextureSize: gl ? gl.capabilities.maxTextureSize : null,
  };
}
