import { Check, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS, MOOD_BG_COLORS } from './MoodIcons';
import { resolveActivityIcon } from '../utils/icons';
import type { TimelineItem, ImmichAsset, Scrobble } from '../types';
import { ScrobbleList } from './ScrobbleList';
import { CardShell } from './checkin-card/CardShell';
import { MarkdownNote } from './checkin-card/MarkdownNote';
import { PhotoSection } from './checkin-card/PhotoSection';
import { TimestampLink } from './checkin-card/TimestampLink';
import { useResolvedPhotos } from './checkin-card/useResolvedPhotos';

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
  const { pathname } = useLocation();
  const mood = item.mood || 3;
  const activities = item.activities || [];
  const resolvedAssets = useResolvedPhotos(item.id, immichUrl, photos);

  return (
    <CardShell>
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
          <MarkdownNote note={item.notes} collapsible />

          <PhotoSection
            immichUrl={immichUrl}
            assets={resolvedAssets}
            checkedInAt={item.checked_in_at}
          />

          {/* Scrobbles */}
          {scrobbles && <ScrobbleList scrobbles={scrobbles} checkedInAt={item.checked_in_at} malojaUrl={malojaUrl} />}

          {/* Timestamp */}
          <TimestampLink
            to={`/mood-checkins/${item.id}`}
            checkedInAt={item.checked_in_at}
            timezone={item.mood_timezone}
            mode={pathname === '/' ? 'time' : 'full'}
          />
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
    </CardShell>
  );
}
