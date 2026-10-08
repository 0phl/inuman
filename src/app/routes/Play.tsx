import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import type { SessionState } from '@/core/engine/session';
import { getLogic } from '@/core/games/registry';
import { getView } from '@/games/views';
import { sceneTunnel } from '@/stage/tunnel';
import { useGameView, useSession } from '@/store/session';
import { FxLayer } from '@/ui/FxLayer';
import { IconMenu, IconPlus } from '@/ui/icons';
import { ParusaSheet } from '@/ui/ParusaSheet';
import { Sheet } from '@/ui/Sheet';
import { Tally } from '@/ui/Tally';
import { WaterReminder } from '@/ui/WaterReminder';
import { RouteFallback } from '../RootLayout';

function PlayMenu({
  open,
  onClose,
  session,
  onParusa,
}: {
  open: boolean;
  onClose(): void;
  session: SessionState;
  onParusa(): void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useSession((s) => s.dispatch);
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
    onClose();
  };
  return (
    <Sheet open={open} onClose={close} title={t(`game.${session.gameId}.title`)} testId="play-menu">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-wood"
          onClick={() => navigate('/')}
          data-testid="menu-home"
        >
          {t('play.menu.pause')}
        </button>
        <button type="button" className="btn btn-wood" onClick={() => navigate('/settings')}>
          {t('settings.title')}
        </button>
        <button
          type="button"
          className="btn btn-wood col-span-2"
          onClick={() => {
            close();
            onParusa();
          }}
        >
          {t('parusa.open')}
        </button>
      </div>
      <h3 className="eyebrow mb-1">{t('tally.title')}</h3>
      <Tally session={session} />
      <button
        type="button"
        className={`btn mt-5 w-full ${confirming ? 'btn-sili' : 'btn-wood text-sili-500'}`}
        data-testid="end-game"
        onClick={() => {
          if (!confirming) return setConfirming(true);
          dispatch({ type: 'END' });
          close();
        }}
      >
        {confirming ? t('play.menu.endConfirm') : t('play.menu.end')}
      </button>
    </Sheet>
  );
}

function GameOver({ session }: { session: SessionState }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const startGame = useSession((s) => s.startGame);
  const clear = useSession((s) => s.clear);
  return (
    <div
      className="anim-fade fixed inset-0 z-30 flex flex-col bg-narra-950/92 backdrop-blur-sm"
      data-testid="game-over"
    >
      <div className="screen w-full justify-center gap-5">
        <h2 className="sign-pintor text-[clamp(3rem,15vw,4.6rem)]">{t('play.over.title')}</h2>
        <p className="text-lg text-capiz-200">{t('play.over.body')}</p>
        <div className="panel p-4">
          <Tally session={session} />
        </div>
        <div className="grid gap-3">
          <button
            type="button"
            className="btn btn-brass min-h-14 text-lg"
            onClick={() => startGame(session.gameId)}
            data-testid="play-again"
          >
            {t('play.over.again')}
          </button>
          <button
            type="button"
            className="btn btn-wood"
            onClick={() => {
              clear();
              navigate('/');
            }}
          >
            {t('play.over.home')}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaySession({ session }: { session: SessionState }) {
  const { t } = useTranslation();
  const view = useGameView<unknown>();
  const dispatch = useSession((s) => s.dispatch);
  const gameView = getView(session.gameId);
  const [menu, setMenu] = useState(false);
  const [parusa, setParusa] = useState(false);

  if (!gameView || view === null) return <Navigate to="/" replace />;
  const { Scene, Hud } = gameView;
  const props = { view, rules: session.rules, players: session.players, dispatch };
  // 'any' = the whole table has to settle something first; the pass cover waits for it.
  const settling = !session.over && getLogic(session.gameId).activeActor(session.game) === 'any';

  return (
    <main className="relative h-dvh overflow-hidden select-none" data-testid="play">
      <sceneTunnel.In>
        <Scene {...props} />
      </sceneTunnel.In>

      <div className="pointer-events-none absolute inset-0 flex flex-col gap-2 px-4 pt-[calc(env(safe-area-inset-top)+10px)] pb-[calc(env(safe-area-inset-bottom)+16px)]">
        <header className="pointer-events-auto mx-auto flex w-full max-w-[528px] items-center gap-2">
          <button
            type="button"
            className="icon-btn"
            aria-label={t('play.menu.open')}
            onClick={() => setMenu(true)}
            data-testid="open-menu"
          >
            <IconMenu />
          </button>
          <span className="flex-1 truncate text-center text-sm font-bold text-capiz-300">
            {t(`game.${session.gameId}.title`)}
          </span>
          <button
            type="button"
            className="btn btn-wood min-h-12 gap-1 px-3 text-sm"
            onClick={() => setParusa(true)}
            data-testid="open-parusa"
          >
            <IconPlus size={18} />
            {t('parusa.short')}
          </button>
        </header>
        <WaterReminder />
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <Hud {...props} />
          </Suspense>
        </div>
      </div>

      <FxLayer players={session.players} holdPass={settling} />
      <ParusaSheet open={parusa} onClose={() => setParusa(false)} players={session.players} />
      <PlayMenu
        open={menu}
        onClose={() => setMenu(false)}
        session={session}
        onParusa={() => setParusa(true)}
      />
      {session.over && <GameOver session={session} />}
    </main>
  );
}

export default function Play() {
  const hydrated = useSession((s) => s.hydrated);
  const session = useSession((s) => s.session);
  if (!hydrated) return <RouteFallback />;
  if (!session) return <Navigate to="/" replace />;
  return <PlaySession session={session} />;
}
