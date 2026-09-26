/**
 * CompanionsTab — the Profile "Companions" tab.
 *
 * A table of every name in the shared companion database with how many
 * check-ins it appears on (clickable: opens Home in a new tab filtered to
 * check-ins with that companion) and the most recent such check-in. Each row
 * has an edit button that puts the row in edit mode (rename / remove), and
 * an input at the top adds new names to the pool.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Loader2, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { companions as companionsApi } from '../api/client';
import { formatDate } from '../utils/checkin';
import { CompanionName } from './CompanionName';
import type { CompanionSummary } from '../types';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

type SortKey = 'name' | 'checkin_count' | 'last_checkin_at';
type SortDir = 'asc' | 'desc';

export function CompanionsTab() {
  const [rows, setRows] = useState<CompanionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The row currently in edit mode (by name) and its rename draft.
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // Add-a-new-name draft.
  const [addValue, setAddValue] = useState('');

  // Column sort state (client-side; first click sorts ascending, next toggles).
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedRows = useMemo(() => {
    if (rows === null) return null;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'checkin_count':
          cmp = a.checkin_count - b.checkin_count;
          break;
        case 'last_checkin_at':
          // Names without a check-in sort last regardless of direction.
          if (a.last_checkin_at !== b.last_checkin_at) {
            if (!a.last_checkin_at) return 1;
            if (!b.last_checkin_at) return -1;
          }
          cmp = (a.last_checkin_at ?? '').localeCompare(b.last_checkin_at ?? '');
          break;
      }
      if (cmp !== 0) return cmp * dir;
      // Deterministic tiebreak.
      return a.name.localeCompare(b.name);
    });
  }, [rows, sortKey, sortDir]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await companionsApi.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (row: CompanionSummary) => {
    setEditingName(row.name);
    setEditValue(row.name);
    setActionError(null);
  };

  const cancelEdit = () => {
    setEditingName(null);
    setEditValue('');
  };

  const saveEdit = async (row: CompanionSummary) => {
    const to = editValue.trim();
    if (!to || to === row.name) {
      cancelEdit();
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await companionsApi.rename(row.name, to);
      cancelEdit();
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeRow = async (row: CompanionSummary) => {
    const confirmed = window.confirm(
      `Remove "${row.name}" from all ${row.checkin_count} check-in${row.checkin_count === 1 ? '' : 's'}?`
    );
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      await companionsApi.remove(row.name);
      if (editingName === row.name) cancelEdit();
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addRow = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addValue.trim();
    if (!name) return;
    setBusy(true);
    setActionError(null);
    try {
      await companionsApi.add(name);
      setAddValue('');
      await load();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  }

  if (!sortedRows) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={addRow}
        className="flex gap-2 bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4"
      >
        <input
          type="text"
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          placeholder="Add a companion name…"
          className="flex-1 px-3 py-2 bg-white/70 dark:bg-gray-900/70 border border-white/40 dark:border-gray-700/40 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-gray-100 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={busy || addValue.trim() === ''}
          className="btn-primary disabled:opacity-50"
        >
          <Plus size={16} />
          Add
        </button>
      </form>

      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      )}

      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              {([
                ['name', 'Companion', ''],
                ['checkin_count', 'Check-ins', 'text-center'],
                ['last_checkin_at', 'Last check-in', ''],
              ] as [SortKey, string, string][]).map(([key, label, align]) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`px-4 py-3 ${align}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(key)}
                    title={`Sort by ${label.toLowerCase()}`}
                    className={`flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 ${align === 'text-center' ? 'mx-auto' : ''}`}
                  >
                    {label}
                    {key === sortKey
                      ? sortDir === 'asc'
                        ? <ArrowUp size={12} className="text-primary-600 dark:text-primary-400" />
                        : <ArrowDown size={12} className="text-primary-600 dark:text-primary-400" />
                      : <ChevronsUpDown size={12} className="opacity-40" />}
                  </button>
                </th>
              ))}
              <th className="px-4 py-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500 italic">
                  No companions yet. Add a name above or check in with someone.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => {
              const isEditing = editingName === row.name;
              return (
                <tr
                  key={row.name}
                  className="border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  {/* In edit mode the name field spans the first three columns —
                      check-in count and last check-in date aren't directly editable. */}
                  <td className="px-4 py-2.5" colSpan={isEditing ? 3 : undefined}>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(row);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        className="w-full px-2 py-1 bg-white/70 dark:bg-gray-900/70 border border-primary-400 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-100"
                      />
                    ) : (
                      <CompanionName name={row.name} className="font-medium text-gray-800 dark:text-gray-200" />
                    )}
                  </td>
                  {!isEditing && (
                    <td className="px-4 py-2.5 text-center">
                      <a
                        href={`/?companion=${encodeURIComponent(row.name)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`View check-ins with ${row.name} (opens in a new tab)`}
                        className="font-semibold text-primary-600 dark:text-primary-400 hover:underline tabular-nums"
                      >
                        {row.checkin_count}
                      </a>
                    </td>
                  )}
                  {!isEditing && (
                    <td className="px-4 py-2.5 text-gray-600 dark:text-gray-300">
                      {row.last_checkin_at ? formatDate(row.last_checkin_at) : <span className="text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEdit(row)}
                            disabled={busy || editValue.trim() === '' || editValue.trim() === row.name}
                            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                            title="Save name"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            disabled={busy}
                            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                            title="Cancel"
                          >
                            <X size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRow(row)}
                            disabled={busy}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
                            title="Remove from all check-ins"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                          title={`Edit ${row.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
