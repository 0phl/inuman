// Contract test for the shipped audio (public/assets/audio/manifest.json, built by `pnpm audio`):
// every catalog sound and music track has files on disk, and every third-party file is credited
// under a licence the project allows (SFX: CC0 only; music: CC0 or CC-BY).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MUSIC, SOUNDS } from './catalog';

interface Credit {
  what: string;
  author: string;
  license: string;
  url: string;
  ids?: string[];
}
interface Manifest {
  version: number;
  sfx: Record<
    string,
    { files: string[]; gainDb: number; loop: boolean; origin?: 'recorded' | 'synth' | 'mixed' }
  >;
  music: Record<
    string,
    {
      file: string;
      title: string;
      artist: string;
      license: string;
      url: string;
      loopStart: number | null;
      loopEnd: number | null;
      durationSec: number;
    }
  >;
  credits: Credit[];
}

const AUDIO_DIR = new URL('../../public/assets/audio/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', AUDIO_DIR), 'utf8')) as Manifest;
const onDisk = (rel: string) => existsSync(new URL(rel, AUDIO_DIR));

const SFX_LICENSE = /^CC0 1\.0$/;
const MUSIC_LICENSE = /^(CC0 1\.0|CC-BY [34]\.0)$/;

describe('audio manifest', () => {
  it('is a v1 manifest', () => {
    expect(manifest.version).toBe(1);
  });

  it('covers every catalog sound with at least one existing file', () => {
    for (const [id, spec] of Object.entries(SOUNDS)) {
      const e = manifest.sfx[id];
      expect(e, id).toBeDefined();
      expect(e!.files.length, id).toBeGreaterThanOrEqual(1);
      expect(e!.files.length, `${id} variants`).toBe(spec.variants);
      for (const f of e!.files) {
        expect(f, id).toMatch(/^sfx\/[\w.]+_\d+\.mp3$/);
        expect(onDisk(f), f).toBe(true);
      }
      if ('loop' in spec && spec.loop) expect(e!.loop, id).toBe(true);
    }
  });

  it('covers every music track with an existing file and sane metadata', () => {
    for (const { id } of MUSIC) {
      const m = manifest.music[id];
      expect(m, id).toBeDefined();
      expect(onDisk(m!.file), m!.file).toBe(true);
      expect(m!.license, id).toMatch(MUSIC_LICENSE);
      expect(m!.title && m!.artist && m!.url, id).toBeTruthy();
      expect(m!.durationSec, id).toBeGreaterThanOrEqual(120);
      expect(m!.durationSec, id).toBeLessThanOrEqual(240);
      if (m!.loopStart !== null || m!.loopEnd !== null) {
        expect(m!.loopStart!, id).toBeGreaterThanOrEqual(0);
        expect(m!.loopEnd!, id).toBeGreaterThan(m!.loopStart! + 1);
        expect(m!.loopEnd!, id).toBeLessThanOrEqual(m!.durationSec);
      }
    }
  });

  it('credits every music track under CC0 or CC-BY', () => {
    for (const { id } of MUSIC) {
      const m = manifest.music[id]!;
      const credit = manifest.credits.find((c) => c.url === m.url);
      expect(credit, `credit for music ${id}`).toBeDefined();
      expect(credit!.license, id).toMatch(MUSIC_LICENSE);
      expect(credit!.author, id).toBeTruthy();
    }
  });

  it('credits every non-synthesized sound effect under CC0', () => {
    for (const [id, e] of Object.entries(manifest.sfx)) {
      expect(['recorded', 'synth', 'mixed'], id).toContain(e.origin);
      if (e.origin === 'synth') continue;
      const credits = manifest.credits.filter((c) => c.ids?.includes(id) && c.url);
      expect(credits.length, `third-party credit for ${id}`).toBeGreaterThan(0);
      for (const c of credits) expect(c.license, `${id}: ${c.what}`).toMatch(SFX_LICENSE);
    }
  });

  it('only lists allowed licences, each with an author and source', () => {
    for (const c of manifest.credits) {
      expect(c.license, c.what).toMatch(MUSIC_LICENSE);
      expect(c.author, c.what).toBeTruthy();
      const musicOnly = c.ids?.every((i) => i.startsWith('music:'));
      if (!musicOnly) expect(c.license, `${c.what} is used for SFX`).toMatch(SFX_LICENSE);
    }
  });
});
