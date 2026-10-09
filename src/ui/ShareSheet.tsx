import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptPack } from '@/core/content/schemas';
import { encodeShare, LINK_MAX, shareMethod, type SharePayload } from '@/core/share/codec';
import { IconCopy, IconDownload, IconShare } from './icons';
import { QrCode } from './QrCode';
import { canNativeShare, copyText, savePackFile, shareLink, shareUrl } from './share';
import { Sheet } from './Sheet';
import { feedback } from '@/audio/feedback';

interface ShareSheetProps {
  open: boolean;
  onClose(): void;
  /** Keep this referentially stable while open; it's re-encoded when it changes. */
  payload: SharePayload | null;
  title: string;
  /** For packs: also offer the `.dgpack.json` file (the only way above LINK_MAX). */
  pack?: PromptPack;
}

type Note = 'copied' | 'copyFailed' | 'downloaded' | 'shareFailed' | null;

/** Share as QR + link (small), link only (medium), or file only (above LINK_MAX). */
export function ShareSheet({ open, onClose, payload, title, pack }: ShareSheetProps) {
  const { t } = useTranslation();
  const [encoded, setEncoded] = useState<{ src: SharePayload; value: string } | null>(null);
  const [note, setNote] = useState<Note>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !payload) return;
    let alive = true;
    void encodeShare(payload).then((value) => {
      if (alive) setEncoded({ src: payload, value });
    });
    return () => {
      alive = false;
    };
  }, [open, payload]);

  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(id);
  }, [note]);

  const value = encoded && encoded.src === payload ? encoded.value : null;
  const method = value ? shareMethod(value) : null;
  const url = value ? shareUrl(value) : '';
  const name = payload && 'name' in payload ? payload.name : '';

  const copy = async () => {
    if (await copyText(url)) {
      feedback('success');
      setNote('copied');
    }
    else {
      linkRef.current?.select();
      setNote('copyFailed');
    }
  };
  const native = async () => {
    const res = await shareLink({ title: name, text: t('share.nativeText', { name }), url });
    if (res === 'failed') setNote('shareFailed');
  };
  const file = async () => {
    if (!pack) return;
    const res = await savePackFile(pack, name);
    if (res === 'downloaded') {
      feedback('success');
      setNote('downloaded');
    }
    else if (res === 'failed') setNote('shareFailed');
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} testId="share-sheet">
      {!method ? (
        <div className="grid min-h-40 place-items-center" aria-busy="true">
          <span className="size-9 animate-spin rounded-full border-4 border-narra-600 border-t-brass-400" />
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-method={method} data-testid="share-body">
          <p
            className={`rounded-xl border px-3 py-2.5 text-sm leading-snug ${
              method === 'file'
                ? 'border-brass-500/60 bg-brass-400/10 text-brass-200'
                : 'border-narra-600 bg-narra-950/50 text-capiz-200'
            }`}
            data-testid="share-method"
          >
            {t(`share.method.${method}`, { count: value?.length ?? 0, max: LINK_MAX })}
          </p>

          {method === 'qr' && (
            <figure className="mx-auto w-full max-w-[300px] -rotate-[1.5deg] rounded-[26px] border-[5px] border-brass-500 bg-capiz-50 p-3 pb-2 shadow-[0_0_0_2px_var(--color-narra-950),0_18px_34px_-14px_rgb(0_0_0/0.9)]">
              <QrCode text={url} label={t('share.qrAlt', { name })} className="rounded-lg" />
              <figcaption className="pt-2 text-center font-sign text-[0.95rem] tracking-wide text-sili-600">
                {t('share.scan')}
              </figcaption>
            </figure>
          )}

          {method !== 'file' && (
            <div className="flex flex-col gap-2">
              <label className="eyebrow" htmlFor="share-link">
                {t('share.link')}
              </label>
              <div className="flex gap-2">
                <input
                  id="share-link"
                  ref={linkRef}
                  className="field min-w-0 flex-1 text-sm text-capiz-300"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  data-testid="share-link"
                />
                <button
                  type="button"
                  className="btn btn-wood shrink-0 px-3.5"
                  onClick={() => void copy()}
                  data-testid="share-copy"
                >
                  <IconCopy size={20} />
                  {t('share.copy')}
                </button>
              </div>
              {canNativeShare() && (
                <button
                  type="button"
                  className="btn btn-brass mt-1 min-h-14"
                  onClick={() => void native()}
                  data-testid="share-native"
                >
                  <IconShare />
                  {t('share.toGc')}
                </button>
              )}
            </div>
          )}

          {pack && (
            <button
              type="button"
              className={`btn ${method === 'file' ? 'btn-brass min-h-14' : 'btn-wood'}`}
              onClick={() => void file()}
              data-testid="share-file"
            >
              <IconDownload />
              {t('share.downloadFile')}
            </button>
          )}

          <p className="min-h-5 text-center text-sm font-bold text-brass-300" role="status">
            {note ? t(`share.${note}`) : ''}
          </p>
        </div>
      )}
    </Sheet>
  );
}
