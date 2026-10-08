import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Family } from '@/core/engine/types';
import { hasLogic } from '@/core/games/registry';
import { byFamily, FAMILIES, type CatalogEntry } from '@/games/catalog';
import { IconChevron } from '@/ui/icons';
import { TopBar } from '@/ui/TopBar';

const FAMILY_MARK: Record<Family, string> = { cards: '♠︎', dice: '⚄︎', skill: '◎', party: '❝' };

function GameTile({ game }: { game: CatalogEntry }) {
  const { t } = useTranslation();
  const ready = hasLogic(game.id);
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-lg font-extrabold text-capiz-50">{t(`game.${game.id}.title`)}</span>
        <span className="text-sm leading-snug text-capiz-300">{t(`game.${game.id}.desc`)}</span>
      </span>
      {ready ? (
        <IconChevron className="shrink-0 text-brass-400" />
      ) : (
        <span className="shrink-0 -rotate-6 rounded-md border-2 border-capiz-400/60 px-2 py-0.5 font-sign text-xs text-capiz-400">
          {t('games.soon')}
        </span>
      )}
    </>
  );
  if (!ready) {
    return (
      <li>
        <div className="panel flex min-h-20 items-center gap-3 p-4 opacity-55" aria-disabled="true" data-testid={`game-${game.id}`}>
          {body}
        </div>
      </li>
    );
  }
  return (
    <li>
      <Link to={`/games/${game.id}`} className="panel flex min-h-20 items-center gap-3 p-4 transition-transform active:scale-[0.99]" data-testid={`game-${game.id}`}>
        {body}
      </Link>
    </li>
  );
}

export default function Games() {
  const { t } = useTranslation();
  return (
    <main className="screen gap-2" data-testid="games">
      <TopBar title={t('games.title')} back="/" />
      {FAMILIES.map((family) => (
        <section key={family} className="mb-4" aria-labelledby={`fam-${family}`}>
          <h2 id={`fam-${family}`} className="mb-2 flex items-center gap-2">
            <span aria-hidden className="text-lg text-brass-400">
              {FAMILY_MARK[family]}
            </span>
            <span className="eyebrow text-capiz-300">{t(`family.${family}`)}</span>
            <span className="h-px flex-1 bg-narra-600" aria-hidden />
          </h2>
          <ul className="flex flex-col gap-2">
            {byFamily(family).map((g) => (
              <GameTile key={g.id} game={g} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
