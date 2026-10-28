import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Music } from 'lucide-react';
import { musicListening } from '../api/client';
import { AlbumArt } from '../../../plugins/music/ui/AlbumArt';
import { ArtistLinks, HomeLibraryLink } from '../../../plugins/music/ui/libraryLinks';
import type { ListeningBefore } from '../types';
import type { FocusSessionState } from './MusicPreview';

function minutesBefore(anchor: number, played: number): string {
  const minutes = Math.round((anchor - played) / 60);
  return minutes < 1 ? 'just before' : `${minutes} min before`;
}

/**
 * The songs played just before a check-in, in full (covers and how long
 * before), under its detail page. The timeline card shows a one-line version
 * (MusicPreview). Renders nothing when nothing was playing, or when the music
 * plugin is off.
 */
export function CheckinListening({ checkinId }: { checkinId: string }) {
  const [listening, setListening] = useState<ListeningBefore | null>(null);

  useEffect(() => {
    setListening(null);
    if (!checkinId) return;
    let cancelled = false;
    musicListening
      .around([checkinId])
      .then((data) => {
        if (!cancelled) setListening(data[checkinId] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [checkinId]);

  if (!listening || listening.tracks.length === 0) return null;
  const { session_id, session_date, anchor_time, tracks } = listening;
  const state: FocusSessionState = { focusSession: session_id };

  return (
    <section className="mx-auto mt-6 max-w-2xl rounded-2xl border border-white/40 dark:border-gray-700/40 bg-white/60 dark:bg-gray-900/60 shadow-sm shadow-black/3 p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-medium text-gray-500 dark:text-gray-400">
        <Music size={14} className="text-pink-500" />
        Playing just before
      </h2>
      <ul className="mt-3 space-y-2">
        {tracks.map((t) => (
          <li key={`${t.time}-${t.title}`} className="flex items-center gap-2.5 text-sm">
            <AlbumArt artId={t.art_id} albumRef={t.album_ref} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-gray-900 dark:text-gray-100">
                <HomeLibraryLink view="songs" q={t.title}>{t.title}</HomeLibraryLink>
              </span>
              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                <ArtistLinks artists={t.artists} />
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-gray-400">{minutesBefore(anchor_time, t.time)}</span>
          </li>
        ))}
      </ul>
      <Link
        to={{ pathname: '/', search: `?from=${session_date}&to=${session_date}` }}
        state={state}
        className="mt-3 inline-block text-xs text-pink-600 hover:underline dark:text-pink-400"
      >
        Show the whole listening session
      </Link>
    </section>
  );
}
