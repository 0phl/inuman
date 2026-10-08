import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, shareMethod, type SharePayload } from './codec';

const pack: SharePayload = {
  schema: 1,
  kind: 'pack',
  id: 'barkada-1',
  name: 'Pang-inuman namin',
  game: 'never-have-i-ever',
  locale: 'taglish',
  items: [{ id: 'a1', text: 'Never have I ever nakatulog sa jeep.', spice: 0 }],
};

describe('share codec', () => {
  it('round-trips a pack', async () => {
    const encoded = await encodeShare(pack);
    expect(encoded.startsWith('1.')).toBe(true);
    expect(encoded).toMatch(/^1\.[A-Za-z0-9_-]+$/);
    const decoded = await decodeShare(encoded);
    expect(decoded).toEqual({ ok: true, payload: pack });
  });

  it('round-trips rules and theme payloads', async () => {
    const rules: SharePayload = {
      schema: 1,
      kind: 'rules',
      gameId: 'higher-lower',
      name: 'House',
      rules: { wrongSips: 2 },
    };
    expect(await decodeShare(await encodeShare(rules))).toEqual({ ok: true, payload: rules });
  });

  it('rejects wrong versions, garbage, and invalid payloads', async () => {
    expect(await decodeShare('2.abc')).toMatchObject({ ok: false, error: 'share.badVersion' });
    expect(await decodeShare('1.!!!notbase64')).toMatchObject({
      ok: false,
      error: 'share.corrupt',
    });
    const bad = await encodeShare({ ...pack, items: [] } as unknown as SharePayload);
    expect(await decodeShare(bad)).toMatchObject({ ok: false, error: 'share.invalid' });
  });

  it('refuses decompression bombs', async () => {
    const huge = { ...pack, items: [{ id: 'x', text: 'a'.repeat(280), spice: 0 }] };
    const big = {
      ...huge,
      name: 'x',
      padding: 'a'.repeat(2 * 1024 * 1024),
    } as unknown as SharePayload;
    expect(await decodeShare(await encodeShare(big))).toMatchObject({
      ok: false,
      error: 'share.tooLarge',
    });
  });

  it('picks a share method by size', () => {
    expect(shareMethod('x'.repeat(100))).toBe('qr');
    expect(shareMethod('x'.repeat(5000))).toBe('link');
    expect(shareMethod('x'.repeat(9000))).toBe('file');
  });
});
