/**
 * An album as a page of its own (/music/album?ref=… or ?art_id=…): the cover
 * and release info when a catalog match exists, the tracklist with your plays
 * of each track (each opening its song's page), plays over time, and the
 * artist's other albums you've played. Works for any album you've played,
 * matched or not (plays with no album gather under "Unknown album" per artist).
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Disc3, Heart, ListPlus, Loader2 } from 'lucide-react';
import { BackButton } from '../../../../client/src/components/BackButton';
import { useScrollRestoration } from '../../../../client/src/hooks/useScrollRestoration';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';
import { albumArtUrl, music } from '../api';
import { formatDay, formatDuration, formatLength } from '../format';
import { libraryHref } from '../libraryLinks';
import { ArtistLink, SongLink } from '../links';
import { ListBadge, albumItemKey, songItemKey } from '../ListBadge';
import { ListPicker } from '../ListPicker';
import { useMusicLists } from '../useMusicLists';
import { ChartCard } from '../insights/ChartCard';
import { PlaysOverTime } from '../insights/PlaysOverTime';
import type { Bucket } from '../insights/timeline';
import type { AlbumView, ListTarget } from '../types';
import { AlbumGrid } from './AlbumGrid';

/** "2011-06-14" -> "Jun 14, 2011"; partial dates ("2011", "2011-06") are shown as they are. */
export function releaseDateLabel(date: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
  );
}

const BUCKETS: Bucket[] = ['week', 'month', 'year'];

export default function AlbumPage() {
  const [params, setParams] = useSearchParams();
  const ref = params.get('ref');
  const artId = ref === null ? params.get('art_id') : null;
  const id = `${ref ?? ''}|${artId ?? ''}`;
  const [album, setAlbum] = useState<(AlbumView & { id: string }) | null>(null);
  const [error, setError] = useState(false);
  const [picker, setPicker] = useState<{ target: ListTarget; label: string } | null>(null);
  const { has } = useMusicLists();
  usePageTitle(album ? `Album: ${album.title}` : 'Album');

  useEffect(() => {
    if (ref === null && !artId) return;
    let cancelled = false;
    setError(false);
    setPicker(null);
    music
      .albumView({ ref, artId })
      .then((a) => !cancelled && setAlbum({ ...a, id }))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [ref, artId, id]);

  const current = album?.id === id ? album : null;
  useScrollRestoration(current != null || error);
  const bucket: Bucket = BUCKETS.includes(params.get('bucket') as Bucket) ? (params.get('bucket') as Bucket) : 'month';

  if (ref === null && !artId) {
    return (
      <div className="space-y-4">
        <BackButton />
        <p className="text-sm text-gray-500">No album was given.</p>
      </div>
    );
  }

  const date = releaseDateLabel(current?.release_date ?? null);
  const totalSeconds = current?.tracks.reduce((sum, t) => sum + (t.length ?? 0), 0) ?? 0;
  const unknown = current?.album_ref.startsWith('|') ?? false;
  const maxTrack = Math.max(...(current?.tracks.map((t) => t.plays) ?? [1]), 1);

  return (
    <div className="space-y-4">
      <BackButton />
      {error && <p className="text-sm text-red-500">Couldn't load this album.</p>}
      {!current && !error && <Loader2 size={20} className="animate-spin text-primary-600" />}
      {current && (
        <>
          <div
            className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/40 bg-white/60 shadow-sm shadow-black/3 dark:border-gray-700/40 dark:bg-gray-900/60 ${
              current.art_id ? 'sm:flex-row' : ''
            }`}
          >
            {current.art_id && (
              // Its own box, aligned to the top: a stretched flex item would grow to
              // the tracklist's height and crop the cover's sides.
              <div className="w-full shrink-0 sm:w-64 sm:self-start md:w-80 lg:w-96">
                <img src={albumArtUrl(current.art_id, 'large')} alt={`${current.title} cover`} className="aspect-square w-full object-contain" />
              </div>
            )}
            <div className="min-w-0 flex-1 p-4">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {current.title}
                <ListBadge itemKey={albumItemKey(current.album_ref)} size={14} />
              </h1>
              {current.artist && (
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  <ArtistLink name={current.artist} />
                </p>
              )}
              {(date || current.label) && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{[date, current.label].filter(Boolean).join(' · ')}</p>
              )}
              <p className="mt-2 text-sm">
                <span className="font-medium text-pink-700 dark:text-pink-300">
                  {current.plays.toLocaleString()} scrobble{current.plays === 1 ? '' : 's'}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {current.listened_seconds > 0 && ` · ${formatDuration(current.listened_seconds)} listened`}
                  {current.first_played_at && current.last_played_at &&
                    ` · first ${formatDay(current.first_played_at)} · last ${formatDay(current.last_played_at)}`}
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {!unknown && (
                  <button
                    type="button"
                    onClick={() => setPicker({ target: { kind: 'album', album_ref: current.album_ref }, label: current.title })}
                    className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs"
                  >
                    <ListPlus size={14} />
                    {has(albumItemKey(current.album_ref)) ? 'On a list' : 'Add album to list'}
                  </button>
                )}
                <Link
                  // An album is filtered by name; an "Unknown album" has none, so by its artist's songs.
                  to={unknown ? libraryHref('songs', current.artist) : libraryHref('albums', current.title)}
                  className="btn-secondary !px-2.5 !py-1 text-xs"
                >
                  Show in library
                </Link>
              </div>
              <ol className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800" aria-label="Tracks">
                {current.tracks.map((t, i) => (
                  <li key={`${t.position ?? 'x'}-${t.title}-${i}`} className="flex items-center gap-2 py-1">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-400">{t.position ?? ''}</span>
                    <span className={`min-w-0 flex-1 truncate ${t.plays ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      <SongLink songKey={t.song_key}>{t.title}</SongLink>
                      <ListBadge itemKey={songItemKey(t.song_key)} />
                    </span>
                    {/* This track's plays against the album's most played track. */}
                    <span className="hidden w-20 shrink-0 sm:block md:w-28" aria-hidden>
                      <span className="block h-1.5 rounded-full bg-gray-100 dark:bg-gray-800">
                        {t.plays > 0 && (
                          <span className="block h-1.5 rounded-full bg-pink-400/80" style={{ width: `${(t.plays / maxTrack) * 100}%` }} />
                        )}
                      </span>
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">{formatLength(t.length)}</span>
                    <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-pink-600 dark:text-pink-400">
                      {t.plays ? `${t.plays}x` : ''}
                    </span>
                    {t.song_key ? (
                      <button
                        type="button"
                        aria-label={`Add ${t.title} to a list`}
                        onClick={() =>
                          setPicker({ target: { kind: 'song', song_key: t.song_key as string, album_ref: current.album_ref }, label: t.title })
                        }
                        className="shrink-0 rounded p-0.5 text-gray-400 hover:text-pink-500"
                      >
                        <Heart size={13} fill={has(songItemKey(t.song_key)) ? 'currentColor' : 'none'} />
                      </button>
                    ) : (
                      <span className="w-[17px] shrink-0" />
                    )}
                  </li>
                ))}
              </ol>
              {totalSeconds > 0 && (
                <p className="mt-2 text-right text-xs text-gray-400">
                  {current.tracks.length} tracks · {formatDuration(totalSeconds)}
                </p>
              )}
            </div>
            {picker && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4" onClick={() => setPicker(null)}>
                <div onClick={(e) => e.stopPropagation()}>
                  <ListPicker target={picker.target} label={picker.label} onClose={() => setPicker(null)} />
                </div>
              </div>
            )}
          </div>

          {current.daily.length > 0 && (
            <PlaysOverTime
              daily={current.daily}
              bucket={bucket}
              onBucketChange={(b) =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    if (b === 'month') next.delete('bucket');
                    else next.set('bucket', b);
                    return next;
                  },
                  { replace: true, preventScrollReset: true },
                )
              }
            />
          )}

          {current.other_albums.length > 0 && (
            <ChartCard title={`More by ${current.artist}`} icon={Disc3}>
              <AlbumGrid albums={current.other_albums} wide />
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
