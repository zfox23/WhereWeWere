import { Link } from 'react-router-dom';
import type { TimelineItem } from '../types';
import Stars from './Stars';
import { MarkdownNote } from './checkin-card/MarkdownNote';
import { TimestampLink } from './checkin-card/TimestampLink';
import { MEDIA_SUBTYPES, CHECKIN_TYPE_LABELS } from '../utils/media';
import { slugify } from '../utils/slugify';

interface MediaCardProps {
  item: TimelineItem;
}

export default function MediaCard({ item }: MediaCardProps) {
  const subtype = item.media_type || 'movie';
  const config = MEDIA_SUBTYPES[subtype] || MEDIA_SUBTYPES.movie;
  const isTv = subtype === 'tv_show';
  const epLabel = isTv && item.media_season_number != null
    ? `S${item.media_season_number}E${item.media_episode_number ?? '?'}${item.media_episode_title ? ` · ${item.media_episode_title}` : ''}`
    : null;

  const detailHref = item.media_item_id
    ? `${config.detailBase}/${item.media_item_id}/${item.media_slug || slugify(item.media_title || '')}`
    : config.searchPath;

  const badge =
    item.media_checkin_type === 'completed'
      ? { label: CHECKIN_TYPE_LABELS.completed, cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' }
      : item.media_checkin_type === 'dropped'
        ? { label: CHECKIN_TYPE_LABELS.dropped, cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
        : { label: CHECKIN_TYPE_LABELS.in_progress, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };

  return (
    <div className="bg-white/70 dark:bg-gray-900/70 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="flex gap-3">
        <Link to={detailHref} className="shrink-0 group">
          {item.media_image_url ? (
            <img
              src={item.media_image_url}
              alt=""
              className="w-12 h-16 object-cover rounded-lg shadow-sm group-hover:ring-2 group-hover:ring-primary-400 transition-shadow"
              loading="lazy"
            />
          ) : (
            <div className="w-12 h-16 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xl">
              {config.icon}
            </div>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-violet-600 dark:text-violet-400 uppercase tracking-wide">
                  {config.label}
                </span>
                <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <Link
                to={detailHref}
                className="block font-semibold text-gray-900 dark:text-gray-100 truncate hover:text-primary-600 dark:hover:text-primary-400"
              >
                {item.media_title || 'Untitled'}
              </Link>
              {item.media_author && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.media_author}</p>
              )}
              {epLabel && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{epLabel}</p>
              )}
            </div>
            {item.media_rating != null && item.media_rating > 0 && (
              <Stars value={item.media_rating} />
            )}
          </div>
          {item.notes && (
            <div className="mt-1">
              <MarkdownNote note={item.notes} collapsible />
            </div>
          )}
        </div>
      </div>
      <TimestampLink
        to={detailHref}
        checkedInAt={item.checked_in_at}
        timezone={item.media_timezone}
        mode="time"
      />
    </div>
  );
}
