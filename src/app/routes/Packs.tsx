import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BUILTIN_PACKS, isBilingual } from '@/core/content/builtin';
import { PACK_GAMES, type PackGame, type PromptPack } from '@/core/content/schemas';
import type { SharePayload } from '@/core/share/codec';
import { hasLogic } from '@/core/games/registry';
import {
  exportable,
  MAX_PACK_NAME,
  PACK_FILE_MAX_BYTES,
  parseLines,
  parsePackFile,
  spiceSpread,
  usePacks,
  type PackLocale,
} from '@/store/packs';
import { useSettings } from '@/store/settings';
import { IconCopy, IconPlus, IconShare, IconUpload } from '@/ui/icons';
import { ImportError, ImportPreview } from '@/ui/ImportPreview';
import { CharCount, GamePicker, LocaleBadge, LocalePicker, SpiceSpread } from '@/ui/packBits';
import { safeBack } from '@/ui/share';
import { ShareSheet } from '@/ui/ShareSheet';
import { Sheet } from '@/ui/Sheet';
import { TopBar } from '@/ui/TopBar';

// Stacked-card edge under each pack: it reads as a deck of prompt cards on the table.
const DECK =
  'shadow-[inset_0_1px_0_rgb(255_235_200/0.06),0_4px_0_-1px_var(--color-narra-700),0_8px_0_-3px_var(--color-narra-800),0_16px_26px_-14px_rgb(0_0_0/0.8)]';

interface PackCardProps {
  pack: PromptPack;
  query: string;
  onShare(pack: PromptPack): void;
  onDuplicate(pack: PromptPack): void;
}

const PackCard = memo(function PackCard({ pack, query, onShare, onDuplicate }: PackCardProps) {
  const { t } = useTranslation();
  const spread = useMemo(() => spiceSpread(pack.items), [pack.items]);
  const builtin = pack.builtin === true;
  return (
    <li className="mb-2" data-testid={`pack-card-${pack.id}`} data-builtin={builtin}>
      <div
        className={`panel overflow-hidden border-l-4 ${builtin ? 'border-l-brass-500' : 'border-l-felt-600'} ${DECK}`}
      >
        <Link
          to={`/packs/${pack.id}${query}`}
          className="flex flex-col gap-2.5 px-4 pt-3.5 pb-3 active:bg-narra-700/40"
          data-testid="pack-open"
        >
          <span className="flex items-start gap-2">
            <span className="line-clamp-2 min-w-0 flex-1 text-lg leading-snug font-extrabold text-capiz-50 [overflow-wrap:anywhere]">
              {pack.name}
            </span>
            <LocaleBadge locale={pack.locale} bilingual={isBilingual(pack)} />
          </span>
          <span className="flex items-center gap-3">
            <span className="shrink-0 text-sm font-bold text-capiz-200 tabular-nums">
              {t('packs.count', { count: pack.items.length })}
            </span>
            <SpiceSpread spread={spread} className="flex-1" />
          </span>
        </Link>
        <div className="flex min-h-12 items-center justify-between gap-2 border-t border-white/8 bg-narra-950/30 pl-4">
          <span
            className={`text-xs font-bold tracking-[0.12em] uppercase ${
              builtin
                ? 'text-brass-400'
                : 'rounded-md border border-felt-600 bg-felt-700 px-2 py-0.5 text-capiz-50'
            }`}
          >
            {builtin ? t('packs.builtinTag') : t('packs.customTag')}
          </span>
          {builtin ? (
            <button
              type="button"
              className="btn btn-ghost min-h-12 rounded-none px-4 text-[0.95rem] text-brass-300"
              onClick={() => onDuplicate(pack)}
              data-testid="pack-duplicate"
            >
              <IconCopy size={18} />
              {t('packs.duplicate')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost min-h-12 rounded-none px-4 text-[0.95rem] text-brass-300"
              onClick={() => onShare(pack)}
              data-testid="pack-share"
            >
              <IconShare size={18} />
              {t('packs.share')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
});

function NewPackSheet({
  open,
  onClose,
  initialGame,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  initialGame: PackGame;
  onCreated(id: string): void;
}) {
  const { t } = useTranslation();
  const uiLocale = useSettings((s) => s.locale);
  const create = usePacks((s) => s.create);
  const hydrated = usePacks((s) => s.hydrated);
  const [name, setName] = useState('');
  const [game, setGame] = useState<PackGame>(initialGame);
  const [locale, setLocale] = useState<PackLocale>(uiLocale);
  const [lines, setLines] = useState('');
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseLines(lines), [lines]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed.tooLong.length) return setError('packs.error.lineTooLong');
    const res = create({ name, game, locale, items: parsed.lines.map((text) => ({ text })) });
    if (!res.ok) return setError(res.error);
    onCreated(res.value);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('packs.newTitle')} testId="new-pack-sheet">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-bold text-capiz-50">{t('packs.name')}</span>
            <CharCount n={name.trim().length} max={MAX_PACK_NAME} />
          </span>
          <input
            className="field"
            value={name}
            maxLength={MAX_PACK_NAME}
            placeholder={t('packs.namePlaceholder')}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            data-testid="new-pack-name"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="font-bold text-capiz-50">{t('packs.game')}</span>
          <GamePicker value={game} onChange={setGame} testId="new-pack-game" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-bold text-capiz-50">{t('packs.locale')}</span>
          <LocalePicker value={locale} onChange={setLocale} testId="new-pack-locale" />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-bold text-capiz-50">{t('packs.firstPrompts')}</span>
            <span className="text-xs font-bold text-capiz-400">
              {t('packs.lineCount', { count: parsed.lines.length })}
            </span>
          </span>
          <span className="text-sm text-capiz-400">{t('packs.firstPromptsHelp')}</span>
          <textarea
            className="field min-h-36 py-3 leading-snug"
            rows={5}
            value={lines}
            placeholder={t(`packs.linesPlaceholder.${game}`)}
            onChange={(e) => {
              setLines(e.target.value);
              setError(null);
            }}
            data-testid="new-pack-lines"
          />
        </label>
        {error && (
          <p className="font-bold text-sili-500" role="alert">
            {t(error, { count: parsed.tooLong.length, max: 280 })}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-brass min-h-14 font-sign text-lg"
          disabled={!hydrated}
          data-testid="new-pack-create"
        >
          {t('packs.create')}
        </button>
      </form>
    </Sheet>
  );
}

type FileImport = { ok: true; pack: PromptPack } | { ok: false; error: string };

export default function Packs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const backParam = params.get('back');
  const back = safeBack(backParam, '/');
  const query = backParam && back === backParam ? `?back=${encodeURIComponent(back)}` : '';
  const custom = usePacks((s) => s.packs);
  const hydrated = usePacks((s) => s.hydrated);
  const duplicate = usePacks((s) => s.duplicate);
  const [creating, setCreating] = useState<PackGame | null>(null);
  const [sharing, setSharing] = useState<PromptPack | null>(null);
  const [fileImport, setFileImport] = useState<FileImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(
    () =>
      PACK_GAMES.map((game) => ({
        game,
        packs: [
          ...custom.filter((p) => p.game === game),
          ...BUILTIN_PACKS.filter((p) => p.game === game),
        ],
      })),
    [custom],
  );
  const sharePayload = useMemo<SharePayload | null>(
    () => (sharing ? exportable(sharing) : null),
    [sharing],
  );

  const onDuplicate = useCallback(
    (pack: PromptPack) => {
      const res = duplicate(pack.id, t('packs.copyName', { name: pack.name }));
      if (res.ok) navigate(`/packs/${res.value}${query}`);
      else setError(res.error);
    },
    [duplicate, navigate, query, t],
  );

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > PACK_FILE_MAX_BYTES)
      return setFileImport({ ok: false, error: 'share.tooLarge' });
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setFileImport({ ok: false, error: 'share.corrupt' });
    }
    const res = parsePackFile(text);
    setFileImport(res.ok ? { ok: true, pack: res.value } : { ok: false, error: res.error });
  };

  return (
    <main className="screen gap-4" data-testid="packs">
      <TopBar title={t('packs.title')} back={back} />
      <p className="-mt-2 text-capiz-300">{t('packs.intro')}</p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-brass min-h-14 justify-between text-lg"
          onClick={() => setCreating('never-have-i-ever')}
          disabled={!hydrated}
          data-testid="new-pack"
        >
          <span className="font-sign text-[1.1rem]">{t('packs.new')}</span>
          <IconPlus />
        </button>
        <label className="btn btn-wood cursor-pointer justify-between has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brass-300">
          <span>{t('packs.importFile')}</span>
          <IconUpload className="text-capiz-300" />
          <input
            ref={fileRef}
            type="file"
            accept=".json,.dgpack.json,application/json"
            className="sr-only"
            onChange={(e) => void onFile(e)}
            data-testid="import-file"
          />
        </label>
      </div>
      {error && (
        <p className="font-bold text-sili-500" role="alert">
          {t(error)}
        </p>
      )}

      {hydrated && custom.length === 0 && (
        <div className="felt flex flex-col gap-1 px-5 py-5" data-testid="packs-empty">
          <p className="relative z-10 font-bold text-capiz-50">{t('packs.emptyTitle')}</p>
          <p className="relative z-10 text-sm text-capiz-300">{t('packs.emptyBody')}</p>
        </div>
      )}

      {groups.map(({ game, packs }) => (
        <section key={game} aria-labelledby={`packs-${game}`} data-testid={`packs-group-${game}`}>
          <h2 id={`packs-${game}`} className="mb-2.5 flex items-center gap-2">
            <span aria-hidden className="text-lg text-brass-400">
              ❝
            </span>
            <span className="eyebrow text-capiz-300">{t(`game.${game}.title`)}</span>
            {!hasLogic(game) && (
              <span className="rounded border border-capiz-400/50 px-1.5 font-sign text-[0.6rem] text-capiz-400">
                {t('games.soon')}
              </span>
            )}
            <span className="h-px flex-1 bg-narra-600" aria-hidden />
          </h2>
          {packs.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {packs.map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  query={query}
                  onShare={setSharing}
                  onDuplicate={onDuplicate}
                />
              ))}
            </ul>
          ) : (
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[14px] border border-dashed border-narra-500 px-4 text-left text-capiz-300 active:bg-narra-800"
              onClick={() => setCreating(game)}
              disabled={!hydrated}
            >
              <span>{t('packs.noneForGame')}</span>
              <IconPlus className="shrink-0 text-brass-400" />
            </button>
          )}
        </section>
      ))}

      {creating && (
        <NewPackSheet
          open
          initialGame={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => navigate(`/packs/${id}${query}`)}
        />
      )}

      <ShareSheet
        open={sharing !== null}
        onClose={() => setSharing(null)}
        payload={sharePayload}
        pack={sharing ?? undefined}
        title={t('share.packTitle')}
      />

      <Sheet
        open={fileImport !== null}
        onClose={() => setFileImport(null)}
        title={t('import.fileTitle')}
        testId="file-import-sheet"
      >
        {fileImport?.ok ? (
          <ImportPreview
            payload={fileImport.pack}
            onCancel={() => setFileImport(null)}
            onBackToPacks={() => setFileImport(null)}
          />
        ) : fileImport ? (
          <ImportError error={fileImport.error} />
        ) : null}
      </Sheet>
    </main>
  );
}
