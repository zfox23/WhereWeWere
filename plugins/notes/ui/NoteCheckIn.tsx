/**
 * Note check-in page (create + edit via ?edit=<id>): optional title, a
 * markdown editor, tags, companions, and an editable date/time in an
 * editable time zone. Unsaved text is kept as a local draft.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, History, Loader2, Trash2, X } from 'lucide-react';
import type { CheckInFormProps } from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import CompanionChipInput from '../../../client/src/components/CompanionChipInput';
import { deviceTimezone } from '../../../client/src/utils/slugify';
import { utcToZonedLocalValue, zonedLocalToIso } from '../../../client/src/utils/zoned';
import { usePageTitle } from '../../../client/src/utils/pageTitle';
import { MAX_TITLE_LENGTH } from '../manifest';
import { notes, type NoteInput } from './api';
import { MarkdownEditor } from './MarkdownEditor';
import TagChipInput from './TagChipInput';
import { TimezoneInput } from './TimezoneInput';
import { clearDraft, draftKey, loadDraft, sameContent, saveDraft, type NoteDraft } from './noteDraft';

const labelClass = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5';

interface Loaded {
  title: string;
  body: string;
  tags: string[];
  dateTime: string;
  timezone: string;
  iso: string;
}

function draftTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function NoteCheckIn({ editId = null, dateParam = null, onCreated }: CheckInFormProps) {
  const navigate = useNavigate();
  usePageTitle(editId ? 'Edit Note' : 'New Note');
  const key = useMemo(() => draftKey(editId), [editId]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [companions, setCompanions] = useState<string[]>([]);
  const [timezone, setTimezone] = useState(() => deviceTimezone());
  const [dateTime, setDateTime] = useState(() =>
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? `${dateParam}T20:00`
      : utcToZonedLocalValue(new Date().toISOString(), deviceTimezone()));
  // As loaded in edit mode: an untouched date/time keeps its exact instant.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // A new note offers any leftover draft straight away (read before the
  // first autosave can overwrite it); edit mode offers one after loading.
  const [draft, setDraft] = useState<NoteDraft | null>(() => (editId ? null : loadDraft(draftKey(editId))));

  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Autosave only starts once the stored note (and any draft offer) is settled.
  const ready = useRef(!editId);

  // Edit mode: load the note, then offer a draft that differs from it.
  useEffect(() => {
    if (!editId) return;
    notes.get(editId)
      .then((row) => {
        const tz = row.checkin_timezone && isValidTimeZone(row.checkin_timezone) ? row.checkin_timezone : deviceTimezone();
        const local = utcToZonedLocalValue(row.checked_in_at, tz);
        const names = row.tags.map((t) => t.name);
        setTitle(row.title ?? '');
        setBody(row.body);
        setTags(names);
        setCompanions(row.companions);
        setTimezone(tz);
        setDateTime(local);
        setLoaded({ title: row.title ?? '', body: row.body, tags: names, dateTime: local, timezone: tz, iso: row.checked_in_at });
        const saved = loadDraft(key);
        if (saved && !sameContent(saved, { title: row.title ?? '', body: row.body, tags: names })) setDraft(saved);
        else if (saved) clearDraft(key);
        ready.current = true;
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load the note'))
      .finally(() => setLoading(false));
  }, [editId, key]);

  // Autosave (debounced). While a draft offer is unanswered, leave it alone.
  useEffect(() => {
    if (!ready.current || draft) return;
    const current = { title, body, tags };
    const timer = setTimeout(() => {
      if (loaded && sameContent(current, loaded)) clearDraft(key);
      else saveDraft(key, current);
    }, 500);
    return () => clearTimeout(timer);
  }, [title, body, tags, key, loaded, draft]);

  const restoreDraft = () => {
    if (!draft) return;
    setTitle(draft.title);
    setBody(draft.body);
    setTags(draft.tags);
    setDraft(null);
  };

  const discardDraft = () => {
    clearDraft(key);
    setDraft(null);
  };

  const buildInput = (): NoteInput | null => {
    const tz = timezone.trim();
    if (!isValidTimeZone(tz)) {
      setError('Pick a valid time zone (e.g. America/Chicago).');
      return null;
    }
    if (!title.trim() && !body.trim()) {
      setError('Write something, or at least give the note a title.');
      return null;
    }
    const unchanged = loaded && loaded.dateTime === dateTime && loaded.timezone === tz;
    const iso = unchanged ? loaded.iso : zonedLocalToIso(dateTime, tz);
    if (!iso) {
      setError('Pick a valid date and time.');
      return null;
    }
    return { title: title.trim() || null, body, checked_in_at: iso, checkin_timezone: tz, tags, companions };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    try {
      if (editId) {
        await notes.update(editId, input);
        clearDraft(key);
        navigate(`/notes/${editId}`);
      } else {
        const row = await notes.create(input);
        clearDraft(key);
        onCreated(row.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editId || !window.confirm('Are you sure you want to delete this note?')) return;
    setDeleting(true);
    try {
      await notes.remove(editId);
      clearDraft(key);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{editId ? 'Edit note' : 'New note'}</h1>

      {draft && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <History size={16} className="shrink-0" />
          <span className="flex-1 min-w-[12rem]">
            You have an unsaved draft from {draftTime(draft.savedAt)}
            {draft.title ? <> (“{draft.title}”)</> : null}.
          </span>
          <button type="button" onClick={restoreDraft} className="btn-primary text-xs px-3 py-1.5">Restore draft</button>
          <button type="button" onClick={discardDraft} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
            <X size={12} /> Discard
          </button>
        </div>
      )}

      <form
        onSubmit={submit}
        className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 space-y-5"
      >
        <div>
          <label htmlFor="note-title" className={labelClass}>Title (optional)</label>
          <input
            id="note-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE_LENGTH}
            placeholder="e.g. Night with Jason"
            className="input"
          />
        </div>

        <div>
          <label htmlFor="note-body" className="sr-only">Note</label>
          <MarkdownEditor id="note-body" value={body} onChange={setBody} placeholder="Write in Markdown…" />
        </div>

        <div>
          <span className={labelClass}>Tags</span>
          <TagChipInput value={tags} onChange={setTags} />
        </div>

        <div>
          <span className={labelClass}>With…</span>
          <CompanionChipInput value={companions} onChange={setCompanions} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="note-when" className={labelClass}>Date &amp; Time</label>
            <input
              id="note-when"
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="input"
              required
            />
          </div>
          <div>
            <label htmlFor="note-tz" className={labelClass}>Time zone</label>
            <TimezoneInput id="note-tz" value={timezone} onChange={setTimezone} />
            {timezone !== deviceTimezone() && isValidTimeZone(timezone.trim()) && (
              <button
                type="button"
                onClick={() => setTimezone(deviceTimezone())}
                className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline mt-1"
              >
                Use this device's zone ({deviceTimezone()})
              </button>
            )}
          </div>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

        <div className="flex items-center justify-end gap-3">
          {editId && (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="mr-auto inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 px-4 py-2 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete
            </button>
          )}
          <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {editId ? 'Save changes' : 'Save note'}
          </button>
        </div>
      </form>
    </div>
  );
}
