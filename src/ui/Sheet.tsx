import { useEffect, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconClose } from './icons';

interface SheetProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  testId?: string;
}

/** Bottom sheet for thumbs: opens from the bottom edge, backdrop tap or Escape closes. */
export function Sheet({ open, onClose, title, children, testId }: SheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
    >
      <button
        type="button"
        aria-label={t('nav.close')}
        className="anim-fade absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="anim-rise relative mx-auto max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[22px] border-t border-narra-500 bg-narra-850 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+18px)] shadow-[0_-12px_40px_rgb(0_0_0/0.6)]">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-narra-500" aria-hidden />
        <div className="mb-3 flex items-center gap-2">
          <h2 id={titleId} className="flex-1 font-sign text-xl text-brass-300">
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label={t('nav.close')} onClick={onClose}>
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
