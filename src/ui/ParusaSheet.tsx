import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Player } from '@/core/content/schemas';
import { useSession } from '@/store/session';
import { Segmented } from './controls';
import { Sheet } from './Sheet';

const AMOUNTS = [1, 2, 3] as const;

/** "+ Parusa": a house-rule penalty the table agrees on. Goes through MANUAL_DRINK like any drink. */
export function ParusaSheet({ open, onClose, players }: { open: boolean; onClose(): void; players: readonly Player[] }) {
  const { t } = useTranslation();
  const dispatch = useSession((s) => s.dispatch);
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState<number>(1);
  const seated = players.filter((p) => !p.sittingOut);

  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const close = () => {
    setPicked([]);
    setAmount(1);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t('parusa.title')} testId="parusa-sheet">
      <p className="mb-3 text-capiz-300">{t('parusa.help')}</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {seated.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p.id)}
              className={`min-h-12 rounded-full border px-4 font-bold ${
                on ? 'border-sili-500 bg-sili-500 text-capiz-50' : 'border-narra-500 bg-narra-950/60 text-capiz-200'
              }`}
            >
              {p.name}
            </button>
          );
        })}
      </div>
      <span className="eyebrow mb-2 block">{t('parusa.amount')}</span>
      <Segmented<number>
        label={t('parusa.amount')}
        value={amount}
        onChange={setAmount}
        options={AMOUNTS.map((n) => ({ value: n, label: t('drink.sips', { count: n }) }))}
      />
      <button
        type="button"
        className="btn btn-sili mt-5 w-full"
        disabled={picked.length === 0}
        data-testid="parusa-confirm"
        onClick={() => {
          dispatch({ type: 'MANUAL_DRINK', to: picked, amount });
          close();
        }}
      >
        {t('parusa.confirm', { count: picked.length })}
      </button>
    </Sheet>
  );
}
