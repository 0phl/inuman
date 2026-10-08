import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Player } from '@/core/content/schemas';
import { MAX_NAME, MAX_PLAYERS, usePlayers } from '@/store/players';
import { IconChevron, IconClose, IconDown, IconDrop, IconPause, IconPlus, IconUp } from '@/ui/icons';
import { TopBar } from '@/ui/TopBar';

function PlayerRow({ p, index, total }: { p: Player; index: number; total: number }) {
  const { t } = useTranslation();
  const { rename, remove, move, toggleNonAlcoholic, toggleSittingOut } = usePlayers.getState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.name);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const err = rename(p.id, draft);
    setError(err);
    if (!err) setEditing(false);
  };

  return (
    <li className={`panel flex flex-col gap-2 p-3 ${p.sittingOut ? 'opacity-70' : ''}`} data-testid="player-row">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-brass-600 font-sign text-sm text-brass-300" aria-label={t('players.seat', { n: index + 1 })}>
          {index + 1}
        </span>
        {editing ? (
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <input className="field min-h-12 flex-1" autoFocus value={draft} maxLength={MAX_NAME} aria-label={t('players.rename')} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
          </form>
        ) : (
          <button type="button" className="min-h-12 min-w-0 flex-1 truncate text-left text-lg font-bold text-capiz-50" onClick={() => setEditing(true)} aria-label={t('players.renameNamed', { name: p.name })}>
            {p.name}
          </button>
        )}
        <button type="button" className="icon-btn" aria-label={t('players.remove', { name: p.name })} onClick={() => remove(p.id)}>
          <IconClose />
        </button>
      </div>
      {error && <p className="text-sm font-bold text-sili-500">{t(error)}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={p.nonAlcoholic}
          onClick={() => toggleNonAlcoholic(p.id)}
          title={t('players.nonAlc')}
          className={`chip min-h-11 whitespace-nowrap px-3 ${p.nonAlcoholic ? 'border-tubig-400 bg-tubig-400/15 text-tubig-300' : ''}`}
        >
          <IconDrop size={16} />
          {t('players.nonAlcChip')}
        </button>
        <button
          type="button"
          aria-pressed={p.sittingOut}
          onClick={() => toggleSittingOut(p.id)}
          title={t('players.sittingOut')}
          className={`chip min-h-11 whitespace-nowrap px-3 ${p.sittingOut ? 'border-brass-400 bg-brass-400/15 text-brass-300' : ''}`}
        >
          <IconPause size={16} />
          {t('players.sittingOutChip')}
        </button>
        <span className="flex-1" />
        <button type="button" className="icon-btn" disabled={index === 0} aria-label={t('players.moveUp', { name: p.name })} onClick={() => move(p.id, -1)}>
          <IconUp />
        </button>
        <button type="button" className="icon-btn" disabled={index === total - 1} aria-label={t('players.moveDown', { name: p.name })} onClick={() => move(p.id, 1)}>
          <IconDown />
        </button>
      </div>
    </li>
  );
}

export default function Players() {
  const { t } = useTranslation();
  const players = usePlayers((s) => s.players);
  const add = usePlayers((s) => s.add);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const full = players.length >= MAX_PLAYERS;

  const submit = () => {
    const err = add(name);
    setError(err);
    if (!err) setName('');
  };

  return (
    <main className="screen gap-4" data-testid="players">
      <TopBar title={t('players.title')} back="/" />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="field flex-1"
          value={name}
          maxLength={MAX_NAME}
          placeholder={t('players.placeholder')}
          aria-label={t('players.nameLabel')}
          enterKeyHint="done"
          autoComplete="off"
          disabled={full}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          data-testid="player-name"
        />
        <button type="submit" className="btn btn-brass shrink-0 px-4" disabled={full} data-testid="add-player">
          <IconPlus />
          {t('players.add')}
        </button>
      </form>
      {error && (
        <p className="-mt-2 text-sm font-bold text-sili-500" role="alert">
          {t(error, { max: MAX_PLAYERS })}
        </p>
      )}

      {players.length === 0 ? (
        <div className="felt flex flex-col items-center gap-2 px-6 py-10 text-center">
          <p className="relative z-10 text-lg font-bold text-capiz-50">{t('players.emptyTitle')}</p>
          <p className="relative z-10 text-capiz-300">{t('players.emptyBody')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-capiz-400">{t('players.orderHint')}</p>
          <ul className="flex flex-col gap-2.5">
            {players.map((p, i) => (
              <PlayerRow key={p.id} p={p} index={i} total={players.length} />
            ))}
          </ul>
        </>
      )}

      <div className="flex-1" />
      {players.length > 0 && (
        <Link to="/games" className="btn btn-brass sticky bottom-[calc(env(safe-area-inset-bottom)+12px)] min-h-14 justify-between text-lg" data-testid="players-next">
          <span>{t('players.next')}</span>
          <IconChevron />
        </Link>
      )}
    </main>
  );
}
