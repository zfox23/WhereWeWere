/**
 * Note Library reading pane: the selected note rendered, with its tags,
 * date, open/edit links and related notes (which select in place).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, NotebookPen, Pencil } from 'lucide-react';
import { MarkdownNote } from '../../../../client/src/components/checkin-card/MarkdownNote';
import { formatDate, formatTime, normalizeTimezoneForDisplay } from '../../../../client/src/utils/checkin';
import { notes, type Note } from '../api';
import { RelatedNotes } from '../RelatedNotes';
import { TagChip, tagTimelinePath } from '../TagChip';

export function ReadingPane({ noteId, onSelect }: { noteId: string | null; onSelect: (id: string) => void }) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    setNote(null);
    setError(null);
    notes.get(noteId)
      .then((n) => !cancelled && setNote(n))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load the note'));
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (!noteId) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-sm text-gray-400">
        <NotebookPen size={28} className="text-gray-300 dark:text-gray-600" />
        Pick a note to read it here.
      </div>
    );
  }
  if (error) return <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!note) return <div className="flex justify-center p-8"><Loader2 className="animate-spin text-gray-400" /></div>;

  const tz = normalizeTimezoneForDisplay(note.checkin_timezone);
  return (
    <article className="space-y-3 p-4">
      <header>
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 break-words">{note.title || 'Note'}</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(note.checked_in_at, tz)} · {formatTime(note.checked_in_at, tz)} · {tz} · {note.word_count.toLocaleString()} words
        </p>
      </header>
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">{note.tags.map((t) => <TagChip key={t.id} tag={t} to={tagTimelinePath(t.name)} />)}</div>
      )}
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {note.body ? <MarkdownNote note={note.body} /> : <p className="text-sm text-gray-400">No text.</p>}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-gray-100 dark:border-gray-800 pt-3 text-xs">
        <Link to={`/notes/${note.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          <ExternalLink size={13} /> Open
        </Link>
        <Link to={`/note-check-in?edit=${note.id}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
          <Pencil size={13} /> Edit
        </Link>
      </div>
      <RelatedNotes noteId={note.id} onSelect={onSelect} />
    </article>
  );
}
