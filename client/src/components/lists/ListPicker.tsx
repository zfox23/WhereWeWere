/**
 * Which lists something is on, as a checkbox per list plus a "new list" field.
 * The body only: callers put it in their own popover, modal or panel, and say
 * what toggling and creating do (add or remove on the server right away, or
 * just change the form's selection). Anything that throws shows its message.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';

export function ListPicker<L extends { id: string; name: string }>({
  lists,
  loaded = true,
  isOn,
  count,
  onToggle,
  onCreate,
  onChanged,
  autoFocus = false,
  emptyText = 'No lists yet. Name one to start.',
  maxNameLength = 100,
}: {
  lists: L[];
  /** False while the lists are still loading. */
  loaded?: boolean;
  isOn: (list: L) => boolean;
  /** Shown at the end of each row (how many items the list holds). */
  count?: (list: L) => number;
  /** Add to (`on` true) or remove from the list. */
  onToggle: (list: L, on: boolean) => Promise<unknown> | void;
  /** Create a list with this name and put the thing on it. */
  onCreate: (name: string) => Promise<unknown> | void;
  /** Called after a toggle or create succeeded (e.g. to refresh the lists). */
  onChanged?: () => Promise<unknown> | void;
  autoFocus?: boolean;
  emptyText?: string;
  maxNameLength?: number;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const run = async (id: string, work: () => Promise<unknown> | void) => {
    setBusy(id);
    setError(null);
    try {
      await work();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  // Not a <form>: callers may put the picker inside one (the check-in form).
  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void run('new', async () => {
      await onCreate(trimmed);
      setName('');
    });
  };

  return (
    <div>
      {!loaded && <Loader2 size={14} className="animate-spin text-primary-600" />}
      {loaded && lists.length === 0 && <p className="mb-2 text-xs text-gray-500">{emptyText}</p>}
      <ul className="max-h-48 space-y-0.5 overflow-y-auto">
        {lists.map((l) => {
          const on = isOn(l);
          return (
            <li key={l.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={busy !== null}
                onClick={() => void run(l.id, () => onToggle(l, !on))}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-pink-50 disabled:opacity-60 dark:text-gray-100 dark:hover:bg-pink-900/20"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-pink-500 bg-pink-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                  {busy === l.id ? <Loader2 size={10} className="animate-spin" /> : on ? <Check size={11} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                {count && <span className="shrink-0 text-xs text-gray-400">{count(l)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
          maxLength={maxNameLength}
          placeholder="New list name"
          aria-label="New list name"
          className="input min-w-0 flex-1 !py-1 text-sm"
        />
        <button type="button" onClick={create} disabled={busy !== null || !name.trim()} aria-label="Create list" className="btn-secondary !px-2 !py-1">
          {busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
