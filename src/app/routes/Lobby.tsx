import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { preload } from '@/audio/engine';
import { soundsFor } from '@/audio/gameSounds';
import { collectPrompts } from '@/core/content/builtin';
import { PACK_GAMES, type PackGame } from '@/core/content/schemas';
import type { GameId } from '@/core/engine/types';
import { getLogic, hasLogic } from '@/core/games/registry';
import type { SharePayload } from '@/core/share/codec';
import { isGameId } from '@/games/catalog';
import { hasView } from '@/games/views';
import { allPacksFor, resolvePicks, usePackPicks, usePacks } from '@/store/packs';
import { usePlayers } from '@/store/players';
import { defaultRules, useRules, validRules } from '@/store/rules';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { ContentPicker } from '@/ui/ContentPicker';
import { Segmented, Toggle } from '@/ui/controls';
import { RulesEditor } from '@/ui/RulesEditor';
import { rulesFields } from '@/ui/rulesForm';
import { ShareSheet } from '@/ui/ShareSheet';
import { ThemeQuickRow } from '@/ui/ThemePicker';
import { TopBar } from '@/ui/TopBar';

const MULTIPLIERS = [0.5, 1, 1.5, 2] as const;

const isPackGame = (id: GameId): id is PackGame => (PACK_GAMES as readonly string[]).includes(id);

/** Games that can deal from another game's packs, but only when their rules ask for it.
 *  Unlike `needsContent` games they still play with no prompts (the table makes them up). */
const BORROWED_PACKS: Partial<
  Record<GameId, { game: PackGame; when: (rules: unknown) => boolean }>
> = {
  'spin-the-bottle': {
    game: 'truth-or-dare',
    when: (rules) => (rules as { outcome?: unknown } | null)?.outcome === 'truthOrDare',
  },
};

/** The `maxSpice` rule as currently edited (clamped), else the game's default. */
function spiceOf(id: GameId, rules: unknown): number {
  const raw = (rules as { maxSpice?: unknown } | null)?.maxSpice;
  if (typeof raw === 'number' && Number.isFinite(raw))
    return Math.min(Math.max(Math.round(raw), 0), 3);
  const fallback = (defaultRules(id) as { maxSpice?: unknown }).maxSpice;
  return typeof fallback === 'number' ? fallback : 3;
}

function QuickIntensity() {
  const { t } = useTranslation();
  const intensity = useSettings((s) => s.intensity);
  const setIntensity = useSettings((s) => s.setIntensity);
  const soft = intensity.mode === 'non-alcoholic';
  return (
    <div className="flex flex-col gap-3">
      <Toggle
        checked={soft}
        onChange={(on) => setIntensity({ mode: on ? 'non-alcoholic' : 'alcohol' })}
        label={t('intensity.nonAlcMode')}
        description={t('intensity.nonAlcModeHelp')}
        testId="quick-nonalc"
      />
      <div className="flex flex-col gap-1.5">
        <span className="font-bold text-capiz-50">{t('intensity.multiplier')}</span>
        <Segmented
          label={t('intensity.multiplier')}
          value={intensity.multiplier}
          onChange={(multiplier) => setIntensity({ multiplier })}
          options={MULTIPLIERS.map((m) => ({
            value: m,
            label: t(`intensity.mult.${String(m).replace('.', '_')}`),
          }))}
        />
      </div>
      {!soft && (
        <div className="flex flex-col gap-1.5">
          <span className="font-bold text-capiz-50">{t('intensity.unit')}</span>
          <Segmented
            label={t('intensity.unit')}
            value={intensity.unit}
            onChange={(unit) => setIntensity({ unit })}
            options={[
              { value: 'sip', label: t('intensity.unitSip') },
              { value: 'tagay', label: t('intensity.unitTagay') },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function LobbyFor({ id }: { id: GameId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logic = getLogic(id);
  const players = usePlayers((s) => s.players);
  const raw = useRules((s) => s.byGame[id]?.current);
  const setRules = useRules((s) => s.setRules);
  const session = useSession((s) => s.session);
  const startGame = useSession((s) => s.startGame);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Fetch and decode this game's sounds while the rules are being read.
  useEffect(() => preload(soundsFor(id)), [id]);

  // Prompt games: which packs to deal from — built-ins plus the barkada's own. The last pick is
  // remembered per game (default: the UI language's built-in pack); spice lives in the rules.
  const locale = useSettings((s) => s.locale);
  const needsContent = Boolean(logic.meta.needsContent);
  const borrowed = BORROWED_PACKS[id];
  const packGame = isPackGame(id) ? id : borrowed?.game;
  const packs = usePacks(useMemo(() => allPacksFor(packGame), [packGame]));
  const packsReady = usePacks((s) => s.hydrated);
  const storedPicks = usePackPicks((s) => (packGame ? s.byGame[packGame] : undefined));
  const setPicks = usePackPicks((s) => s.setPicks);
  const packIds = useMemo(
    () => resolvePicks(storedPicks, packs, locale, packsReady),
    [storedPicks, packs, locale, packsReady],
  );
  const setPackIds = (ids: string[]) => packGame && setPicks(packGame, ids);
  const [sharing, setSharing] = useState<SharePayload | null>(null);
  const spiceLabel = useMemo(
    () => rulesFields(logic.rulesSchema).find((f) => f.key === 'maxSpice')?.label,
    [logic],
  );

  // Rules as stored (possibly mid-edit) — validity is checked on Start.
  const rules = useMemo(() => (raw === undefined ? validRules(id, undefined) : raw), [raw, id]);
  const usesContent = needsContent || Boolean(borrowed?.when(rules));
  const seated = players.filter((p) => !p.sittingOut);
  const { min, max } = logic.meta;
  const enough = seated.length >= min;
  const tooMany = seated.length > max;
  const playable = hasView(id);
  const replacing = session && !session.over;
  const maxSpice = spiceOf(id, rules);
  const prompts = useMemo(
    () =>
      usesContent
        ? collectPrompts(
            packs.filter((p) => packIds.includes(p.id)),
            { maxSpice, game: packGame },
          )
        : [],
    [usesContent, packs, packIds, maxSpice, packGame],
  );
  const noPrompts = needsContent && prompts.length === 0;
  const presets = useRules((s) => s.byGame[id]?.presets);

  /** Shares the current rules (named after the matching preset, if any) as a `kind:'rules'` link. */
  const shareRules = () => {
    const parsed = logic.rulesSchema.safeParse(rules);
    if (!parsed.success) {
      setInvalid(new Set(parsed.error.issues.map((i) => i.path.map(String).join('.'))));
      setError('rulesUi.invalid');
      return;
    }
    const same = presets?.find((p) => JSON.stringify(p.rules) === JSON.stringify(parsed.data));
    setError(null);
    setSharing({
      schema: 1,
      kind: 'rules',
      gameId: id,
      name: same?.name ?? t('rulesUi.shareName', { game: t(`game.${id}.title`) }).slice(0, 60),
      rules: parsed.data,
    });
  };

  const start = () => {
    const parsed = logic.rulesSchema.safeParse(rules);
    if (!parsed.success) {
      setInvalid(new Set(parsed.error.issues.map((i) => i.path.map(String).join('.'))));
      setError('rulesUi.invalid');
      return;
    }
    setInvalid(new Set());
    setRules(id, parsed.data);
    const content =
      needsContent || borrowed?.when(parsed.data)
        ? {
            prompts: collectPrompts(
              packs.filter((p) => packIds.includes(p.id)),
              { maxSpice: spiceOf(id, parsed.data), game: packGame },
            ),
          }
        : undefined;
    if (needsContent && content && content.prompts.length === 0) {
      setError('lobby.packs.none');
      return;
    }
    const err = startGame(id, content);
    if (err) {
      setError(err);
      return;
    }
    navigate('/play');
  };

  return (
    <main className="screen gap-5 pb-32" data-testid="lobby">
      <TopBar title={t(`game.${id}.title`)} back="/games" />
      <p className="-mt-2 text-capiz-300">{t(`game.${id}.desc`)}</p>

      <section className="panel flex flex-col gap-3 p-4" aria-labelledby="lobby-players">
        <div className="flex items-center justify-between">
          <h2 id="lobby-players" className="eyebrow text-capiz-300">
            {t('lobby.players', { count: seated.length })}
          </h2>
          <Link to="/players" className="btn btn-ghost min-h-10 px-2 text-sm text-brass-300">
            {t('lobby.editPlayers')}
          </Link>
        </div>
        {seated.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {seated.map((p) => (
              <li key={p.id} className="chip min-h-9 text-capiz-50">
                {p.name}
                {p.nonAlcoholic && (
                  <span className="text-tubig-300">· {t('players.nonAlcShort')}</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {!enough && (
          <p className="font-bold text-sili-500" role="alert">
            {t('lobby.needPlayers', { count: min })}
          </p>
        )}
        {tooMany && (
          <p className="font-bold text-sili-500" role="alert">
            {t('lobby.tooMany', { count: max })}
          </p>
        )}
      </section>

      {usesContent && (
        <ContentPicker
          packs={packs}
          selected={packIds}
          onSelected={setPackIds}
          maxSpice={maxSpice}
          spiceLabel={spiceLabel}
          onMaxSpice={(level) => setRules(id, { ...(rules as object), maxSpice: level })}
          matchCount={prompts.length}
          manageHref={`/packs?back=${encodeURIComponent(`/games/${id}`)}`}
        />
      )}

      <section aria-labelledby="lobby-rules">
        <h2 id="lobby-rules" className="eyebrow mb-2 text-capiz-300">
          {t('lobby.rules')}
        </h2>
        <div className="felt px-4 py-3">
          <div className="relative z-10">
            <RulesEditor
              gameId={id}
              value={rules}
              onChange={(next) => setRules(id, next)}
              invalid={invalid}
              onShare={shareRules}
            />
          </div>
        </div>
      </section>

      <section className="panel p-4" aria-labelledby="lobby-intensity">
        <h2 id="lobby-intensity" className="eyebrow mb-2 text-capiz-300">
          {t('lobby.intensity')}
        </h2>
        <QuickIntensity />
      </section>

      <ThemeQuickRow />

      <ShareSheet
        open={sharing !== null}
        onClose={() => setSharing(null)}
        payload={sharing}
        title={t('share.rulesTitle')}
      />

      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-narra-950 from-70% to-transparent px-4 pt-10 pb-[calc(env(safe-area-inset-bottom)+14px)]">
        <div className="mx-auto flex max-w-[528px] flex-col gap-2">
          {error && (
            <p className="text-center text-sm font-bold text-sili-500" role="alert">
              {t(error)}
            </p>
          )}
          {!playable && <p className="text-center text-sm text-capiz-300">{t('lobby.noView')}</p>}
          {playable && noPrompts && !error && (
            <p className="text-center text-sm font-bold text-sili-500">{t('lobby.packs.none')}</p>
          )}
          {playable && replacing && (
            <p className="text-center text-sm text-capiz-400">{t('lobby.replaces')}</p>
          )}
          <button
            type="button"
            className="btn btn-brass min-h-16 font-sign text-xl"
            disabled={!enough || tooMany || !playable || noPrompts || (usesContent && !packsReady)}
            onClick={start}
            data-testid="start-game"
          >
            {t('lobby.start')}
          </button>
        </div>
      </div>
    </main>
  );
}

export default function Lobby() {
  const { id } = useParams();
  if (!isGameId(id) || !hasLogic(id)) return <Navigate to="/games" replace />;
  return <LobbyFor key={id} id={id} />;
}
