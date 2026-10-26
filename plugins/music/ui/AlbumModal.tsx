/**
 * Album details: the cover and release info when a catalog match exists, the
 * tracklist with the user's own play counts, and buttons to put the album or a
 * song on a list. Works for any album the user has played, matched or not
 * (plays with no album gather under "Unknown album" per artist).
 *
 * Rendered in a portal so it isn't clipped by (or clickable through to) the
 * card or row it was opened from.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Heart, ListPlus, Loader2, X } from 'lucide-react';
import { albumArtUrl, music } from './api';
import { formatDuration } from './format';
import { ListBadge, albumItemKey, songItemKey } from './ListBadge';
import { ListPicker } from './ListPicker';
import { jumpToLibrary, libraryHref } from './libraryLinks';
import { useMusicLists } from './useMusicLists';
import type { AlbumView, ListTarget } from './types';

function trackLength(seconds: number | null): string {
  if (seconds == null) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** "2011-06-14" -> "Jun 14, 2011"; partial dates ("2011", "2011-06") are shown as they are. */
export function releaseDateLabel(date: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
  );
}

const onMusicProfile = () =>
  window.location.pathname === '/profile' && new URLSearchParams(window.location.search).get('tab') === 'plugin:music';

export function AlbumModal({
  albumRef,
  artId,
  onClose,
}: {
  albumRef?: string | null;
  artId?: string | null;
  onClose: () => void;
}) {
  const [album, setAlbum] = useState<AlbumView | null>(null);
  const [error, setError] = useState(false);
  const [picker, setPicker] = useState<{ target: ListTarget; label: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { has } = useMusicLists();

  useEffect(() => {
    let cancelled = false;
    music
      .albumView({ ref: albumRef, artId })
      .then((a) => !cancelled && setAlbum(a))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [albumRef, artId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const date = releaseDateLabel(album?.release_date ?? null);
  const totalSeconds = album?.tracks.reduce((sum, t) => sum + (t.length ?? 0), 0) ?? 0;
  const unknown = album?.album_ref.startsWith('|') ?? false;

  const showInLibrary = () => {
    if (!album) return;
    // An album is filtered by name; an "Unknown album" has none, so by its artist's songs.
    const view = unknown ? 'songs' : 'albums';
    const q = unknown ? album.artist : album.title;
    if (onMusicProfile()) {
      jumpToLibrary(view, q);
      onClose();
    } else {
      window.open(libraryHref(view, q), '_blank', 'noopener,noreferrer');
    }
  };

  return createPortal(
    // Portals bubble through the React tree, so swallow clicks here.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={album ? `${album.title} by ${album.artist}` : 'Album details'}
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-900 ${
          album?.art_id ? 'max-w-3xl sm:flex-row' : 'max-w-xl'
        }`}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`absolute right-2 top-2 z-10 rounded-full p-1.5 ${
            album?.art_id ? 'bg-black/40 text-white hover:bg-black/60' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          <X size={16} />
        </button>
        {album?.art_id && (
          <img
            src={albumArtUrl(album.art_id, 'large')}
            alt={`${album.title} cover`}
            className="aspect-square w-full shrink-0 object-cover sm:w-72"
          />
        )}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-red-500">Couldn't load this album.</p>}
          {!album && !error && <Loader2 size={20} className="animate-spin text-primary-600" />}
          {album && (
            <>
              <h2 className="pr-8 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {album.title}<ListBadge itemKey={albumItemKey(album.album_ref)} size={14} />
              </h2>
              {album.artist && <p className="text-sm text-gray-600 dark:text-gray-300">{album.artist}</p>}
              {(date || album.label) && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{[date, album.label].filter(Boolean).join(' · ')}</p>
              )}
              <p className="mt-2 text-sm font-medium text-pink-700 dark:text-pink-300">
                {album.plays.toLocaleString()} scrobble{album.plays === 1 ? '' : 's'}
                {album.listened_seconds > 0 && (
                  <span className="font-normal text-gray-500 dark:text-gray-400"> · {formatDuration(album.listened_seconds)} listened</span>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {!unknown && (
                  <button
                    type="button"
                    onClick={() => setPicker({ target: { kind: 'album', album_ref: album.album_ref }, label: album.title })}
                    className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs"
                  >
                    <ListPlus size={14} />
                    {has(albumItemKey(album.album_ref)) ? 'On a list' : 'Add album to list'}
                  </button>
                )}
                <button type="button" onClick={showInLibrary} className="btn-secondary !px-2.5 !py-1 text-xs">
                  Show in library
                </button>
              </div>
              <ol className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
                {album.tracks.map((t, i) => (
                  <li key={`${t.position ?? 'x'}-${t.title}-${i}`} className="flex items-baseline gap-2 py-1">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-400">{t.position ?? ''}</span>
                    <span className={`min-w-0 flex-1 truncate ${t.plays ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      {t.title}<ListBadge itemKey={songItemKey(t.song_key)} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">{trackLength(t.length)}</span>
                    <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-pink-600 dark:text-pink-400">
                      {t.plays ? `${t.plays}x` : ''}
                    </span>
                    {t.song_key ? (
                      <button
                        type="button"
                        aria-label={`Add ${t.title} to a list`}
                        onClick={() =>
                          setPicker({ target: { kind: 'song', song_key: t.song_key as string, album_ref: album.album_ref }, label: t.title })
                        }
                        className="shrink-0 self-center rounded p-0.5 text-gray-400 hover:text-pink-500"
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
                  {album.tracks.length} tracks · {formatDuration(totalSeconds)}
                </p>
              )}
            </>
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
    </div>,
    document.body,
  );
}
