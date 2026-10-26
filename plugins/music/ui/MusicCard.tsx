/**
 * Music timeline card: one listening session (see the server's
 * `buildTimelineSelect`). Expands to the tracks played in the session, newest first.
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown, ChevronUp, Loader2, Music } from 'lucide-react';
import type { CheckinCardProps } from 'wwp-shared';
import { CardShell } from '../../../client/src/components/checkin-card/CardShell';
import { music } from './api';
import { AlbumArt } from './AlbumArt';
import { ArtistLinks, HomeLibraryLink } from './libraryLinks';
import { formatClock, formatDuration } from './format';
import type { MusicSessionData, SessionTrack } from './types';

/** How long the jump highlight stays on the card. */
const HIGHLIGHT_MS = 2500;

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
  const [highlighted, setHighlighted] = useState(false);

  const loadTracks = () => {
    if (tracks !== null || loading) return;
    setLoading(true);
    setError(false);
    music
      .sessionTracks(item.id)
      .then(setTracks)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadTracks();
  };

  // Another card's music preview links here with `focusSession` in the
  // router state: open this session and flash a ring around it.
  const focusSession = (useLocation().state as { focusSession?: string } | null)?.focusSession;
  const focused = focusSession === item.id;
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!focused) return;
    setExpanded(true);
    loadTracks();
    setHighlighted(true);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlighted(false), HIGHLIGHT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  // Deliberately outlives `focused`: Home clears the router state a moment
  // after the jump, which must not cut the highlight short.
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const range = `${formatClock(startedAt, timezone)} – ${formatClock(endedAt, timezone, true)}`;

  return (
    <div
      className={`${compact ? 'rounded-xl' : 'rounded-2xl'} transition-shadow duration-500 ${
        highlighted ? 'ring-2 ring-pink-400 shadow-lg shadow-pink-400/30' : ''
      }`}
      data-highlighted={highlighted ? 'true' : undefined}
    >
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
                  <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <AlbumArt artId={t.art_id} size={24} />
                    <span className="tabular-nums shrink-0">{formatClock(t.played_at, t.timezone || timezone, true)}</span>
                    <span>
                      <span className="font-medium text-gray-600 dark:text-gray-300"><ArtistLinks artists={t.artists} /></span>
                      {' — '}
                      <HomeLibraryLink view="songs" q={t.title}>{t.title}</HomeLibraryLink>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </CardShell>
    </div>
  );
}
