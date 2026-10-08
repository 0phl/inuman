import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import type { SessionState } from '@/core/engine/session';
import { getLogic } from '@/core/games/registry';
import { getView } from '@/games/views';
import { sceneTunnel } from '@/stage/tunnel';
import { useFx } from '@/store/fx';
import { useGameView, useSession } from '@/store/session';
import { FxLayer } from '@/ui/FxLayer';
import { IconArrowRight, IconEye, IconMenu, IconPlus } from '@/ui/icons';
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

/** The last move (final reveal, last card, 4th king) stays on the table this long before the results. */
const OVER_DELAY_MS = 2200;

/**
 * When to put the game-over cover up. A game that ends while you watch shows its final move first:
 * the cover waits OVER_DELAY_MS, or comes up as soon as "Tingnan ang resulta" is tapped. A game
 * that was already over when the screen opened (reload, resume) goes straight to the results.
 * From the cover, "Silipin ang mesa" goes back to the table until the pill is tapped again.
 */
function useResultsCover(over: boolean) {
  const [shown, setShown] = useState(over);
  const [lookingAtTable, setLookingAtTable] = useState(false);
  const [wasOver, setWasOver] = useState(over);
  if (wasOver !== over) {
    // A new game (Isa pa!) starts with a clean slate.
    setWasOver(over);
    setShown(false);
    setLookingAtTable(false);
  }
  useEffect(() => {
    if (!over || shown || lookingAtTable) return;
    const t = window.setTimeout(() => setShown(true), OVER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [over, shown, lookingAtTable]);

  const visible = over && shown;
  const setResultsShown = useFx((s) => s.setResultsShown);
  useEffect(() => {
    setResultsShown(visible);
    return () => setResultsShown(false);
  }, [visible, setResultsShown]);

  return {
    visible,
    waiting: over && !shown,
    show: () => setShown(true),
    lookAtTable: () => {
      setShown(false);
      setLookingAtTable(true);
    },
  };
}

function GameOver({ session, onLookAtTable }: { session: SessionState; onLookAtTable(): void }) {
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
          <button
            type="button"
            className="btn btn-ghost gap-2 text-capiz-300"
            onClick={onLookAtTable}
            data-testid="look-at-table"
          >
            <IconEye size={20} />
            {t('play.over.lookAtTable')}
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
  const results = useResultsCover(session.over);

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
          {results.waiting ? (
            <button
              type="button"
              className="btn btn-brass anim-pour min-h-12 min-w-0 flex-1 gap-1.5 px-3 text-[0.95rem] whitespace-nowrap"
              onClick={results.show}
              data-testid="see-results"
            >
              <span className="truncate">{t('play.over.see')}</span>
              <IconArrowRight size={18} className="shrink-0" />
            </button>
          ) : (
            <span className="flex-1 truncate text-center text-sm font-bold text-capiz-300">
              {t(`game.${session.gameId}.title`)}
            </span>
          )}
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
      {results.visible && <GameOver session={session} onLookAtTable={results.lookAtTable} />}
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
