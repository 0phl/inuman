import type { PromptPack } from '@/core/content/schemas';
import { packFileJson, packFileName } from '@/store/packs';

/** `${origin}/import#s=<encoded>`: the payload rides in the hash, so it never reaches a server. */
export const shareUrl = (encoded: string, origin = location.origin): string =>
  `${origin}/import#s=${encoded}`;

/** The encoded payload from an `/import` hash (`#s=1.xxx`), or null. */
export function hashPayload(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const s = new URLSearchParams(raw).get('s');
  return s ? s.trim() : null;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const canNativeShare = (): boolean => typeof navigator.share === 'function';

export type ShareOutcome = 'shared' | 'cancelled' | 'failed';

async function tryShare(data: ShareData): Promise<ShareOutcome> {
  try {
    await navigator.share(data);
    return 'shared';
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export const shareLink = (data: { title: string; text: string; url: string }) => tryShare(data);

/**
 * Saves a pack as `<name>.dgpack.json` (pretty JSON). Uses the share sheet with a file where the
 * browser allows it, otherwise a plain download.
 */
export async function savePackFile(
  pack: PromptPack,
  title: string,
): Promise<ShareOutcome | 'downloaded'> {
  const name = packFileName(pack.name);
  const file = new File([packFileJson(pack)], name, { type: 'application/json' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    const res = await tryShare({ files: [file], title });
    if (res !== 'failed') return res;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

/** Back-links passed as `?back=` must stay inside the app. */
export function safeBack(raw: string | null, fallback: string): string {
  return raw && /^\/[a-z0-9/_-]*$/i.test(raw) && !raw.startsWith('//') ? raw : fallback;
}
