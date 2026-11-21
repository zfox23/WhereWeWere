/** Albums as covers with their names and play counts, each opening its page. */

import { Link } from 'react-router-dom';
import { Disc3 } from 'lucide-react';
import { albumArtUrl } from '../api';
import { albumPath } from '../links';
import type { ArtistAlbum } from '../types';

export function AlbumGrid({ albums, wide = false }: { albums: ArtistAlbum[]; wide?: boolean }) {
  return (
    <ul className={`grid grid-cols-3 gap-3 sm:grid-cols-4 ${wide ? 'md:grid-cols-6 lg:grid-cols-8' : ''}`} aria-label="Albums">
      {albums.map((a) => (
        <li key={a.album_ref} className="min-w-0">
          <Link to={albumPath({ albumRef: a.album_ref })} className="group block" title={a.name}>
            {a.art_id ? (
              <img
                src={albumArtUrl(a.art_id)}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded-lg object-cover shadow-sm group-hover:ring-2 group-hover:ring-pink-400"
              />
            ) : (
              <span className="flex aspect-square w-full items-center justify-center rounded-lg bg-gray-100 text-gray-400 group-hover:ring-2 group-hover:ring-pink-400 dark:bg-gray-800">
                <Disc3 size={24} />
              </span>
            )}
            <span className="mt-1 block truncate text-xs font-medium text-gray-900 group-hover:underline dark:text-gray-100">{a.name}</span>
          </Link>
          <span className="block text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
            {a.plays.toLocaleString()} play{a.plays === 1 ? '' : 's'} · {a.unique_tracks} track{a.unique_tracks === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  );
}
