import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { isBilingual } from '@/core/content/builtin';
import type { PackGame, PromptItem, PromptPack } from '@/core/content/schemas';
import type { SharePayload } from '@/core/share/codec';
import {
  exportable,
  findPack,
  MAX_ITEMS,
  MAX_PACK_NAME,
  MAX_TEXT,
  nameError,
  parseLines,
  spiceSpread,
  textError,
  unknownPlaceholders,
  usePacks,
  type ItemDraft,
  type ItemKind,
  type PackLocale,
} from '@/store/packs';
import { insertAtCaret } from '@/ui/caret';
import { Stepper } from '@/ui/controls';
import {
  IconCheck,
  IconCopy,
  IconDown,
  IconDownload,
  IconLines,
  IconPencil,
  IconPlus,
  IconShare,
  IconTrash,
  IconUp,
} from '@/ui/icons';
import {
  CharCount,
  GamePicker,
  KindPicker,
  KindTag,
  LocaleBadge,
  LocalePicker,
  PlaceholderChips,
  PromptText,
  SpiceDots,
  SpicePicker,
  SpiceSpread,
} from '@/ui/packBits';
import { useSettings } from '@/store/settings';
import { safeBack, savePackFile } from '@/ui/share';
import { ShareSheet } from '@/ui/ShareSheet';
import { Sheet } from '@/ui/Sheet';
import { TopBar } from '@/ui/TopBar';
import { feedback } from '@/audio/feedback';

const COMMIT_MS = 450;
/** Rows rendered per "show more" step: keeps the DOM small on budget phones, even at 1000 prompts. */
const PAGE = 100;

/**
 * Local text for an input that writes to the store only when valid: debounced while typing,
 * immediately on blur, and on unmount. Keystrokes re-render just the input's owner.
 */
function useDraft(value: string, commit: (next: string) => void, isValid: (s: string) => boolean) {
  const [draft, setDraft] = useState(value);
  const latest = useRef({ draft, value, commit, isValid });
  useEffect(() => {
    latest.current = { draft, value, commit, isValid };
  });
  const flush = useCallback(() => {
    const cur = latest.current;
    if (cur.draft.trim() !== cur.value && cur.isValid(cur.draft)) cur.commit(cur.draft);
  }, []);
  useEffect(() => {
    if (draft.trim() === value) return;
    const id = setTimeout(flush, COMMIT_MS);
    return () => clearTimeout(id);
  }, [draft, value, flush]);
  useEffect(() => flush, [flush]);
  return [draft, setDraft, flush] as const;
}

/** Textareas grow with their content where `field-sizing` is supported. */
const AUTOGROW = '[field-sizing:content]';

function useInsert(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  set: (v: string) => void,
) {
  return (token: string) => {
    const res = insertAtCaret(ref.current, value, token, MAX_TEXT);
    if (!res) return;
    set(res.next);
    requestAnimationFrame(() => ref.current?.setSelectionRange(res.caret, res.caret));
  };
}

// ── meta ─────────────────────────────────────────────────────────────────────

const MetaPanel = memo(function MetaPanel({
  id,
  name,
  game,
  locale,
}: {
  id: string;
  name: string;
  game: PackGame;
  locale: PackLocale;
}) {
  const { t } = useTranslation();
  const update = usePacks((s) => s.update);
  const commit = useCallback((v: string) => void update(id, { name: v }), [id, update]);
  const [draft, setDraft, flush] = useDraft(name, commit, (s) => !nameError(s));
  const err = nameError(draft);
  return (
    <section className="panel flex flex-col gap-4 p-4" aria-label={t('packs.details')}>
      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-bold text-capiz-50">{t('packs.name')}</span>
          <CharCount n={draft.trim().length} max={MAX_PACK_NAME} />
        </span>
        <input
          className={`field ${err ? 'border-sili-500' : ''}`}
          value={draft}
          maxLength={MAX_PACK_NAME}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={flush}
          aria-invalid={Boolean(err)}
          data-testid="pack-name"
        />
        {err && <span className="text-sm font-bold text-sili-500">{t(err)}</span>}
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="font-bold text-capiz-50">{t('packs.game')}</span>
        <GamePicker value={game} onChange={(g) => update(id, { game: g })} testId="pack-game" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-bold text-capiz-50">{t('packs.locale')}</span>
        <LocalePicker value={locale} onChange={(l) => update(id, { locale: l })} />
        <span className="text-sm text-capiz-400">{t('packs.localeHelp')}</span>
      </div>
    </section>
  );
});

// ── composer & bulk add ──────────────────────────────────────────────────────

const Composer = memo(function Composer({
  packId,
  game,
  onBulk,
  onAdded,
}: {
  packId: string;
  game: PackGame;
  onBulk(): void;
  onAdded(count: number): void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [spice, setSpice] = useState(1);
  const [kind, setKind] = useState<ItemKind>('truth');
  const [error, setError] = useState<string | null>(null);
  const tod = game === 'truth-or-dare';
  const insert = useInsert(ref, text, setText);
  const unknown = useMemo(() => unknownPlaceholders(text), [text]);

  const add = () => {
    const err =
      textError(text) ??
      usePacks.getState().addItems(packId, [{ text, spice, kind: tod ? kind : undefined }]);
    setError(err);
    if (err) return;
    setText('');
    onAdded(1);
    ref.current?.focus();
  };

  return (
    <section className="felt flex flex-col gap-3 p-4" aria-labelledby="composer-title">
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="composer-title" className="font-sign text-lg text-brass-300">
            {t('packs.addTitle')}
          </h2>
          <CharCount n={text.trim().length} max={MAX_TEXT} />
        </div>
        <textarea
          ref={ref}
          className={`field min-h-24 py-3 leading-snug ${AUTOGROW}`}
          rows={3}
          value={text}
          maxLength={MAX_TEXT}
          enterKeyHint="done"
          placeholder={t(`packs.composerPlaceholder.${game}`)}
          aria-label={t('packs.addTitle')}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          data-testid="composer-text"
        />
        <PlaceholderChips onInsert={insert} textareaRef={ref} />
        {unknown.length > 0 && (
          <p className="text-sm font-bold text-brass-300">
            {t('packs.unknownPlaceholder', { list: unknown.join(' ') })}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-capiz-200">{t('packs.spiceLabel')}</span>
          <SpicePicker value={spice} onChange={setSpice} testId="composer-spice" />
        </div>
        {tod && <KindPicker value={kind} onChange={setKind} />}
        {error && (
          <p className="font-bold text-sili-500" role="alert">
            {t(error, { max: MAX_ITEMS })}
          </p>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button type="button" className="btn btn-brass" onClick={add} data-testid="composer-add">
            <IconPlus />
            {t('packs.add')}
          </button>
          <button
            type="button"
            className="btn btn-wood px-3.5"
            onClick={onBulk}
            data-testid="bulk-open"
          >
            <IconLines />
            {t('packs.bulk')}
          </button>
        </div>
      </div>
    </section>
  );
});

function BulkSheet({
  open,
  onClose,
  packId,
  game,
  onAdded,
}: {
  open: boolean;
  onClose(): void;
  packId: string;
  game: PackGame;
  onAdded(count: number): void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [spice, setSpice] = useState(1);
  const [kind, setKind] = useState<ItemKind>('truth');
  const [msg, setMsg] = useState<{ key: string; params?: Record<string, number> } | null>(null);
  const parsed = useMemo(() => parseLines(text), [text]);
  const tod = game === 'truth-or-dare';

  const add = () => {
    if (!parsed.lines.length) return setMsg({ key: 'packs.error.noLines' });
    const n = parsed.lines.length;
    const err = usePacks.getState().addItems(
      packId,
      parsed.lines.map((line) => ({ text: line, spice, kind: tod ? kind : undefined })),
    );
    if (err) {
      feedback('error');
      return setMsg({ key: err, params: { max: MAX_ITEMS } });
    }
    feedback('success');
    onAdded(n);
    if (parsed.tooLong.length) {
      // Keep the lines that didn't fit so they can be shortened, instead of dropping them.
      setText(parsed.tooLong.join('\n'));
      setMsg({ key: 'packs.bulkPartial', params: { added: n, count: parsed.tooLong.length } });
    } else {
      setText('');
      setMsg(null);
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('packs.bulkTitle')} testId="bulk-sheet">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-capiz-300">{t('packs.bulkHelp')}</p>
        <textarea
          className="field min-h-48 py-3 leading-snug"
          rows={8}
          value={text}
          autoFocus
          placeholder={t(`packs.linesPlaceholder.${game}`)}
          aria-label={t('packs.bulkTitle')}
          onChange={(e) => {
            setText(e.target.value);
            setMsg(null);
          }}
          data-testid="bulk-text"
        />
        <p className="flex flex-wrap gap-x-3 text-sm font-bold" aria-live="polite">
          <span className="text-capiz-200">
            {t('packs.lineCount', { count: parsed.lines.length })}
          </span>
          {parsed.tooLong.length > 0 && (
            <span className="text-sili-500">
              {t('packs.tooLongCount', { count: parsed.tooLong.length, max: MAX_TEXT })}
            </span>
          )}
        </p>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-capiz-200">{t('packs.bulkSpice')}</span>
          <SpicePicker value={spice} onChange={setSpice} />
        </div>
        {tod && <KindPicker value={kind} onChange={setKind} />}
        {msg && (
          <p
            className={`font-bold ${msg.key === 'packs.bulkPartial' ? 'text-brass-300' : 'text-sili-500'}`}
            role="alert"
          >
            {t(msg.key, msg.params)}
          </p>
        )}
        <button
          type="button"
          className="btn btn-brass min-h-14"
          onClick={add}
          disabled={parsed.lines.length === 0}
          data-testid="bulk-add"
        >
          <IconPlus />
          {t('packs.bulkAdd', { count: parsed.lines.length })}
        </button>
      </div>
    </Sheet>
  );
}

// ── items ────────────────────────────────────────────────────────────────────

function ItemEditor({
  packId,
  item,
  tod,
  isFirst,
  isLast,
  onClose,
}: {
  packId: string;
  item: PromptItem;
  tod: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const store = usePacks.getState;
  const commit = useCallback(
    (text: string) => setError(usePacks.getState().updateItem(packId, item.id, { text })),
    [packId, item.id],
  );
  const [draft, setDraft, flush] = useDraft(item.text, commit, (s) => !textError(s));
  const insert = useInsert(ref, draft, setDraft);
  const textErr = textError(draft);
  const unknown = useMemo(() => unknownPlaceholders(draft), [draft]);
  const patch = (p: Partial<ItemDraft>) => setError(store().updateItem(packId, item.id, p));

  return (
    <div className="panel flex flex-col gap-3 border-brass-500 p-3" data-testid="item-editor">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow text-brass-300">{t('packs.editing')}</span>
        <CharCount n={draft.trim().length} max={MAX_TEXT} />
      </div>
      <textarea
        ref={ref}
        className={`field min-h-24 py-3 leading-snug ${AUTOGROW} ${textErr ? 'border-sili-500' : ''}`}
        rows={3}
        autoFocus
        value={draft}
        maxLength={MAX_TEXT}
        aria-label={t('packs.itemText')}
        aria-invalid={Boolean(textErr)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        data-testid="item-text"
      />
      {textErr && <p className="text-sm font-bold text-sili-500">{t(textErr)}</p>}
      {unknown.length > 0 && (
        <p className="text-sm font-bold text-brass-300">
          {t('packs.unknownPlaceholder', { list: unknown.join(' ') })}
        </p>
      )}
      <PlaceholderChips onInsert={insert} textareaRef={ref} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold text-capiz-200">{t('packs.spiceLabel')}</span>
        <SpicePicker value={item.spice} onChange={(spice) => patch({ spice })} />
      </div>
      {tod && <KindPicker value={item.kind ?? 'prompt'} onChange={(kind) => patch({ kind })} />}
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-bold text-capiz-200">{t('packs.sips')}</span>
          <span className="text-xs text-capiz-400">{t('packs.sipsHelp')}</span>
        </span>
        <Stepper
          label={t('packs.sips')}
          value={item.sips ?? -1}
          min={-1}
          max={5}
          format={(v) => (v < 0 ? t('packs.sipsDefault') : String(v))}
          onChange={(v) => patch({ sips: v < 0 ? null : v })}
        />
      </div>
      {error && error !== textErr && (
        <p className="text-sm font-bold text-sili-500" role="alert">
          {t(error)}
        </p>
      )}
      <div className="flex items-center gap-2 border-t border-white/8 pt-3">
        <button
          type="button"
          className="icon-btn"
          disabled={isFirst}
          aria-label={t('packs.moveUp')}
          onClick={() => store().moveItem(packId, item.id, -1)}
        >
          <IconUp />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled={isLast}
          aria-label={t('packs.moveDown')}
          onClick={() => store().moveItem(packId, item.id, 1)}
        >
          <IconDown />
        </button>
        <button
          type="button"
          className="icon-btn text-sili-500"
          aria-label={t('packs.deleteItem')}
          onClick={() => setError(store().removeItem(packId, item.id))}
          data-testid="item-delete"
        >
          <IconTrash />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-wood min-h-12 px-4"
          onClick={() => {
            flush();
            onClose();
          }}
          data-testid="item-done"
        >
          <IconCheck />
          {t('packs.done')}
        </button>
      </div>
    </div>
  );
}

interface ItemRowProps {
  packId: string;
  item: PromptItem;
  index: number;
  tod: boolean;
  readOnly: boolean;
  open: boolean;
  isLast: boolean;
  onOpen(id: string | null): void;
}

/** Collapsed rows are cheap (no textarea) and skip layout off-screen; one row edits at a time. */
const ItemRow = memo(function ItemRow({
  packId,
  item,
  index,
  tod,
  readOnly,
  open,
  isLast,
  onOpen,
}: ItemRowProps) {
  const { t } = useTranslation();
  const locale = useSettings((s) => s.locale);
  // A built-in (bilingual) pack reads in the app language; editable packs show the text you edit.
  const shown = readOnly ? (item.alt?.[locale] ?? item.text) : item.text;
  if (open && !readOnly) {
    return (
      <li className="scroll-mt-24" data-testid="item-row" data-open="true">
        <ItemEditor
          packId={packId}
          item={item}
          tod={tod}
          isFirst={index === 0}
          isLast={isLast}
          onClose={() => onOpen(null)}
        />
      </li>
    );
  }
  const body = (
    <>
      <span className="w-6 shrink-0 pt-0.5 font-sign text-xs text-brass-500 tabular-nums">
        {index + 1}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="leading-snug text-capiz-50 [overflow-wrap:anywhere]">
          <PromptText text={shown} />
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <SpiceDots level={item.spice} size="sm" />
          {tod && <KindTag kind={item.kind} />}
          {item.sips !== undefined && (
            <span className="text-xs font-bold text-tubig-300">
              {t('packs.sipsTag', { count: item.sips })}
            </span>
          )}
        </span>
      </span>
    </>
  );
  return (
    <li
      className="[contain-intrinsic-size:auto_76px] [content-visibility:auto]"
      data-testid="item-row"
    >
      {readOnly ? (
        <div className="flex gap-3 rounded-xl border border-white/8 bg-narra-950/40 px-3 py-3">
          {body}
        </div>
      ) : (
        <button
          type="button"
          className="flex min-h-14 w-full gap-3 rounded-xl border border-white/8 bg-narra-950/40 px-3 py-3 text-left active:bg-narra-800"
          onClick={() => onOpen(item.id)}
          aria-label={t('packs.editItem', { n: index + 1 })}
        >
          {body}
          <IconPencil className="mt-0.5 shrink-0 text-capiz-400" size={18} />
        </button>
      )}
    </li>
  );
});

// ── screen ───────────────────────────────────────────────────────────────────

function EditorFor({ pack, query }: { pack: PromptPack; query: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const readOnly = pack.builtin === true;
  const tod = pack.game === 'truth-or-dare';
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ key: string; n: number; at: number } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const visible = pack.items.length > shown ? pack.items.slice(0, shown) : pack.items;
  const hidden = pack.items.length - visible.length;
  const [error, setError] = useState<string | null>(null);
  const spread = useMemo(() => spiceSpread(pack.items), [pack.items]);
  const payload = useMemo<SharePayload | null>(
    () => (sharing ? exportable(pack) : null),
    [sharing, pack],
  );

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 1600);
    return () => clearTimeout(id);
  }, [notice]);

  const onAdded = useCallback(
    (n: number) => setNotice({ key: 'packs.added', n, at: Date.now() }),
    [],
  );
  const openBulk = useCallback(() => setBulk(true), []);

  const duplicate = () => {
    const res = usePacks.getState().duplicate(pack.id, t('packs.copyName', { name: pack.name }));
    if (res.ok) navigate(`/packs/${res.value}${query}`);
    else setError(res.error);
  };
  const download = async () => {
    const res = await savePackFile(pack, pack.name);
    if (res === 'downloaded') {
      feedback('success');
      setNotice({ key: 'share.downloaded', n: 0, at: Date.now() });
    }
  };
  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true);
    usePacks.getState().remove(pack.id);
    navigate(`/packs${query}`, { replace: true });
  };

  return (
    <main className="screen gap-4 pb-10" data-testid="pack-editor" data-readonly={readOnly}>
      <TopBar
        title={readOnly ? t('packs.viewTitle') : t('packs.editTitle')}
        back={`/packs${query}`}
        right={
          !readOnly && (
            <button
              type="button"
              className="icon-btn text-brass-300"
              aria-label={t('packs.share')}
              onClick={() => setSharing(true)}
              data-testid="share-pack"
            >
              <IconShare />
            </button>
          )
        }
      />

      {readOnly ? (
        <section className="felt flex flex-col gap-3 p-4" data-testid="builtin-banner">
          <div className="relative z-10 flex flex-col gap-1">
            <h2 className="text-xl leading-snug font-extrabold text-capiz-50 [overflow-wrap:anywhere]">
              {pack.name}
            </h2>
            <span className="flex flex-wrap items-center gap-2">
              <span className="chip">{t(`game.${pack.game}.title`)}</span>
              <LocaleBadge locale={pack.locale} bilingual={isBilingual(pack)} />
            </span>
          </div>
          <p className="relative z-10 text-sm text-capiz-200">{t('packs.readOnly')}</p>
          <button
            type="button"
            className="btn btn-brass relative z-10"
            onClick={duplicate}
            data-testid="duplicate-pack"
          >
            <IconCopy />
            {t('packs.duplicate')}
          </button>
        </section>
      ) : (
        <MetaPanel id={pack.id} name={pack.name} game={pack.game} locale={pack.locale} />
      )}

      {!readOnly && (
        <Composer packId={pack.id} game={pack.game} onBulk={openBulk} onAdded={onAdded} />
      )}

      <section aria-labelledby="items-title" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="items-title" className="eyebrow text-capiz-300">
            {t('packs.items')}
          </h2>
          <span className="chip" data-testid="item-count">
            {t('packs.count', { count: pack.items.length })}
          </span>
        </div>
        <SpiceSpread spread={spread} legend />
        <ol className="flex flex-col gap-1.5" data-testid="item-list">
          {visible.map((item, i) => (
            <ItemRow
              key={item.id}
              packId={pack.id}
              item={item}
              index={i}
              tod={tod}
              readOnly={readOnly}
              open={openId === item.id}
              isLast={i === pack.items.length - 1}
              onOpen={setOpenId}
            />
          ))}
        </ol>
        {hidden > 0 && (
          <button
            type="button"
            className="btn btn-wood"
            onClick={() => setShown((n) => n + PAGE)}
            data-testid="items-more"
          >
            {t('packs.showMore', { count: Math.min(PAGE, hidden), rest: hidden })}
          </button>
        )}
      </section>

      {!readOnly && (
        <section className="panel flex flex-col gap-2 p-4" aria-label={t('packs.actions')}>
          <button type="button" className="btn btn-brass min-h-14" onClick={() => setSharing(true)}>
            <IconShare />
            {t('share.toGc')}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-wood px-2 text-[0.95rem]"
              onClick={() => void download()}
              data-testid="download-pack"
            >
              <IconDownload size={20} />
              {t('packs.download')}
            </button>
            <button
              type="button"
              className="btn btn-wood px-2 text-[0.95rem]"
              onClick={duplicate}
              data-testid="duplicate-pack"
            >
              <IconCopy size={20} />
              {t('packs.duplicateShort')}
            </button>
          </div>
          <button
            type="button"
            className={`btn ${confirmDelete ? 'btn-sili' : 'btn-ghost text-sili-500'}`}
            onClick={remove}
            onBlur={() => setConfirmDelete(false)}
            data-testid="delete-pack"
          >
            <IconTrash />
            {confirmDelete ? t('packs.deleteConfirm') : t('packs.delete')}
          </button>
        </section>
      )}

      {(notice || error) && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+18px)] z-30 flex justify-center px-4">
          <p
            key={notice?.at}
            className={`anim-pour rounded-full border px-4 py-2 font-bold shadow-lg ${
              error
                ? 'border-sili-500 bg-narra-900 text-sili-500'
                : 'border-brass-500 bg-narra-900 text-brass-200'
            }`}
            role="status"
            data-testid="editor-notice"
          >
            {error ? t(error) : notice ? t(notice.key, { count: notice.n }) : ''}
          </p>
        </div>
      )}

      {!readOnly && (
        <>
          <BulkSheet
            open={bulk}
            onClose={() => setBulk(false)}
            packId={pack.id}
            game={pack.game}
            onAdded={onAdded}
          />
          <ShareSheet
            open={sharing}
            onClose={() => setSharing(false)}
            payload={payload}
            pack={pack}
            title={t('share.packTitle')}
          />
        </>
      )}
    </main>
  );
}

export default function PackEditor() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const backParam = params.get('back');
  const query =
    backParam && safeBack(backParam, '') === backParam
      ? `?back=${encodeURIComponent(backParam)}`
      : '';
  const hydrated = usePacks((s) => s.hydrated);
  const pack = usePacks((s) => findPack(s.packs, id));

  if (!pack && !hydrated) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <span className="size-10 animate-spin rounded-full border-4 border-narra-600 border-t-brass-400" />
      </div>
    );
  }
  if (!pack) {
    return (
      <main className="screen gap-4" data-testid="pack-missing">
        <TopBar title={t('packs.title')} back={`/packs${query}`} />
        <section className="felt flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="relative z-10 text-lg font-bold text-capiz-50">{t('packs.missing')}</p>
          <Link to={`/packs${query}`} className="btn btn-wood relative z-10">
            {t('import.toPacks')}
          </Link>
        </section>
      </main>
    );
  }
  return <EditorFor key={pack.id} pack={pack} query={query} />;
}
