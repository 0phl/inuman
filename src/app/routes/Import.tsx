import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { decodeShare, type DecodeResult } from '@/core/share/codec';
import { ImportError, ImportPreview } from '@/ui/ImportPreview';
import { hashPayload } from '@/ui/share';
import { TopBar } from '@/ui/TopBar';

/** `/import#s=1.<data>`: decode the shared payload, preview it, then save on request. */
export default function Import() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const encoded = useMemo(() => hashPayload(hash), [hash]);
  const [decoded, setDecoded] = useState<{ src: string; result: DecodeResult } | null>(null);

  useEffect(() => {
    if (!encoded) return;
    let alive = true;
    void decodeShare(encoded).then((result) => {
      if (alive) setDecoded({ src: encoded, result });
    });
    return () => {
      alive = false;
    };
  }, [encoded]);

  const result = decoded && decoded.src === encoded ? decoded.result : null;

  return (
    <main className="screen gap-4" data-testid="import">
      <TopBar title={t('import.title')} back="/" />

      {!encoded ? (
        <section className="felt flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="relative z-10 text-lg font-bold text-capiz-50">{t('import.emptyTitle')}</p>
          <p className="relative z-10 text-capiz-300">{t('import.emptyBody')}</p>
          <Link to="/packs" className="btn btn-wood relative z-10 mt-2">
            {t('import.toPacks')}
          </Link>
        </section>
      ) : !result ? (
        <div className="grid min-h-60 place-items-center" aria-busy="true">
          <span className="size-10 animate-spin rounded-full border-4 border-narra-600 border-t-brass-400" />
        </div>
      ) : result.ok ? (
        <>
          <p className="-mt-2 text-capiz-300">{t('import.intro')}</p>
          <ImportPreview payload={result.payload} onCancel={() => navigate('/')} />
        </>
      ) : (
        <>
          <ImportError error={result.error} />
          <Link to="/" className="btn btn-wood">
            {t('import.home')}
          </Link>
        </>
      )}
    </main>
  );
}
