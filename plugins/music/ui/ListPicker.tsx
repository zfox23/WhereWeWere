/**
 * Pick which lists a song or album is on, or start a new list with it.
 * Toggling a list adds or removes immediately.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { music } from './api';
import { targetItemKey, type ListTarget } from './types';
import { useMusicLists } from './useMusicLists';

export function ListPicker({ target, label, onClose }: { target: ListTarget; label: string; onClose: () => void }) {
  const { lists, loaded, refresh } = useMusicLists();
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemKey = targetItemKey(target);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const toggle = (list: { id: string; items: { id: string; item_key: string }[] }) =>
    run(list.id, async () => {
      const existing = list.items.find((i) => i.item_key === itemKey);
      if (existing) await music.removeFromList(list.id, existing.id);
      else await music.addToList(list.id, target);
    });

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    void run('new', async () => {
      const list = await music.createList(name.trim());
      await music.addToList(list.id, target);
      setName('');
    });
  };

  return (
    <div
      role="dialog"
      aria-label={`Add ${label} to a list`}
      className="w-72 max-w-full rounded-xl border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      // Escape closes the picker only, not the album modal behind it.
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold text-gray-700 dark:text-gray-200">Add “{label}” to…</p>
        <button type="button" onClick={onClose} aria-label="Close list picker" className="shrink-0 text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
      {!loaded && <Loader2 size={14} className="animate-spin text-primary-600" />}
      {loaded && lists.length === 0 && <p className="mb-2 text-xs text-gray-500">No lists yet. Name one to start.</p>}
      <ul className="max-h-48 space-y-0.5 overflow-y-auto">
        {lists.map((l) => {
          const on = l.items.some((i) => i.item_key === itemKey);
          return (
            <li key={l.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={busy !== null}
                onClick={() => toggle(l)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-pink-50 disabled:opacity-60 dark:text-gray-100 dark:hover:bg-pink-900/20"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-pink-500 bg-pink-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                  {busy === l.id ? <Loader2 size={10} className="animate-spin" /> : on ? <Check size={11} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="shrink-0 text-xs text-gray-400">{l.items.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={create} className="mt-2 flex gap-1.5">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="New list name"
          aria-label="New list name"
          className="input min-w-0 flex-1 !py-1 text-sm"
        />
        <button type="submit" disabled={busy !== null || !name.trim()} aria-label="Create list" className="btn-secondary !px-2 !py-1">
          <Plus size={14} />
        </button>
      </form>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
