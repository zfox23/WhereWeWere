import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { immich as immichApi } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS, MOOD_BG_COLORS } from './MoodIcons';
import { resolveActivityIcon } from '../utils/icons';
import type { TimelineItem, ImmichAsset, Scrobble } from '../types';
import { formatDate, buildImmichTimeUrl } from '../utils/checkin';
import { PhotoStrip } from './PhotoStrip';
import { ScrobbleList } from './ScrobbleList';

interface MoodCheckInCardProps {
  item: TimelineItem;
  iconPack?: string;
  immichUrl?: string | null;
  photos?: ImmichAsset[] | null;
  scrobbles?: Scrobble[];
  malojaUrl?: string | null;
}

function renderIcon(iconName?: string): React.ReactNode {
  if (!iconName) return null;
  const IconComponent = resolveActivityIcon(iconName);
  if (!IconComponent) return null;
  return <IconComponent size={14} className="flex-shrink-0 text-current" />;
}

export default function MoodCheckInCard({ item, iconPack = 'emoji', immichUrl, photos, scrobbles, malojaUrl }: MoodCheckInCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isLong, setIsLong] = useState(false);
  const [selfFetchedAssets, setSelfFetchedAssets] = useState<ImmichAsset[] | null>(null);
  const noteRef = useRef<HTMLParagraphElement | null>(null);
  const mood = item.mood || 3;
  const activities = item.activities || [];
  const note = item.notes;

  useEffect(() => {
    if (photos !== undefined) return;
    if (!immichUrl) return;
    let cancelled = false;
    immichApi.photos(item.id).then((data) => {
      if (!cancelled) setSelfFetchedAssets(data.assets);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.id, immichUrl, photos]);

  useEffect(() => {
    if (!note || expanded || !noteRef.current) {
      if (!note) setIsLong(false);
      return;
    }

    const el = noteRef.current;
    const checkOverflow = () => {
      setIsLong(el.scrollHeight > el.clientHeight + 1);
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    return () => observer.disconnect();
  }, [note, expanded]);

  const resolvedAssets = photos !== undefined ? photos : selfFetchedAssets;
  const hasPhotos = resolvedAssets && resolvedAssets.length > 0;
  const showInTime = immichUrl && resolvedAssets === null;
  const showImmichRow = hasPhotos || showInTime;

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
              <p
                ref={noteRef}
                className={`text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap ${!expanded ? 'line-clamp-3' : ''}`}
              >
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

          {/* Immich photo thumbnails */}
          {immichUrl && hasPhotos && (
            <PhotoStrip
              assets={resolvedAssets!}
              moreUrl={buildImmichTimeUrl(immichUrl, item.checked_in_at)}
              immichUrl={immichUrl}
            />
          )}

          {/* Immich links */}
          {showImmichRow && showInTime && (
            <div className="flex items-center gap-2 mt-2 text-indigo-600 dark:text-indigo-300">
                <a
                  href={buildImmichTimeUrl(immichUrl!, item.checked_in_at)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-medium hover:text-indigo-800 dark:hover:text-indigo-500"
                >
                  in time
                </a>
            </div>
          )}

          {/* Scrobbles */}
          {scrobbles && <ScrobbleList scrobbles={scrobbles} checkedInAt={item.checked_in_at} malojaUrl={malojaUrl} />}

          {/* Timestamp */}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            <Link
              to={`/mood-checkins/${item.id}`}
              className="text-sm text-gray-500 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
              title="View details"
            >
              <time dateTime={item.checked_in_at}>
                {formatDate(item.checked_in_at, item.mood_timezone)}
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
