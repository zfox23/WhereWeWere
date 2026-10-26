/**
 * Rank a list by answering "A or B?": the "Rank by comparing" tool every ranked
 * list shares. A plugin supplies its list API and how an item looks. The engine (ranking/engine.ts) chooses each pair and knows
 * when the order is settled; this is the screen around it: choose how to
 * start, the duel, and a preview of the new order before anything is changed.
 *
 * Progress is saved after every answer, so leaving (or closing the page)
 * pauses the session and it can be resumed later.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Loader2, Minus, Undo2 } from 'lucide-react';
import {
  newSession, nextPair, orderOf, progress, reconcile, replay,
  type Choice, type RankSessionState, type StartMode,
} from './ranking/engine';

type Phase = 'loading' | 'choose' | 'duel' | 'preview';

const BTN = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40';
const SECONDARY = `${BTN} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700`;
const PRIMARY = `${BTN} bg-primary-600 text-white hover:bg-primary-700`;

/** How an item looks in a duel card: optional artwork on top, a badge by the A/B label, and the text. */
export interface Contender {
  media?: ReactNode;
  badge?: ReactNode;
  body: ReactNode;
}

/** The slice of a plugin's list API the tool needs. */
export interface RankByComparingApi {
  rankSession: (listId: string) => Promise<{ state: RankSessionState }>;
  saveRankSession: (listId: string, state: RankSessionState) => Promise<unknown>;
  discardRankSession: (listId: string) => Promise<unknown>;
  rankList: (listId: string, rankedIds: string[]) => Promise<unknown>;
}

function ContenderCard({
  label, text, shortcut, contender, onPick,
}: { label: 'A' | 'B'; text: string; shortcut: string; contender: Contender; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Prefer ${text}`}
      className="group flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border-2 border-gray-200 bg-white text-left shadow-sm transition hover:border-pink-400 hover:shadow-md focus-visible:border-pink-500 focus-visible:outline-none dark:border-gray-700 dark:bg-gray-900"
    >
      {contender.media}
      <div className="p-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded bg-pink-500 px-1.5 text-xs font-bold text-white">{label}</span>
          {contender.badge}
          <span className="ml-auto hidden text-xs text-gray-400 sm:inline">{shortcut}</span>
        </div>
        {contender.body}
      </div>
    </button>
  );
}

export function RankByComparing<T>({
  list,
  items,
  api,
  getId,
  getRank,
  getLabel,
  getSubtitle,
  renderContender,
  onDone,
}: {
  list: { id: string; name: string };
  items: T[];
  api: RankByComparingApi;
  getId: (item: T) => string;
  getRank: (item: T) => number | null;
  /** The item's name, for the preview and the buttons' labels. */
  getLabel: (item: T) => string;
  /** Muted text after the name in the preview (an artist, a date...). */
  getSubtitle?: (item: T) => string;
  renderContender: (item: T) => Contender;
  /** Leave the tool; `applied` says whether the list's ranks were changed. */
  onDone: (applied: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [saved, setSaved] = useState<RankSessionState | null>(null);
  const [session, setSession] = useState<RankSessionState | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [getId(i), i])), [items]);
  const asItems = useMemo(() => items.map((i) => ({ id: getId(i), rank: getRank(i) })), [items]);
  const anyRanked = items.some((i) => getRank(i) !== null);

  const persist = useCallback(
    (state: RankSessionState) => {
      api.saveRankSession(list.id, state).then(() => setSaveFailed(false)).catch(() => setSaveFailed(true));
    },
    [list.id],
  );

  const begin = useCallback(
    (state: RankSessionState) => {
      setSession(state);
      setPhase(progress(state).done && state.answers.length > 0 ? 'preview' : 'duel');
      persist(state);
    },
    [persist],
  );

  const start = (mode: StartMode) => begin(newSession(asItems, mode));

  // Look for a paused session; otherwise offer how to start.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    api
      .rankSession(list.id)
      .then(({ state }) => state)
      .catch(() => null)
      .then((state) => {
        if (state) {
          setSaved(reconcile(state, asItems));
          setPhase('choose');
        } else if (anyRanked) setPhase('choose');
        else begin(newSession(asItems, 'scratch'));
      });
  }, [list.id, asItems, anyRanked, begin]);

  const ratings = useMemo(() => (session ? replay(session) : null), [session]);
  const prog = useMemo(() => (session && ratings ? progress(session, ratings) : null), [session, ratings]);
  const pair = useMemo(() => (session && ratings ? nextPair(session, ratings) : null), [session, ratings]);

  const answer = useCallback(
    (r: Choice) => {
      if (!session || !pair) return;
      const next = { ...session, answers: [...session.answers, { a: pair[0], b: pair[1], r }] };
      setSession(next);
      persist(next);
      if (progress(next).done) setPhase('preview');
    },
    [session, pair, persist],
  );

  const undo = useCallback(() => {
    if (!session || session.answers.length === 0) return;
    const next = { ...session, answers: session.answers.slice(0, -1) };
    setSession(next);
    persist(next);
    setPhase('duel');
  }, [session, persist]);

  // Keyboard: ← / → choose, ↓ or T is a tie, Backspace or Z undoes.
  useEffect(() => {
    if (phase !== 'duel') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') answer('a');
      else if (e.key === 'ArrowRight') answer('b');
      else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 't') answer('tie');
      else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, answer, undo]);

  const apply = async () => {
    if (!session) return;
    setApplying(true);
    setError(null);
    try {
      await api.rankList(list.id, orderOf(session));
      await api.discardRankSession(list.id).catch(() => {});
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the new ranking.');
      setApplying(false);
    }
  };

  const discard = async () => {
    await api.discardRankSession(list.id).catch(() => {});
    onDone(false);
  };

  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onDone(false)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
      >
        <ArrowLeft size={14} />
        {phase === 'duel' ? 'Pause and go back' : 'Back to list'}
      </button>
      <span className="text-gray-300 dark:text-gray-600">·</span>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Rank “{list.name}” by comparing</h3>
    </div>
  );

  if (phase === 'loading') {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      </div>
    );
  }

  if (phase === 'choose') {
    return (
      <div>
        {header}
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          You'll see two items at a time and pick the one you like more. It chooses the questions, and stops when the order is settled.
        </p>
        <div className="flex flex-wrap gap-2">
          {saved && saved.answers.length > 0 && (
            <button type="button" className={PRIMARY} onClick={() => begin(saved)}>
              Resume ({saved.answers.length} answered)
            </button>
          )}
          {anyRanked && (
            <button type="button" className={saved ? SECONDARY : PRIMARY} onClick={() => start('continue')}>
              Continue from my ranking
            </button>
          )}
          <button type="button" className={SECONDARY} onClick={() => start('scratch')}>
            Start from scratch
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          “Continue” treats your current ranks as a starting guess, which saves questions when they are mostly right. “From scratch” ignores them.
          Your list isn't changed until you apply the result.
        </p>
      </div>
    );
  }

  if (!session || !prog) return null;

  if (phase === 'preview') {
    const order = orderOf(session);
    const oldRank = new Map(items.map((i) => [getId(i), getRank(i)]));
    const moved = order.filter((id, idx) => oldRank.get(id) !== idx + 1).length;
    return (
      <div>
        {header}
        <p className="mb-2 text-sm text-gray-700 dark:text-gray-200">
          {prog.done
            ? 'Every neighbouring pair is settled.'
            : `${prog.unsure} neighbouring pair${prog.unsure === 1 ? ' is' : 's are'} still unsettled; those keep the order they currently have.`}{' '}
          {moved === 0 ? 'Nothing would move.' : `${moved} item${moved === 1 ? '' : 's'} would change rank.`}
        </p>
        <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-900">
          {order.map((id, idx) => {
            const item = byId.get(id)!;
            const was = oldRank.get(id) ?? null;
            const delta = was === null ? null : was - (idx + 1);
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="w-7 shrink-0 text-right font-bold tabular-nums text-primary-700 dark:text-primary-300">{idx + 1}</span>
                <span className="min-w-0 flex-1 truncate text-gray-900 dark:text-gray-100">
                  {getLabel(item)}
                  {getSubtitle && <span className="text-xs text-gray-500 dark:text-gray-400"> · {getSubtitle(item)}</span>}
                </span>
                <span className="shrink-0 text-xs text-gray-400" aria-label={was === null ? 'Was unranked' : delta === 0 ? 'Unchanged' : `Was ${was}`}>
                  {was === null ? (
                    'new'
                  ) : delta === 0 ? (
                    <Minus size={12} />
                  ) : delta! > 0 ? (
                    <span className="inline-flex items-center text-green-600"><ArrowUp size={12} />{delta}</span>
                  ) : (
                    <span className="inline-flex items-center text-red-500"><ArrowDown size={12} />{-delta!}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} onClick={() => void apply()} disabled={applying}>
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply this ranking
          </button>
          {!prog.done && (
            <button type="button" className={SECONDARY} onClick={() => setPhase('duel')}>
              Keep answering
            </button>
          )}
          <button type="button" className={SECONDARY} onClick={undo} disabled={session.answers.length === 0}>
            <Undo2 size={14} /> Undo last answer
          </button>
          <button type="button" className={SECONDARY} onClick={() => void discard()}>
            Discard
          </button>
        </div>
      </div>
    );
  }

  // duel
  const a = pair ? byId.get(pair[0]) : null;
  const b = pair ? byId.get(pair[1]) : null;
  const pct = prog.total === 0 ? 0 : Math.round((prog.answered / prog.total) * 100);
  return (
    <div>
      {header}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
          <span>
            {prog.answered} answered · about {prog.remaining} left
          </span>
          {saveFailed && <span className="text-amber-600">Couldn't save progress</span>}
        </div>
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 rounded-full bg-pink-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {a && b ? (
        <>
          <p className="mb-2 text-center text-sm font-medium text-gray-700 dark:text-gray-200">Which do you like more?</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ContenderCard label="A" text={getLabel(a)} shortcut="←" contender={renderContender(a)} onPick={() => answer('a')} />
            <ContenderCard label="B" text={getLabel(b)} shortcut="→" contender={renderContender(b)} onPick={() => answer('b')} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button type="button" className={SECONDARY} onClick={() => answer('tie')}>
              Can't decide <span className="hidden text-xs text-gray-400 sm:inline">(↓)</span>
            </button>
            <button type="button" className={SECONDARY} onClick={undo} disabled={session.answers.length === 0}>
              <Undo2 size={14} /> Undo
            </button>
            <button type="button" className={SECONDARY} onClick={() => setPhase('preview')} disabled={session.answers.length === 0}>
              Finish now
            </button>
          </div>
        </>
      ) : (
        <button type="button" className={PRIMARY} onClick={() => setPhase('preview')}>
          See the result
        </button>
      )}
    </div>
  );
}
