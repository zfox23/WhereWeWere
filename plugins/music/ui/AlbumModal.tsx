/**
 * Album details: the full-size cover, release info and tracklist with the
 * user's own play counts. Rendered in a portal so it isn't clipped by (or
 * clickable through to) the card or row it was opened from.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { albumArtUrl, music } from './api';
import { formatDuration } from './format';
import type { AlbumDetail } from './types';

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

export function AlbumModal({ artId, onClose }: { artId: string; onClose: () => void }) {
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    music.album(artId).then((a) => !cancelled && setAlbum(a)).catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [artId]);

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
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-900 sm:flex-row"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1.5 text-white hover:bg-black/60"
        >
          <X size={16} />
        </button>
        <img
          src={albumArtUrl(artId, 'large')}
          alt={album ? `${album.title} cover` : 'Album cover'}
          className="aspect-square w-full shrink-0 object-cover sm:w-72"
        />
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {error && <p className="text-sm text-red-500">Couldn't load this album.</p>}
          {!album && !error && <Loader2 size={20} className="animate-spin text-primary-600" />}
          {album && (
            <>
              <h2 className="pr-8 text-lg font-semibold text-gray-900 dark:text-gray-100">{album.title}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">{album.artist}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {[date, album.label].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-2 text-sm font-medium text-pink-700 dark:text-pink-300">
                {album.plays.toLocaleString()} scrobble{album.plays === 1 ? '' : 's'}
                {album.listened_seconds > 0 && (
                  <span className="font-normal text-gray-500 dark:text-gray-400"> · {formatDuration(album.listened_seconds)} listened</span>
                )}
              </p>
              <ol className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
                {album.tracks.map((t) => (
                  <li key={t.position} className="flex items-baseline gap-2 py-1">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-gray-400">{t.position}</span>
                    <span className={`min-w-0 flex-1 truncate ${t.plays ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      {t.title}
                    </span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">{trackLength(t.length)}</span>
                    <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-pink-600 dark:text-pink-400">
                      {t.plays ? `${t.plays}x` : ''}
                    </span>
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
      </div>
    </div>,
    document.body,
  );
}
