/**
 * Shared pieces of the Profile > Places > Lists UI: the lists index and the
 * rank cell / "Unranked" drop zone used by both list detail tables.
 */

import { useState } from 'react';
import { List, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatDate } from '../../../client/src/utils/checkin';
import type { DragEvent } from 'react';

export interface ListSummary {
  id: string;
  name: string;
  updated_at?: string;
  item_count?: number;
}

export interface ListsIndexApi {
  create: (name: string) => Promise<unknown>;
  rename: (id: string, name: string) => Promise<unknown>;
  delete: (id: string) => Promise<unknown>;
}

/**
 * Index of a family of lists (checkin lists or venue lists): rename / delete /
 * create plus a button per list to open its detail view. The two list types
 * share this UI but never share state or endpoints; `api` and the noun
 * strings are the only things that differ.
 */
export function ListsIndex({
  lists,
  api,
  itemNoun,
  emptyText,
  createLabel,
  onOpenList,
  onRefresh,
}: {
  lists: ListSummary[];
  api: ListsIndexApi;
  /** Singular noun for list items, e.g. "check-in" or "venue". */
  itemNoun: string;
  emptyText: string;
  createLabel: string;
  onOpenList: (id: string) => void;
  onRefresh: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      await api.create(name);
      setNewName('');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create list.');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (list: ListSummary) => {
    const name = renameValue.trim();
    if (!name || name === list.name) {
      setRenamingId(null);
      return;
    }
    try {
      await api.rename(list.id, name);
      setRenamingId(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename list.');
    }
  };

  const handleDelete = async (list: ListSummary) => {
    if (!window.confirm(`Delete list "${list.name}"? Its check-ins are kept; only the list membership is removed.`)) return;
    try {
      await api.delete(list.id);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete list.');
    }
  };

  return (
    <div className="space-y-4">
      {lists.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyText}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {lists.map((list) => (
            <li
              key={list.id}
              className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 py-2.5 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
            >
              <List size={16} className="text-primary-500 shrink-0" />
              {renamingId === list.id ? (
                <input
                  type="text"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void handleRename(list)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleRename(list);
                    } else if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  aria-label={`Rename list ${list.name}`}
                  className="flex-1 min-w-0 text-sm bg-transparent border border-primary-300 dark:border-primary-600 rounded-md px-1.5 py-0.5 text-gray-800 dark:text-gray-100 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenList(list.id)}
                  className="flex-1 min-w-0 text-left group"
                  title={`Open ${list.name}`}
                >
                  <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                    {list.name}
                  </span>
                  <span className="block text-xs text-gray-400">
                    {list.item_count ?? 0} {itemNoun}{(list.item_count ?? 0) !== 1 ? 's' : ''}
                    {list.updated_at
                      ? ` · updated ${formatDate(list.updated_at)}`
                      : ''}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setRenamingId(list.id);
                  setRenameValue(list.name);
                }}
                className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Rename list"
                aria-label={`Rename ${list.name}`}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(list)}
                className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Delete list"
                aria-label={`Delete ${list.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Create */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCreate();
            }
          }}
          placeholder="New list name"
          aria-label={createLabel}
          className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating || !newName.trim()}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 text-sm font-medium text-white transition-colors"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

export function RankBadge({ rank }: { rank: number | null }) {
  return rank != null ? (
    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded-md bg-primary-50 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-xs font-bold">
      {rank}
    </span>
  ) : (
    <span className="text-gray-300 dark:text-gray-600">—</span>
  );
}

/** Drop zone below a list table; dropping a row here clears its rank. */
export function UnrankedDropZone({
  active,
  count,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  active: boolean;
  count: number;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={[
        'mt-2 rounded-xl border-2 border-dashed px-4 py-3 text-sm text-center transition-colors',
        active
          ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
          : 'border-gray-200 dark:border-gray-700 text-gray-400',
      ].join(' ')}
    >
      {active ? 'Drop here to remove the rank' : 'Unranked'}
      {count > 0 && !active && <span className="ml-1 text-xs">({count})</span>}
    </div>
  );
}
