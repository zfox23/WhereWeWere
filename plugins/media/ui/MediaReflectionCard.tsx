/**
 * Media "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'media'. The typed payload arrives in
 * `item.data` (built by the server's `reflectionBranch`).
 */

import { Link } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import type { PluginReflectionCardProps } from 'wwp-shared';
import type { MediaSubtype } from '../../../client/src/types';
import { slugify } from '../../../client/src/utils/slugify';
import { MEDIA_SUBTYPES, CHECKIN_TYPE_LABELS, detailPath } from '../utils/media';

interface MediaReflectionData {
  media_type?: string | null;
  media_item_id?: string | null;
  media_title?: string | null;
  rating?: number | null;
  checkin_type?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  episode_title?: string | null;
  checkin_timezone?: string | null;
}

function formatReflectionTime(dateStr: string, timeZone?: string | null) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(dateStr));
}

export function MediaReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as MediaReflectionData;
  const subtype = MEDIA_SUBTYPES[data.media_type as MediaSubtype];
  const title = data.media_title || 'Media check-in';
  const checkinLabel = data.checkin_type ? CHECKIN_TYPE_LABELS[data.checkin_type] : null;

  let episodeSuffix: string | null = null;
  if (data.season_number != null && data.episode_number != null) {
    const epTitle = data.episode_title ? ` "${data.episode_title}"` : '';
    episodeSuffix = ` S${data.season_number}:E${data.episode_number}${epTitle}`;
  }

  const detail =
    subtype && data.media_item_id
      ? detailPath(subtype.subtype, data.media_item_id, slugify(title))
      : null;

  return (
    <div className="text-xs space-y-0">
      <div className="flex flex-wrap items-center gap-2">
        {checkinLabel ? (
          <span className="font-semibold text-violet-700 dark:text-violet-300">{checkinLabel}</span>
        ) : null}
        {detail ? (
          <Link
            to={detail}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors inline-flex items-center gap-1"
          >
            <Clapperboard size={13} className="shrink-0" />
            {title}
            {episodeSuffix ? <span className="text-gray-500 dark:text-gray-400 font-normal">{episodeSuffix}</span> : null}
          </Link>
        ) : (
          <span className="font-medium text-violet-600 dark:text-violet-400 inline-flex items-center gap-1">
            <Clapperboard size={13} className="shrink-0" />
            {title}
            {episodeSuffix ? <span className="text-gray-500 dark:text-gray-400 font-normal">{episodeSuffix}</span> : null}
          </span>
        )}
      </div>
      {item.note ? (
        <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">
          {`"${item.note}"`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {detail ? (
          <Link
            to={detail}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
          >
            {formatReflectionTime(item.checked_in_at, data.checkin_timezone)}
          </Link>
        ) : (
          <span>{formatReflectionTime(item.checked_in_at, data.checkin_timezone)}</span>
        )}
      </div>
    </div>
  );
}
