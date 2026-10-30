/**
 * "Related notes": the most similar notes by the similarity analysis. Used
 * on the detail page and in the Note Library's reading pane.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { formatDate } from '../../../client/src/utils/checkin';
import { notes, type RelatedNote } from './api';
import { TagDot } from './TagChip';

interface RelatedNotesProps {
  noteId: string;
  /** In-page selection (Note Library) instead of navigating to the detail page. */
  onSelect?: (id: string) => void;
  limit?: number;
}

export function noteHeading(title: string | null, excerpt: string): string {
  if (title) return title;
  const line = excerpt.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const plain = line.replace(/^(#{1,6}\s+|[-*+>]\s*)/, '');
  return plain ? (plain.length > 60 ? `${plain.slice(0, 59)}…` : plain) : 'Untitled note';
}

export function RelatedNotes({ noteId, onSelect, limit = 6 }: RelatedNotesProps) {
  const [state, setState] = useState<{ analyzed: boolean; related: RelatedNote[] } | null>(null);

  useEffect(() => {
    setState(null);
    notes.related(noteId, limit).then(setState).catch(() => setState({ analyzed: false, related: [] }));
  }, [noteId, limit]);

  if (!state) return null;

  return (
    <section aria-labelledby={`related-${noteId}`}>
      <h2 id={`related-${noteId}`} className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
        <Sparkles size={14} className="text-violet-500" /> Related notes
      </h2>
      {!state.analyzed ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Run the similarity analysis in{' '}
          <Link to="/profile?tab=plugin:notes" className="underline hover:text-primary-600">Profile &gt; Notes</Link>
          {' '}to find notes like this one.
        </p>
      ) : state.related.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No similar notes found.</p>
      ) : (
        <ul className="space-y-1">
          {state.related.map((r) => {
            const label = noteHeading(r.title, r.excerpt);
            const content = (
              <>
                <span className="min-w-0 flex-1 truncate font-medium text-gray-800 dark:text-gray-100">{label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.tags.slice(0, 3).map((t) => <TagDot key={t.id} color={t.color} />)}
                </span>
                <span className="shrink-0 text-gray-400 tabular-nums">{formatDate(r.checked_in_at, r.checkin_timezone ?? 'UTC')}</span>
                <span className="shrink-0 w-9 text-right text-violet-600 dark:text-violet-400 tabular-nums" title="Similarity">
                  {Math.round(r.similarity * 100)}%
                </span>
              </>
            );
            const cls = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-800';
            return (
              <li key={r.id}>
                {onSelect ? (
                  <button type="button" onClick={() => onSelect(r.id)} className={cls}>{content}</button>
                ) : (
                  <Link to={`/notes/${r.id}`} className={cls}>{content}</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
