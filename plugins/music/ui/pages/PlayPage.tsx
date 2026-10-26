/**
 * One play as a page of its own (/music/plays/:id): the song, when and how it
 * was recorded, your history with it, its place in its listening session, and
 * for a play with a place, note or companions, those too. Any play can be
 * corrected or deleted from here.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, CalendarDays, Clock, ListPlus, Loader2, MapPin, Pencil, Trash2, Users } from 'lucide-react';
import { BackButton } from '../../../../client/src/components/BackButton';
import { MarkdownNote } from '../../../../client/src/components/checkin-card/MarkdownNote';
import { immich as immichApi, settings } from '../../../../client/src/api/client';
import { formatDate, localDateKey } from '../../../../client/src/utils/checkin';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';
import MapView from '../../../location/ui/MapView';
import { albumArtUrl, music } from '../api';
import { AlbumLink } from '../AlbumLink';
import { formatDay, formatLength } from '../format';
import { ArtistLinks, libraryHref } from '../libraryLinks';
import { ListBadge, songItemKey } from '../ListBadge';
import { ListPicker } from '../ListPicker';
import { playPath } from '../listTitle';
import type { ImmichAsset } from '../../../../client/src/types';
import type { ScrobbleDetail, SessionNeighbour } from '../types';

const THUMB = 72;

/** Where a play came from, in words. */
export function sourceLabel(source: string | null): string {
  switch (source) {
    case 'manual':
      return 'Written down by hand';
    case 'multi-scrobbler':
      return 'Scrobbled by multi-scrobbler';
    case 'lastfm':
      return 'Imported from Last.fm';
    case 'import':
      return 'Imported';
    default:
      return 'Scrobbled';
  }
}

const ordinal = (n: number) => {
  const v = n % 100;
  const s = ['th', 'st', 'nd', 'rd'];
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function Neighbour({ play, direction }: { play: SessionNeighbour; direction: 'previous' | 'next' }) {
  const Icon = direction === 'previous' ? ArrowLeft : ArrowRight;
  return (
    <Link
      to={playPath(play.id)}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs hover:border-pink-300 dark:border-gray-700 ${
        direction === 'next' ? 'flex-row-reverse text-right' : ''
      }`}
    >
      <Icon size={14} className="shrink-0 text-gray-400" />
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wide text-gray-400">{direction === 'previous' ? 'Before' : 'After'}</span>
        <span className="block truncate font-medium text-gray-800 dark:text-gray-200">{play.title}</span>
        <span className="block truncate text-gray-500 dark:text-gray-400">{play.artists.join(', ')}</span>
      </span>
    </Link>
  );
}

export default function PlayPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [play, setPlay] = useState<ScrobbleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [photos, setPhotos] = useState<ImmichAsset[]>([]);
  usePageTitle(play ? `${play.title} by ${play.artists.join(', ')}` : 'Play');

  useEffect(() => {
    let cancelled = false;
    setPlay(null);
    setError(null);
    music
      .scrobble(id)
      .then((p) => !cancelled && setPlay(p))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load this play'));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    settings
      .get()
      .then((s) => setImmichUrl(s?.immich_url ? String(s.immich_url).replace(/\/+$/, '') : null))
      .catch(() => setImmichUrl(null));
  }, []);

  // Photos taken around the moment (the server resolves a play's id to its time).
  useEffect(() => {
    if (!immichUrl) return;
    immichApi
      .photosForCheckins([id])
      .then((data) => setPhotos(data[id] ?? []))
      .catch(() => setPhotos([]));
  }, [id, immichUrl]);

  const remove = async () => {
    if (!play || !window.confirm(`Delete “${play.title}” from your listening? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await music.deleteScrobble(play.id);
      navigate(-1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  if (error && !play) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6">
        <BackButton />
        <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!play) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  const day = localDateKey(play.played_at, play.timezone);
  const located = play.latitude !== null && play.longitude !== null;
  const itemKey = songItemKey(play.song_key);

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6">
      <BackButton />

      <div className="space-y-4 rounded-2xl border border-white/40 bg-white/60 p-6 dark:border-gray-700/40 dark:bg-gray-900/60">
        {play.art_id && (
          <img src={albumArtUrl(play.art_id, 'large')} alt={`${play.album ?? play.title} cover`} className="mx-auto aspect-square w-full max-w-xs rounded-xl object-cover shadow-sm" />
        )}

        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {play.title}
            <ListBadge itemKey={itemKey} size={14} />
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300"><ArtistLinks artists={play.artists} /></p>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            <AlbumLink albumRef={play.album_ref}>{play.album ?? undefined}</AlbumLink>
            {play.track_length ? ` · ${formatLength(play.track_length)}` : ''}
          </p>
          <div className="relative mt-2">
            <button type="button" onClick={() => setPicking((v) => !v)} className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs">
              <ListPlus size={14} />
              Add to list
            </button>
            {picking && (
              <div className="absolute left-0 top-full z-20 mt-1">
                <ListPicker target={{ kind: 'song', song_key: play.song_key, album_ref: play.album_ref }} label={play.title} onClose={() => setPicking(false)} />
              </div>
            )}
          </div>
        </div>

        {play.note && <MarkdownNote note={play.note} />}

        {play.companions.length > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
            <Users size={14} className="text-gray-400" />
            <span>With {play.companions.join(', ')}</span>
          </div>
        )}

        <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <Clock size={14} />
            <time dateTime={play.played_at}>{formatDate(play.played_at, play.timezone)}</time>
            <Link
              to={`/?from=${day}&to=${day}`}
              aria-label="View this day on Home"
              title="View this day on Home"
              className="inline-flex items-center justify-center rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-primary-400"
            >
              <CalendarDays size={14} />
            </Link>
          </div>
          <p className="pl-6">
            {sourceLabel(play.source)}
            {play.listened_for ? ` · listened for ${formatLength(play.listened_for)}` : ''}
          </p>
        </div>

        <div className="space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300">
          <p>
            You’ve played this {play.history.plays.toLocaleString()} time{play.history.plays === 1 ? '' : 's'}
            {play.history.plays > 1 ? <span className="text-gray-500 dark:text-gray-400"> · first {formatDay(play.history.first_played_at)}, last {formatDay(play.history.last_played_at)}</span> : null}
          </p>
          <Link to={libraryHref('songs', play.title)} className="text-xs font-medium text-primary-600 hover:underline">Show in library</Link>
        </div>

        {play.session && (
          <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {ordinal(play.session.position)} of {play.session.count} in this listening session
            </p>
            {(play.session.previous || play.session.next) && (
              <div className="flex gap-2">
                {play.session.previous ? <Neighbour play={play.session.previous} direction="previous" /> : <span className="flex-1" />}
                {play.session.next ? <Neighbour play={play.session.next} direction="next" /> : <span className="flex-1" />}
              </div>
            )}
            <Link
              to={{ pathname: '/', search: `?from=${play.session.date}&to=${play.session.date}` }}
              state={{ focusSession: play.session.id }}
              className="text-xs font-medium text-primary-600 hover:underline"
            >
              View this session on Home
            </Link>
          </div>
        )}

        {immichUrl && photos.length > 0 && (
          <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
            <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <Camera size={14} />
              <span className="font-medium">Photos</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {photos.map((asset) => (
                <a
                  key={asset.id}
                  href={`${immichUrl}/photos/${asset.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 overflow-hidden rounded-lg transition-all hover:ring-2 hover:ring-primary-400"
                >
                  <img src={immichApi.thumbnailUrl(asset.id)} alt={asset.originalFileName} width={THUMB} height={THUMB} className="object-cover" style={{ width: THUMB, height: THUMB }} loading="lazy" />
                </a>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
          <Link to={`/music-check-in?edit=${play.id}`} className="btn-secondary flex items-center gap-2 text-sm">
            <Pencil size={14} /> Edit
          </Link>
          <button type="button" onClick={() => void remove()} disabled={deleting} className="btn-danger flex items-center gap-2 text-sm">
            {deleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
            Delete
          </button>
        </div>
      </div>

      {located && (
        <div className="overflow-hidden rounded-2xl border border-white/40 bg-white/60 shadow-sm shadow-black/3 dark:border-gray-700/40 dark:bg-gray-900/60">
          <p className="flex items-center gap-1.5 px-4 pt-3 text-sm text-gray-500 dark:text-gray-400">
            <MapPin size={14} />
            Where I heard it{play.location_accuracy ? ` (within about ${play.location_accuracy} m)` : ''}
          </p>
          <MapView
            center={[Number(play.latitude), Number(play.longitude)]}
            zoom={15}
            markers={[{ lat: Number(play.latitude), lng: Number(play.longitude), label: play.title, id: play.id }]}
            className="mt-2 h-72 w-full"
          />
        </div>
      )}
    </div>
  );
}
