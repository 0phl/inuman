import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { BUILTIN_PACKS, collectPrompts } from '@/core/content/builtin';
import { PACK_GAMES, type Locale, type PackGame, type PromptPack } from '@/core/content/schemas';
import type { GameId } from '@/core/engine/types';
import { getLogic, hasLogic } from '@/core/games/registry';
import { isGameId } from '@/games/catalog';
import { hasView } from '@/games/views';
import { usePlayers } from '@/store/players';
import { defaultRules, useRules, validRules } from '@/store/rules';
import { useSession } from '@/store/session';
import { useSettings } from '@/store/settings';
import { ContentPicker } from '@/ui/ContentPicker';
import { Segmented, Toggle } from '@/ui/controls';
import { RulesEditor } from '@/ui/RulesEditor';
import { rulesFields } from '@/ui/rulesForm';
import { TopBar } from '@/ui/TopBar';

const MULTIPLIERS = [0.5, 1, 1.5, 2] as const;

const isPackGame = (id: GameId): id is PackGame => (PACK_GAMES as readonly string[]).includes(id);

/** Built-in packs that match the UI language (or are language-neutral); all of them if none do. */
function defaultPackIds(packs: readonly PromptPack[], locale: Locale): string[] {
  const local = packs.filter((p) => p.locale === locale || p.locale === 'any');
  return (local.length ? local : packs).map((p) => p.id);
}

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

  // Prompt games: which built-in packs to deal from (default: the UI language's pack).
  const locale = useSettings((s) => s.locale);
  const needsContent = Boolean(logic.meta.needsContent);
  const packGame = isPackGame(id) ? id : undefined;
  const packs = useMemo(
    () => (packGame ? BUILTIN_PACKS.filter((p) => p.game === packGame) : []),
    [packGame],
  );
  const [packIds, setPackIds] = useState<string[]>(() => defaultPackIds(packs, locale));
  const spiceLabel = useMemo(
    () => rulesFields(logic.rulesSchema).find((f) => f.key === 'maxSpice')?.label,
    [logic],
  );

  // Rules as stored (possibly mid-edit) — validity is checked on Start.
  const rules = useMemo(() => (raw === undefined ? validRules(id, undefined) : raw), [raw, id]);
  const seated = players.filter((p) => !p.sittingOut);
  const { min, max } = logic.meta;
  const enough = seated.length >= min;
  const tooMany = seated.length > max;
  const playable = hasView(id);
  const replacing = session && !session.over;
  const maxSpice = spiceOf(id, rules);
  const prompts = useMemo(
    () =>
      needsContent
        ? collectPrompts(
            packs.filter((p) => packIds.includes(p.id)),
            { maxSpice, game: packGame },
          )
        : [],
    [needsContent, packs, packIds, maxSpice, packGame],
  );
  const noPrompts = needsContent && prompts.length === 0;

  const start = () => {
    const parsed = logic.rulesSchema.safeParse(rules);
    if (!parsed.success) {
      setInvalid(new Set(parsed.error.issues.map((i) => i.path.map(String).join('.'))));
      setError('rulesUi.invalid');
      return;
    }
    setInvalid(new Set());
    setRules(id, parsed.data);
    const content = needsContent
      ? {
          prompts: collectPrompts(
            packs.filter((p) => packIds.includes(p.id)),
            { maxSpice: spiceOf(id, parsed.data), game: packGame },
          ),
        }
      : undefined;
    if (content && content.prompts.length === 0) {
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

      {needsContent && (
        <ContentPicker
          packs={packs}
          selected={packIds}
          onSelected={setPackIds}
          maxSpice={maxSpice}
          spiceLabel={spiceLabel}
          onMaxSpice={(level) => setRules(id, { ...(rules as object), maxSpice: level })}
          matchCount={prompts.length}
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
            disabled={!enough || tooMany || !playable || noPrompts}
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
