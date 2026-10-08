import { z } from 'zod';
import { PromptPackSchema, ThemeSchema } from '../content/schemas';

// Share links carry content in the URL hash (never sent to a server):
//   /import#s=1.<base64url(deflate-raw(json))>
// Every payload is zod-validated on the way in and shown as a preview before saving.

export const SHARE_VERSION = 1;
/** Encoded lengths (chars) that still fit comfortably in a QR code / a chat-app link. */
export const QR_MAX = 1800;
export const LINK_MAX = 8000;
const MAX_ENCODED = 64 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;

export const ShareRulesSchema = z.object({
  schema: z.literal(1),
  kind: z.literal('rules'),
  gameId: z.string().max(32),
  name: z.string().trim().min(1).max(60),
  rules: z.unknown(),
});

export const ShareThemeSchema = z.object({
  schema: z.literal(1),
  kind: z.literal('theme'),
  name: z.string().trim().min(1).max(60),
  theme: ThemeSchema,
});

export const SharePayloadSchema = z.discriminatedUnion('kind', [
  PromptPackSchema,
  ShareRulesSchema,
  ShareThemeSchema,
]);
export type SharePayload = z.output<typeof SharePayloadSchema>;

export type ShareMethod = 'qr' | 'link' | 'file';

export const shareMethod = (encoded: string): ShareMethod =>
  encoded.length <= QR_MAX ? 'qr' : encoded.length <= LINK_MAX ? 'link' : 'file';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error('share.tooLarge');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await pipe(json, new CompressionStream('deflate-raw'), Infinity);
  return `${SHARE_VERSION}.${toBase64Url(packed)}`;
}

export type DecodeResult = { ok: true; payload: SharePayload } | { ok: false; error: string };

export async function decodeShare(encoded: string): Promise<DecodeResult> {
  try {
    if (encoded.length > MAX_ENCODED) return { ok: false, error: 'share.tooLarge' };
    const dot = encoded.indexOf('.');
    if (dot < 1 || encoded.slice(0, dot) !== String(SHARE_VERSION)) {
      return { ok: false, error: 'share.badVersion' };
    }
    const bytes = fromBase64Url(encoded.slice(dot + 1));
    const json = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES);
    const parsed = SharePayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(json)));
    return parsed.success
      ? { ok: true, payload: parsed.data }
      : { ok: false, error: 'share.invalid' };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error && e.message === 'share.tooLarge' ? 'share.tooLarge' : 'share.corrupt',
    };
  }
}
