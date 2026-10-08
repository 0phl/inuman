import type { Tier } from '@/store/settings';

type Entries = unknown[];

// Mobile benchmark tables are bundled (lazy, ~100 KB) so detection works offline and never hits a CDN.
// Desktop tables are skipped on purpose: detect-gpu then reports FALLBACK and we start desktops at 'mid'.
const BENCHMARKS = import.meta.glob<Entries>('/node_modules/detect-gpu/dist/benchmarks/m-*.json', {
  import: 'default',
});

export async function detectTier(): Promise<Tier> {
  try {
    const { getGPUTier } = await import('detect-gpu');
    const result = await getGPUTier({
      override: {
        loadBenchmarks: async (file) => {
          const load = BENCHMARKS[`/node_modules/detect-gpu/dist/benchmarks/${file}`];
          if (!load) throw new Error(`no benchmark ${file}`);
          // First entry is the data-format version string.
          return (await load()).slice(1) as never;
        },
      },
    });
    if (result.type === 'WEBGL_UNSUPPORTED' || result.type === 'BLOCKLISTED') return 'low';
    if (result.type === 'FALLBACK') return result.isMobile ? 'low' : 'mid';
    if (result.tier >= 3) return 'high';
    if (result.tier === 2) return 'mid';
    return 'low';
  } catch {
    return 'mid';
  }
}
