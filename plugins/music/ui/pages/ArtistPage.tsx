/**
 * One artist as a page of its own (/music/artist?name=…): every play crediting
 * them, as the library's Artists view counts them. Totals and rank, streaks
 * and peaks, plays over time, their songs and albums, when in the day and week
 * they're played, and the companions, places and moods they're played around.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Disc3, Loader2, Music } from 'lucide-react';
import { BackButton } from '../../../../client/src/components/BackButton';
import { useScrollRestoration } from '../../../../client/src/hooks/useScrollRestoration';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';
import { music } from '../api';
import { AlbumArt } from '../AlbumArt';
import { formatDay, formatDuration } from '../format';
import { libraryHref } from '../libraryLinks';
import { ArtistLinks, SongLink } from '../links';
import { GenreChips, GenreEditor } from '../GenreChips';
import { ListBadge, songItemKey } from '../ListBadge';
import { ChartCard } from '../insights/ChartCard';
import { ClockCard } from '../insights/ListeningClock';
import { PlaysOverTime } from '../insights/PlaysOverTime';
import { StreaksAndPeaks } from '../insights/StreaksAndPeaks';
import { TiesCard } from '../insights/TiesCard';
import type { Bucket } from '../insights/timeline';
import type { ArtistDetail } from '../types';
import { AlbumGrid } from './AlbumGrid';
import { SpotifyButton } from '../SpotifyButton';

const SONGS_COLLAPSED = 15;
const BUCKETS: Bucket[] = ['week', 'month', 'year'];

export default function ArtistPage() {
  const [params, setParams] = useSearchParams();
  const name = params.get('name') ?? '';
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState(false);
  usePageTitle(name ? `Artist: ${name}` : 'Artist');

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setError(false);
    music
      .artist(name)
      .then((a) => !cancelled && setArtist(a))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [name]);

  const current = artist?.name === name ? artist : null;
  useScrollRestoration(current != null || error);
  const bucket: Bucket = BUCKETS.includes(params.get('bucket') as Bucket) ? (params.get('bucket') as Bucket) : 'month';
  // In the URL (replaced), so Back from a song shows the same rows.
  const allSongs = params.get('songs') === 'all';
  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value == null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  if (!name) {
    return (
      <div className="space-y-4">
        <BackButton />
        <p className="text-sm text-gray-500">No artist was given.</p>
      </div>
    );
  }

  const songs = current ? (allSongs ? current.songs : current.songs.slice(0, SONGS_COLLAPSED)) : [];
  const maxSong = Math.max(...(current?.songs.map((s) => s.plays) ?? [1]), 1);
  // Credits beyond this artist (features, collaborations).
  const others = (credits: string[]) => credits.filter((a) => a !== name);

  return (
    <div className="space-y-4">
      <BackButton />
      {error && <p className="text-sm text-red-500">Couldn't load this artist.</p>}
      {!current && !error && <Loader2 size={20} className="animate-spin text-primary-600" />}
      {current && (
        <>
          <header>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{current.name}</h1>
            <p className="mt-1 text-sm">
              <span className="font-medium text-pink-700 dark:text-pink-300">
                {current.plays.toLocaleString()} play{current.plays === 1 ? '' : 's'}
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {` · ${current.unique_songs.toLocaleString()} song${current.unique_songs === 1 ? '' : 's'}`}
                {current.listened_seconds > 0 && ` · ${formatDuration(current.listened_seconds)} listened`}
                {` · first ${formatDay(current.first_played_at)} · last ${formatDay(current.last_played_at)}`}
              </span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <Link to={libraryHref('songs', current.name)} className="text-xs font-medium text-primary-600 hover:underline">
                Show in library
              </Link>
              <SpotifyButton target={{ kind: 'artist', name: current.name }} />
            </div>
            <GenreEditor
              key={current.name}
              kind="artist"
              itemRef={current.name}
              value={current.genres}
              onSaved={(genres) => setArtist((a) => (a ? { ...a, genres } : a))}
            />
            {/* What their plays actually count as: albums with genres of their own use those. */}
            {current.play_genres.length > 0 &&
              current.play_genres.map((g) => g.name).join('|') !== current.genres.genres.join('|') && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Across their plays:</span>
                  <GenreChips genres={current.play_genres} max={8} label="Genres across their plays" />
                </div>
              )}
          </header>

          <StreaksAndPeaks daily={current.daily} rank={current.rank} rankOf={current.artists_total} rankNoun="artists" />

          <PlaysOverTime
            daily={current.daily}
            bucket={bucket}
            onBucketChange={(b) => setParam('bucket', b === 'month' ? null : b)}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title="Songs" icon={Music}>
              <ol className="space-y-2" aria-label="Songs">
                {songs.map((s, i) => (
                  <li key={s.song_key} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-gray-900 dark:text-gray-100">
                        <span className="tabular-nums text-gray-400">{i + 1}.</span>
                        <AlbumArt artId={s.art_id} albumRef={s.album_ref} size={24} />
                        <span className="min-w-0 truncate">
                          <SongLink songKey={s.song_key}>{s.name}</SongLink>
                          <ListBadge itemKey={songItemKey(s.song_key)} />
                          {others(s.artists).length > 0 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {' · with '}
                              <ArtistLinks artists={others(s.artists)} />
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-500">{s.plays}</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-gray-100 dark:bg-gray-800">
                      <div className="h-1 rounded-full bg-pink-400/80" style={{ width: `${(s.plays / maxSong) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
              {current.songs.length > SONGS_COLLAPSED && (
                <button type="button" onClick={() => setParam('songs', allSongs ? null : 'all')} className="mt-3 text-xs font-medium text-primary-600 hover:underline">
                  {allSongs ? 'Show fewer' : `Show ${current.songs.length - SONGS_COLLAPSED} more`}
                </button>
              )}
            </ChartCard>
            <ChartCard title="Albums" icon={Disc3}>
              {current.albums.length === 0 ? (
                <p className="text-xs text-gray-500">No plays with an album.</p>
              ) : (
                <AlbumGrid albums={current.albums} />
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ClockCard cells={current.clock} title="When you play them" emptyText="No plays yet." withTotals />
            <TiesCard scope={{ artist: name }} />
          </div>
        </>
      )}
    </div>
  );
}
