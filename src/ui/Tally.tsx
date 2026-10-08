import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SIPS_PER_TAGAY } from '@/core/engine/drink';
import type { SessionState } from '@/core/engine/session';

/**
 * A quiet per-player count in seat order. No ranking, no crowns: it's there so the table can see
 * who's had a lot, not to make a contest of it.
 */
export function Tally({ session }: { session: SessionState }) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const sips = new Map<string, number>();
    const soft = new Map<string, number>();
    for (const d of session.drinks) {
      const n = d.unit === 'tagay' ? d.amount * SIPS_PER_TAGAY : d.amount;
      const into = d.alcoholic ? sips : soft;
      into.set(d.playerId, (into.get(d.playerId) ?? 0) + n);
    }
    return session.players.map((p) => ({ p, sips: sips.get(p.id) ?? 0, soft: soft.get(p.id) ?? 0 }));
  }, [session]);

  return (
    <div data-testid="tally">
      <ul className="divide-y divide-white/8">
        {rows.map(({ p, sips, soft }) => (
          <li key={p.id} className="flex min-h-12 items-center justify-between gap-3">
            <span className={`truncate font-bold ${p.sittingOut ? 'text-capiz-400' : 'text-capiz-50'}`}>{p.name}</span>
            <span className="shrink-0 text-sm text-capiz-300">
              {t('tally.sips', { count: sips })}
              {soft > 0 && <span className="text-tubig-300"> · {t('tally.soft', { count: soft })}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-capiz-400">{t('tally.note')}</p>
    </div>
  );
}
