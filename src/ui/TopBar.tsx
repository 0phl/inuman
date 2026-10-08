import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { IconBack } from './icons';

interface TopBarProps {
  title: ReactNode;
  /** Path to go back to; omitted = no back button. */
  back?: string;
  right?: ReactNode;
}

export function TopBar({ title, back, right }: TopBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <header className="mb-4 flex min-h-12 items-center gap-3">
      {back !== undefined && (
        <button type="button" className="icon-btn" aria-label={t('nav.back')} onClick={() => navigate(back)}>
          <IconBack />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate font-sign text-[1.6rem] leading-none text-brass-300">{title}</h1>
      {right}
    </header>
  );
}
