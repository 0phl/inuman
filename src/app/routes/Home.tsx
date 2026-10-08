import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { usePlayers } from '@/store/players';
import { useSession } from '@/store/session';
import { BottleCap } from '@/ui/BottleCap';
import { IconChevron, IconGear } from '@/ui/icons';

function ResumeCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession((s) => s.session);
  if (!session || session.over) return null;
  const seated = session.players.filter((p) => !p.sittingOut).length;
  return (
    <section className="felt anim-rise flex items-center gap-4 p-4 pr-3" data-testid="resume-card">
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <span className="eyebrow text-capiz-300">{t('home.paused')}</span>
        <span className="truncate text-xl font-extrabold text-capiz-50">{t(`game.${session.gameId}.title`)}</span>
        <span className="text-sm text-capiz-300">{t('home.pausedMeta', { count: seated })}</span>
      </div>
      <button type="button" className="btn btn-brass relative z-10 shrink-0" onClick={() => navigate('/play')} data-testid="resume">
        {t('home.resume')}
      </button>
    </section>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const count = usePlayers((s) => s.players.length);

  return (
    <main className="screen gap-6" data-testid="home">
      <header className="flex items-center justify-between">
        <BottleCap size={40} tone="sili">
          <span className="text-[13px]">18+</span>
        </BottleCap>
        <Link to="/settings" className="icon-btn" aria-label={t('settings.title')} data-testid="nav-settings">
          <IconGear />
        </Link>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-4 py-4">
        <h1 className="sign-pintor text-[clamp(3.6rem,18.5vw,6.6rem)]">{t('app.name')}</h1>
        <p className="max-w-[22rem] text-xl leading-snug text-capiz-200">{t('home.tagline')}</p>
      </section>

      <ResumeCard />

      <nav className="flex flex-col gap-3">
        <Link to="/games" className="btn btn-brass min-h-16 justify-between text-xl" data-testid="nav-games">
          <span className="font-sign text-[1.35rem]">{t('home.pickGame')}</span>
          <IconChevron />
        </Link>
        <Link to="/players" className="btn btn-wood min-h-14 justify-between" data-testid="nav-players">
          <span>{t('home.players')}</span>
          <span className="flex items-center gap-2 text-capiz-300">
            <span className="chip">{t('home.playerCount', { count })}</span>
            <IconChevron />
          </span>
        </Link>
      </nav>

      <p className="text-center text-sm text-capiz-400">{t('home.footer')}</p>
    </main>
  );
}
