/**
 * Music timeline card: one listening session (see the server's
 * `buildTimelineSelect`). Expands to the tracks played in the session.
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Music } from 'lucide-react';
import type { CheckinCardProps } from 'wwp-shared';
import { CardShell } from '../../../client/src/components/checkin-card/CardShell';
import { music } from './api';
import { formatClock, formatDuration, joinArtists } from './format';
import type { MusicSessionData, SessionTrack } from './types';

function artistSummary(artists: string[], trackCount: number): string {
  const shown = artists.slice(0, 3).join(', ');
  const more = artists.length > 3 ? `, +${artists.length - 3}` : '';
  return `${trackCount} track${trackCount === 1 ? '' : 's'}${shown ? ` · ${shown}${more}` : ''}`;
}

export function MusicCard({ item, compact = false }: CheckinCardProps) {
  const data = (item.data ?? {}) as MusicSessionData;
  const startedAt = data.started_at || item.checked_in_at;
  const endedAt = data.ended_at || item.checked_in_at;
  const timezone = item.timezone || 'UTC';
  const trackCount = data.track_count ?? 0;
  const topArtists = data.top_artists ?? [];

  const [expanded, setExpanded] = useState(false);
  const [tracks, setTracks] = useState<SessionTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tracks === null && !loading) {
      setLoading(true);
      setError(false);
      music
        .sessionTracks(item.id)
        .then(setTracks)
        .catch(() => setError(true))
        .finally(() => setLoading(false));
    }
  };

  const range = `${formatClock(startedAt, timezone)} – ${formatClock(endedAt, timezone)}`;

  return (
    <CardShell compact={compact}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="w-full flex items-start gap-2 text-left"
      >
        <Music size={compact ? 14 : 16} className="text-pink-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-pink-700 dark:text-pink-300`}>
              Listening {range}
            </span>
            {data.listened_seconds ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatDuration(data.listened_seconds)}</span>
            ) : null}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{artistSummary(topArtists, trackCount)}</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-2 pl-6">
          {loading && <Loader2 size={14} className="animate-spin text-primary-600" />}
          {error && <p className="text-xs text-red-500">Couldn't load tracks.</p>}
          {tracks && (
            <ol className="space-y-0.5">
              {tracks.map((t, i) => (
                <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex gap-2">
                  <span className="tabular-nums shrink-0">{formatClock(t.played_at, t.timezone || timezone)}</span>
                  <span>
                    <span className="font-medium text-gray-600 dark:text-gray-300">{joinArtists(t.artists)}</span>
                    {' — '}
                    {t.title}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </CardShell>
  );
}
