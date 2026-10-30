/**
 * Settings > Notes > Tags: rename, recolor, merge and delete tags. A rename
 * onto an existing name offers to merge instead.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, GitMerge, Loader2, Pencil, Tags, Trash2, X } from 'lucide-react';
import { TAG_PALETTE } from '../manifest';
import { TagConflictError, notes, type NoteTagSummary } from './api';
import { TagChip } from './TagChip';

type Msg = { type: 'success' | 'error'; text: string } | null;

function TagRow({ tag, others, onChanged, onMsg }: {
  tag: NoteTagSummary;
  others: NoteTagSummary[];
  onChanged: () => Promise<void>;
  onMsg: (m: Msg) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [mergeInto, setMergeInto] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(tag.name);
    setColor(tag.color);
  }, [tag.name, tag.color]);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    onMsg(null);
    try {
      const text = await fn();
      await onChanged();
      if (text) onMsg({ type: 'success', text });
      setEditing(false);
    } catch (err) {
      onMsg({ type: 'error', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  };

  const merge = (intoId: string, intoName: string) => run(async () => {
    const res = await notes.mergeTag(tag.id, intoId);
    return `Merged “${tag.name}” into “${intoName}” (${res.notes_moved} notes moved).`;
  });

  const save = () => run(async () => {
    const updates: { name?: string; color?: string } = {};
    if (name.trim() && name.trim() !== tag.name) updates.name = name.trim();
    if (color !== tag.color) updates.color = color;
    if (!updates.name && !updates.color) return null;
    try {
      await notes.updateTag(tag.id, updates);
    } catch (err) {
      if (err instanceof TagConflictError
        && window.confirm(`A tag named “${err.conflictName}” already exists. Merge “${tag.name}” into it?`)) {
        await notes.mergeTag(tag.id, err.conflictId);
        return `Merged “${tag.name}” into “${err.conflictName}”.`;
      }
      throw err;
    }
    return 'Tag saved.';
  });

  const remove = () => {
    const what = tag.note_count === 1 ? '1 note' : `${tag.note_count} notes`;
    if (!window.confirm(`Delete the tag “${tag.name}”? It will be removed from ${what}; the notes themselves stay.`)) return;
    run(async () => {
      await notes.deleteTag(tag.id);
      return `Deleted “${tag.name}”.`;
    });
  };

  if (!editing) {
    return (
      <li className="flex items-center gap-3 py-2">
        <TagChip tag={tag} size="sm" />
        <span className="flex-1 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          {tag.note_count.toLocaleString()} {tag.note_count === 1 ? 'note' : 'notes'} · {tag.word_count.toLocaleString()} words
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${tag.name}`}
          className="rounded-md p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <Pencil size={14} />
        </button>
      </li>
    );
  }

  return (
    <li className="py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          aria-label="Tag name"
          className="input flex-1 min-w-[10rem]"
        />
        <button type="button" onClick={save} disabled={busy} className="btn-primary inline-flex items-center gap-1 text-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setName(tag.name);
            setColor(tag.color);
          }}
          aria-label="Cancel"
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Color">
        {TAG_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color.toLowerCase() === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`h-6 w-6 rounded-full border-2 ${color.toLowerCase() === c ? 'border-gray-900 dark:border-white' : 'border-transparent'}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <label className="ml-1 inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          Custom
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-8 cursor-pointer bg-transparent" />
        </label>
        <span className="ml-2"><TagChip tag={{ name: name || tag.name, color }} size="sm" /></span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {others.length > 0 && (
          <>
            <select
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
              aria-label="Merge into"
              className="input w-auto max-w-[14rem] text-sm"
            >
              <option value="">Merge into…</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button
              type="button"
              disabled={!mergeInto || busy}
              onClick={() => {
                const into = others.find((o) => o.id === mergeInto);
                if (into && window.confirm(`Move every “${tag.name}” note to “${into.name}” and delete “${tag.name}”?`)) merge(into.id, into.name);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 disabled:opacity-40"
            >
              <GitMerge size={13} /> Merge
            </button>
          </>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <Trash2 size={13} /> Delete tag
        </button>
      </div>
    </li>
  );
}

export function TagManager({ refreshKey = 0 }: { refreshKey?: number }) {
  const [tags, setTags] = useState<NoteTagSummary[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try {
      setTags(await notes.tags());
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Could not load tags' });
      setTags([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 space-y-3">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <Tags size={20} className="text-amber-500" />
        Tags
      </h2>
      {tags === null ? (
        <Loader2 size={18} className="animate-spin text-gray-400" />
      ) : tags.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No tags yet. Add tags while writing a note or when importing files.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {tags.map((t) => (
            <TagRow key={t.id} tag={t} others={tags.filter((o) => o.id !== t.id)} onChanged={load} onMsg={setMsg} />
          ))}
        </ul>
      )}
      {msg && (
        <div className={`flex items-center gap-2 text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {msg.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
