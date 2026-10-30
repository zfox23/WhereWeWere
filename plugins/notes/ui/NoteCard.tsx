/**
 * Note timeline card: bold title, colored tag chips, and the markdown body
 * (collapsible). The typed payload arrives in `item.data` (built by the
 * plugin's timeline branch); the body and companions are envelope columns.
 */

import { NotebookPen, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { CheckinCardProps } from 'wwp-shared';
import { CardShell } from '../../../client/src/components/checkin-card/CardShell';
import { MarkdownNote } from '../../../client/src/components/checkin-card/MarkdownNote';
import { TimestampLink } from '../../../client/src/components/checkin-card/TimestampLink';
import { CompanionName } from '../../../client/src/components/CompanionName';
import { normalizeTimezoneForDisplay } from '../../../client/src/utils/checkin';
import type { NoteTag } from './api';
import { TagChip, tagTimelinePath } from './TagChip';

interface NoteData {
  title?: string | null;
  tags?: NoteTag[];
  word_count?: number;
  truncated?: boolean;
}

export function NoteCard({ item, compact = false }: CheckinCardProps) {
  const { pathname } = useLocation();
  const data = (item.data ?? {}) as NoteData;
  const timezone = normalizeTimezoneForDisplay(item.timezone) || item.timezone || 'UTC';
  const detailTo = `/notes/${item.id}`;
  const tags = data.tags ?? [];
  const companions = (item as { companions?: string[] | null }).companions ?? [];
  const body = (item as { notes?: string | null }).notes ?? '';
  const heading = data.title || 'Note';

  if (compact) {
    return (
      <CardShell compact>
        <div className="flex items-center gap-2 min-w-0">
          <NotebookPen size={14} className="text-amber-500 shrink-0" />
          <Link to={detailTo} className="text-sm font-semibold text-amber-700 dark:text-amber-300 truncate">
            {heading}
          </Link>
          {tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} />)}
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <NotebookPen size={16} className="text-amber-500 shrink-0" />
          <Link
            to={detailTo}
            className="text-base font-bold text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 transition-colors"
          >
            {heading}
          </Link>
          {tags.map((t) => <TagChip key={t.id} tag={t} to={tagTimelinePath(t.name)} />)}
        </div>

        {companions.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
            <Users size={13} className="text-gray-400 shrink-0" />
            {companions.map((name) => <CompanionName key={name} name={name} />)}
          </p>
        )}

        {body && (
          <div className="mt-1">
            <MarkdownNote note={body} collapsible />
            {data.truncated && (
              <Link to={detailTo} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                Continue reading ({(data.word_count ?? 0).toLocaleString()} words)
              </Link>
            )}
          </div>
        )}

        <div className="mt-2">
          <TimestampLink
            to={detailTo}
            checkedInAt={item.checked_in_at}
            timezone={timezone}
            mode={pathname === '/' ? 'time' : 'full'}
            classNameOverride=""
          />
        </div>
      </div>
    </CardShell>
  );
}
