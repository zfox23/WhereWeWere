/**
 * The detail view every ranked list shares: back link, title with item count,
 * the ranked table/cards, and the load / drag-to-rank / remove plumbing.
 *
 * `useRankedList` owns the data; `RankedListDetail` only draws it. They are
 * separate so a plugin can swap the whole view out (music replaces it with
 * "rank by comparing") without reloading the list when it comes back.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { RankedListView } from './RankedListView';
import type { RankedColumn, RankedSortOption } from './RankedListView';

/** The slice of a plugin's list API the detail view needs. */
export interface RankedListApi<T> {
  items: (listId: string) => Promise<T[]>;
  /** Drag-to-rank: the item ids in their new order; everyone else becomes unranked. */
  reRank: (listId: string, rankedIds: string[]) => Promise<unknown>;
}

export interface RankedListState<T> {
  items: T[];
  loading: boolean;
  saving: boolean;
  /** Fetch the items again (quietly: no spinner). */
  reload: () => Promise<void>;
  persistOrder: (rankedIds: string[]) => Promise<void>;
  /** Confirm, run the plugin's remove call, then reload (the server closes any rank gap). */
  removeItem: (item: T, opts: { message: string; call: () => Promise<unknown> }) => Promise<void>;
}

export function useRankedList<T>({
  listId,
  api,
  getId,
  withRank,
  onChanged,
}: {
  listId: string;
  api: RankedListApi<T>;
  getId: (item: T) => string;
  /** The item with its rank replaced (used to show a re-rank before the server round trip returns). */
  withRank: (item: T, rank: number | null) => T;
  /** Called after anything that changed the list on the server (e.g. to refresh an index cache). */
  onChanged?: () => void;
}): RankedListState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .items(listId)
      .then((data) => !cancelled && setItems(data))
      .catch(() => !cancelled && setItems([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // `api` is a module-level object in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  const reload = useCallback(
    () => api.items(listId).then(setItems).catch(() => setItems([])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listId],
  );

  const persistOrder = async (rankedIds: string[]) => {
    setSaving(true);
    try {
      await api.reRank(listId, rankedIds);
      const rankById = new Map(rankedIds.map((id, idx) => [id, idx + 1]));
      setItems((prev) => prev.map((i) => withRank(i, rankById.get(getId(i)) ?? null)));
      onChanged?.();
    } catch (err) {
      console.error('Failed to re-rank list:', err);
      await reload(); // re-sync so local state can't drift
    } finally {
      setSaving(false);
    }
  };

  const removeItem: RankedListState<T>['removeItem'] = async (_item, { message, call }) => {
    if (!window.confirm(message)) return;
    try {
      await call();
      await reload();
      onChanged?.();
    } catch (err) {
      console.error('Failed to remove from list:', err);
    }
  };

  return { items, loading, saving, reload, persistOrder, removeItem };
}

/**
 * The shared 'rank' sort: ranked items first in rank order, unranked sink to
 * the bottom ordered by `tiebreak` (each list type's natural order).
 */
export function compareByRank<T>(getRank: (item: T) => number | null, tiebreak: (a: T, b: T) => number) {
  return (a: T, b: T): number => {
    const ar = getRank(a);
    const br = getRank(b);
    if (ar == null && br == null) return tiebreak(a, b);
    if (ar == null) return 1;
    if (br == null) return -1;
    return ar - br;
  };
}

/** The dash shown in an empty table cell. */
export const dash = <span className="text-gray-300 dark:text-gray-600">—</span>;

/** The card every list section sits in. */
export const LIST_SECTION_CLASS =
  'rounded-2xl border border-white/40 bg-white/60 p-4 shadow-sm shadow-black/3 dark:border-gray-700/40 dark:bg-gray-900/60';

export function ListSectionShell({ label, loading, children }: { label?: string; loading: boolean; children: ReactNode }) {
  return (
    <section aria-label={label} className={LIST_SECTION_CLASS}>
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function RankedListDetail<T>({
  list,
  onBack,
  state,
  itemNoun,
  emptyText,
  getId,
  getRank,
  getLabel,
  columns,
  renderCard,
  sortOptions,
  compareBy,
  compareUnranked,
  removeMessage,
  onRemove,
  headerActions,
}: {
  list: { id: string; name: string };
  onBack: () => void;
  state: RankedListState<T>;
  /** Singular noun for the count, e.g. "venue". */
  itemNoun: string;
  emptyText: ReactNode;
  getId: (item: T) => string;
  getRank: (item: T) => number | null;
  getLabel: (item: T) => string;
  columns: RankedColumn<T>[];
  renderCard: (item: T) => ReactNode;
  sortOptions: RankedSortOption[];
  compareBy: (key: string, a: T, b: T) => number;
  compareUnranked: (a: T, b: T) => number;
  /** Confirmation text for removing an item. */
  removeMessage: (item: T) => string;
  /** The plugin's remove call for an item. */
  onRemove: (item: T) => Promise<unknown>;
  /** Extra controls on the header row, pushed to the right. */
  headerActions?: ReactNode;
}) {
  const { items, loading, saving, persistOrder, removeItem } = state;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
        >
          <ArrowLeft size={14} />
          Back to lists
        </button>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {list.name}
          {!loading && (
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              {items.length} {itemNoun}
              {items.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>
        {saving && <Loader2 size={14} className="animate-spin text-primary-500" />}
        {headerActions && <div className="ml-auto">{headerActions}</div>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyText}</p>
      ) : (
        <RankedListView
          items={items}
          getId={getId}
          getRank={getRank}
          getLabel={getLabel}
          columns={columns}
          renderCard={renderCard}
          sortOptions={sortOptions}
          compareBy={compareBy}
          compareUnranked={compareUnranked}
          onReorder={persistOrder}
          onRemove={(item) => void removeItem(item, { message: removeMessage(item), call: () => onRemove(item) })}
        />
      )}
    </div>
  );
}
