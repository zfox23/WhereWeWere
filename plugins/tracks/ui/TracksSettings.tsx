/**
 * Tracks Settings tab — Activity types manager.
 *
 * Lists every activity type in use across all tracks with the number of
 * tracks per type. The type name can be renamed in place; renaming updates
 * every track that uses the type. Renaming to a name that already exists
 * asks for confirmation and merges the two types (the server matches names
 * case-sensitively, so "Cycling" and "cycling" are distinct types). The
 * per-type count links to the Home timeline, opened in a new tab with the
 * matching track-activity filter applied.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Route } from 'lucide-react';
import { tracks } from './api';

interface ActivityTypeSummary {
  name: string;
  count: number;
}

function countLabel(count: number): string {
  return `${count} track${count === 1 ? '' : 's'}`;
}

export function TracksSettings() {
  const [types, setTypes] = useState<ActivityTypeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    tracks
      .activityTypeSummary()
      .then((data) => setTypes(data))
      .catch(() => setError('Failed to load activity types.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  const startEdit = (name: string) => {
    setEditingName(name);
    setDraft(name);
    setRowError(null);
  };

  const cancelEdit = () => {
    setEditingName(null);
    setRowError(null);
  };

  const performRename = async (original: string, next: string, merge: boolean): Promise<{ ok: boolean; message?: string }> => {
    setSaving(true);
    try {
      await tracks.renameActivityType(original, next, merge);
      cancelEdit();
      refresh();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to rename activity type.';
      setRowError(message);
      return { ok: false, message };
    } finally {
      setSaving(false);
    }
  };

  const commitRename = async (original: string) => {
    const next = draft.trim();
    if (!next) {
      setRowError('Activity type name cannot be empty.');
      return;
    }
    if (next === original) {
      cancelEdit();
      return;
    }

    // Case-sensitive exact match against the freshly loaded list.
    const existing = types.find((t) => t.name === next);
    if (existing && !mergeConfirmed(existing, original, next)) return;

    const result = await performRename(original, next, Boolean(existing));

    // The name may have appeared since the list loaded: the server 409s
    // with an "already exists" message; offer the merge then too.
    if (!result.ok && result.message?.includes('already exists') &&
        mergeConfirmed(null, original, next)) {
      await performRename(original, next, true);
    }
  };

  const mergeConfirmed = (
    existing: { name: string; count: number } | null,
    original: string,
    next: string,
  ): boolean => {
    const existingNote = existing
      ? `already exists with ${countLabel(existing.count)}.\n\n`
      : `already exists.\n\n`;
    return window.confirm(
      `An activity type named "${next}" ${existingNote}` +
        `Merge "${original}" into "${next}"? All tracks of type "${original}" ` +
        `will be changed to "${next}".`,
    );
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Route size={20} className="text-rose-500" />
        Activity Types
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Every activity type used by your tracks. Rename a type to update all of its
        tracks; renaming to an existing type merges the two. Names are case-sensitive.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : types.length === 0 ? (
        <p className="text-sm text-gray-400">
          No activity types yet. Activity types appear once tracks carry one.
        </p>
      ) : (
        <ul className="grid gap-2">
          {types.map((type) => {
            const isEditing = editingName === type.name;
            return (
              <li
                key={type.name}
                className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 px-3 py-2.5"
              >
                <Route size={16} className="text-rose-500 shrink-0" />
                {isEditing ? (
                  <input
                    type="text"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(type.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitRename(type.name);
                      } else if (e.key === 'Escape') {
                        cancelEdit();
                      }
                    }}
                    aria-label={`Rename activity type ${type.name}`}
                    className="flex-1 min-w-0 text-sm bg-transparent border border-primary-300 dark:border-primary-600 rounded-md px-1.5 py-0.5 text-gray-800 dark:text-gray-100 focus:outline-none"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {type.name}
                  </span>
                )}
                <a
                  href={`/?track_activity=${encodeURIComponent(type.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Open the Home timeline filtered to ${type.name} in a new tab`}
                  className="shrink-0 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline tabular-nums"
                >
                  {countLabel(type.count)}
                </a>
                <button
                  type="button"
                  onClick={() => (isEditing ? cancelEdit() : startEdit(type.name))}
                  disabled={saving && isEditing}
                  className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shrink-0"
                  title="Rename activity type"
                  aria-label={`Rename ${type.name}`}
                >
                  {saving && isEditing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Pencil size={14} />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(error || rowError) && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-md px-3 py-2">
          {rowError ?? error}
        </p>
      )}
    </div>
  );
}
