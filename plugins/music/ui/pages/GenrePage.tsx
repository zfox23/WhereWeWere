/**
 * One genre as a page of its own (/music/genre?name=…): every play that has
 * the genre (its album's, or its first artist's when the album has none).
 * Totals and rank, streaks and peaks, plays over time, its artists, songs and
 * albums, the genres it shares plays with, when in the day and week it's
 * played, and the companions, places and moods it's played around.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Disc3, Loader2, Mic2, Music, Tags } from 'lucide-react';
import { BackButton } from '../../../../client/src/components/BackButton';
import { useScrollRestoration } from '../../../../client/src/hooks/useScrollRestoration';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';
import { music } from '../api';
import { AlbumArt } from '../AlbumArt';
import { formatDay, formatDuration } from '../format';
import { GenreChips } from '../GenreChips';
import { libraryHref } from '../libraryLinks';
import { ArtistLink, ArtistLinks, SongLink } from '../links';
import { ListBadge, songItemKey } from '../ListBadge';
import { ChartCard } from '../insights/ChartCard';
import { ClockCard } from '../insights/ListeningClock';
import { PlaysOverTime } from '../insights/PlaysOverTime';
import { StreaksAndPeaks } from '../insights/StreaksAndPeaks';
import { TiesCard } from '../insights/TiesCard';
import type { Bucket } from '../insights/timeline';
import type { GenreDetail } from '../types';
import { AlbumGrid } from './AlbumGrid';

const COLLAPSED = 15;
const BUCKETS: Bucket[] = ['week', 'month', 'year'];
const s = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="mt-0.5 h-1 rounded-full bg-gray-100 dark:bg-gray-800">
      <div className="h-1 rounded-full bg-pink-400/80" style={{ width: `${(value / Math.max(max, 1)) * 100}%` }} />
    </div>
  );
}

export default function GenrePage() {
  const [params, setParams] = useSearchParams();
  const name = (params.get('name') ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const [genre, setGenre] = useState<GenreDetail | null>(null);
  const [error, setError] = useState<'missing' | 'failed' | null>(null);
  usePageTitle(name ? `Genre: ${name}` : 'Genre');

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setError(null);
    music
      .genre(name)
      .then((g) => !cancelled && setGenre(g))
      .catch((err) => !cancelled && setError(err?.status === 404 ? 'missing' : 'failed'));
    return () => {
      cancelled = true;
    };
  }, [name]);

  const current = genre?.name === name ? genre : null;
  useScrollRestoration(current != null || error != null);
  const bucket: Bucket = BUCKETS.includes(params.get('bucket') as Bucket) ? (params.get('bucket') as Bucket) : 'month';
  const allSongs = params.get('songs') === 'all';
  const allArtists = params.get('artists') === 'all';
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
        <p className="text-sm text-gray-500">No genre was given.</p>
      </div>
    );
  }

  const songs = current ? (allSongs ? current.songs : current.songs.slice(0, COLLAPSED)) : [];
  const artists = current ? (allArtists ? current.artists : current.artists.slice(0, COLLAPSED)) : [];

  return (
    <div className="space-y-4">
      <BackButton />
      {error === 'missing' && <p className="text-sm text-gray-500">None of your plays have the genre “{name}”.</p>}
      {error === 'failed' && <p className="text-sm text-red-500">Couldn't load this genre.</p>}
      {!current && !error && <Loader2 size={20} className="animate-spin text-primary-600" />}
      {current && (
        <>
          <header>
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-pink-600 dark:text-pink-400">
              <Tags size={13} /> Genre
            </p>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{current.name}</h1>
            <p className="mt-1 text-sm">
              <span className="font-medium text-pink-700 dark:text-pink-300">{s(current.plays, 'play')}</span>
              <span className="text-gray-500 dark:text-gray-400">
                {` · ${s(current.unique_songs, 'song')} · ${s(current.unique_artists, 'artist')}`}
                {current.listened_seconds > 0 && ` · ${formatDuration(current.listened_seconds)} listened`}
                {` · first ${formatDay(current.first_played_at)} · last ${formatDay(current.last_played_at)}`}
              </span>
            </p>
            <Link to={libraryHref('songs', '', current.name)} className="mt-1 inline-block text-xs font-medium text-primary-600 hover:underline">
              Show in library
            </Link>
            {current.related.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">Often with:</span>
                <GenreChips genres={current.related} label="Genres on the same plays" />
              </div>
            )}
          </header>

          <StreaksAndPeaks daily={current.daily} rank={current.rank} rankOf={current.genres_total} rankNoun="genres" />

          <PlaysOverTime daily={current.daily} bucket={bucket} onBucketChange={(b) => setParam('bucket', b === 'month' ? null : b)} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title="Artists" icon={Mic2}>
              <ol className="space-y-2" aria-label="Artists">
                {artists.map((a, i) => (
                  <li key={a.name} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-gray-900 dark:text-gray-100">
                        <span className="tabular-nums text-gray-400">{i + 1}.</span> <ArtistLink name={a.name} />
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-500">{a.plays}</span>
                    </div>
                    <Bar value={a.plays} max={current.artists[0]?.plays ?? 1} />
                  </li>
                ))}
              </ol>
              {current.artists.length > COLLAPSED && (
                <button type="button" onClick={() => setParam('artists', allArtists ? null : 'all')} className="mt-3 text-xs font-medium text-primary-600 hover:underline">
                  {allArtists ? 'Show fewer' : `Show ${current.artists.length - COLLAPSED} more`}
                </button>
              )}
            </ChartCard>
            <ChartCard title="Songs" icon={Music}>
              <ol className="space-y-2" aria-label="Songs">
                {songs.map((song, i) => (
                  <li key={song.song_key} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-gray-900 dark:text-gray-100">
                        <span className="tabular-nums text-gray-400">{i + 1}.</span>
                        <AlbumArt artId={song.art_id} albumRef={song.album_ref} size={24} />
                        <span className="min-w-0 truncate">
                          <SongLink songKey={song.song_key}>{song.name}</SongLink>
                          <ListBadge itemKey={songItemKey(song.song_key)} />
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {' · '}
                            <ArtistLinks artists={song.artists} />
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-gray-500">{song.plays}</span>
                    </div>
                    <Bar value={song.plays} max={current.songs[0]?.plays ?? 1} />
                  </li>
                ))}
              </ol>
              {current.songs.length > COLLAPSED && (
                <button type="button" onClick={() => setParam('songs', allSongs ? null : 'all')} className="mt-3 text-xs font-medium text-primary-600 hover:underline">
                  {allSongs ? 'Show fewer' : `Show ${current.songs.length - COLLAPSED} more`}
                </button>
              )}
            </ChartCard>
          </div>

          <ChartCard title="Albums" icon={Disc3}>
            {current.albums.length === 0 ? <p className="text-xs text-gray-500">No plays with an album.</p> : <AlbumGrid albums={current.albums} />}
          </ChartCard>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ClockCard cells={current.clock} title="When you play it" emptyText="No plays yet." withTotals />
            <TiesCard scope={{ genre: current.name }} />
          </div>
        </>
      )}
    </div>
  );
}
