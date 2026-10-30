/**
 * Note detail page: /notes/:id — the rendered note, its tags, people, time,
 * themes, and related notes.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, FileText, Loader2, NotebookPen, Pencil, Trash2, Users } from 'lucide-react';
import { BackButton } from '../../../client/src/components/BackButton';
import { MarkdownNote } from '../../../client/src/components/checkin-card/MarkdownNote';
import { CompanionName } from '../../../client/src/components/CompanionName';
import { formatDate, formatTime, localDateKey, normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';
import { usePageTitle } from '../../../client/src/utils/pageTitle';
import { notes, type Note } from './api';
import { RelatedNotes } from './RelatedNotes';
import { TagChip, tagTimelinePath } from './TagChip';

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [row, setRow] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  usePageTitle(row ? `${row.title || 'Note'} · Notes` : 'Note');

  useEffect(() => {
    if (!id) return;
    setRow(null);
    notes.get(id).then(setRow).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [id]);

  const remove = async () => {
    if (!row || !window.confirm('Are you sure you want to delete this note?')) return;
    setDeleting(true);
    try {
      await notes.remove(row.id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (error) return <div className="py-16 text-center text-sm text-red-600 dark:text-red-400">{error}</div>;
  if (!row) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const tz = normalizeTimezoneForDisplay(row.checkin_timezone);
  const dayKey = localDateKey(row.checked_in_at, tz);

  return (
    <div className="mx-auto max-w-3xl">
      <BackButton />

      <article className="mt-4 rounded-2xl border border-white/40 dark:border-gray-700/40 bg-white/60 dark:bg-gray-900/60 shadow-sm shadow-black/3 p-6 space-y-4">
        <header className="flex items-start gap-3">
          <NotebookPen size={22} className="text-amber-500 shrink-0 mt-1" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 break-words">{row.title || 'Note'}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span>{formatDate(row.checked_in_at, tz)} · {formatTime(row.checked_in_at, tz)}</span>
              <span className="text-xs">{tz}</span>
              <Link
                to={`/?from=${dayKey}&to=${dayKey}`}
                aria-label="View this day on Home"
                title="View this day on Home"
                className="inline-flex items-center justify-center rounded-md p-1 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <CalendarDays size={14} />
              </Link>
              <span className="text-xs">· {row.word_count.toLocaleString()} words</span>
            </div>
          </div>
        </header>

        {(row.tags.length > 0 || row.themes.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.tags.map((t) => <TagChip key={t.id} tag={t} to={tagTimelinePath(t.name)} size="sm" />)}
            {row.themes.map((t) => (
              <span
                key={t.id}
                title={t.rank === 1 ? 'Theme (from the similarity analysis)' : 'Secondary theme'}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border border-dashed"
                style={{ color: t.color, borderColor: `${t.color}99` }}
              >
                ◆ {t.label}
              </span>
            ))}
          </div>
        )}

        {row.companions.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
            <Users size={14} className="text-gray-400 shrink-0" />
            {row.companions.map((name) => <CompanionName key={name} name={name} />)}
          </p>
        )}

        {row.body && <MarkdownNote note={row.body} />}

        {row.source === 'import' && row.source_filename && (
          <p className="flex items-center gap-1 text-[11px] text-gray-400">
            <FileText size={11} /> Imported from {row.source_filename}
          </p>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Link
            to={`/note-check-in?edit=${row.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Pencil size={14} /> Edit
          </Link>
          <button
            onClick={remove}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </article>

      <div className="mt-4 rounded-2xl border border-white/40 dark:border-gray-700/40 bg-white/60 dark:bg-gray-900/60 shadow-sm shadow-black/3 p-5">
        <RelatedNotes noteId={row.id} />
      </div>
    </div>
  );
}
