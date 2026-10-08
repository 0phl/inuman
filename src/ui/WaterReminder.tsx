import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { IconDrop } from './icons';

/** Every `intensity.waterReminderMin` minutes: a gentle, dismissible nudge to drink water. */
export function WaterReminder() {
  const { t } = useTranslation();
  const minutes = useSettings((s) => s.intensity.waterReminderMin);
  const waterAt = useSession((s) => s.waterAt);
  const markWater = useSession((s) => s.markWater);
  const [due, setDue] = useState(false);

  useEffect(() => {
    const check = () => setDue(minutes > 0 && Date.now() - waterAt >= minutes * 60_000);
    const first = window.setTimeout(check, 0);
    const id = window.setInterval(check, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [minutes, waterAt]);

  if (!due) return null;
  return (
    <div
      role="status"
      data-testid="water-reminder"
      className="anim-pour pointer-events-auto mx-auto flex w-full max-w-[440px] items-center gap-3 rounded-2xl border border-tubig-400/60 bg-[#0d2a31]/95 px-4 py-3 shadow-lg"
    >
      <IconDrop size={28} className="shrink-0 text-tubig-300" />
      <span className="flex-1 font-bold text-capiz-50">{t('water.reminder')}</span>
      <button type="button" className="btn min-h-11 shrink-0 bg-tubig-400 px-3 text-sm text-narra-950" onClick={markWater}>
        {t('water.done')}
      </button>
    </div>
  );
}
