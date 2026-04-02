import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS, MOOD_BG_COLORS } from './MoodIcons';
import { resolveActivityIcon } from '../utils/icons';
import type { TimelineItem } from '../types';

interface MoodCheckInCardProps {
  item: TimelineItem;
  iconPack?: string;
}

function renderIcon(iconName?: string): React.ReactNode {
  if (!iconName) return null;
  const IconComponent = resolveActivityIcon(iconName);
  if (!IconComponent) return null;
  return <IconComponent size={14} className="flex-shrink-0 text-current" />;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export default function MoodCheckInCard({ item, iconPack = 'emoji' }: MoodCheckInCardProps) {
  const [expanded, setExpanded] = useState(false);
  const mood = item.mood || 3;
  const activities = item.activities || [];
  const note = item.notes;
  const isLong = note ? note.length > 200 : false;

  return (
    <div className={`bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4 hover:shadow-md transition-all`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Mood header */}
          <div className="flex items-center gap-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${MOOD_BG_COLORS[mood]}`}>
              <MoodIcon mood={mood} pack={iconPack} size={20} />
            </div>
            <span className={`text-base font-semibold ${MOOD_COLORS[mood]}`}>
              {MOOD_LABELS[mood]}
            </span>
          </div>

          {/* Activities */}
          {activities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {activities.map((act) => (
                <span
                  key={act.id}
                  className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 flex items-center gap-1"
                >
                  {act.icon && renderIcon(act.icon)}
                  {act.name}
                </span>
              ))}
            </div>
          )}

          {/* Note (truncated to 3 lines) */}
          {note && (
            <div className="mt-2">
              <p className={`text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap ${!expanded && isLong ? 'line-clamp-3' : ''}`}>
                {note}
              </p>
              {isLong && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-0.5 mt-1 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                >
                  {expanded ? (
                    <>Show less <ChevronUp size={12} /></>
                  ) : (
                    <>Read more <ChevronDown size={12} /></>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <Link
              to={`/mood-checkins/${item.id}`}
              className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              title="View details"
            >
              <time dateTime={item.checked_in_at}>
                {formatDate(item.checked_in_at)}
              </time>
            </Link>
          </div>
        </div>

        {/* Edit button */}
        <div className="flex items-center gap-1 shrink-0">
          <Link
            to={`/mood-check-in?edit=${item.id}`}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}
