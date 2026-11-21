/**
 * A tiny album cover that opens the album's page. Music without a cover (no
 * album, no match, or an image that fails to load) shows nothing.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { albumArtUrl } from './api';
import { albumPath } from './links';

export function AlbumArt({ artId, albumRef, size = 24 }: { artId?: string | null; albumRef?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (!artId || failed) return null;
  return (
    <Link
      to={albumPath({ albumRef, artId })}
      aria-label="Show album"
      // Rows and cards around a cover are links or toggles of their own.
      onClick={(e) => e.stopPropagation()}
      className="inline-block shrink-0 rounded hover:ring-2 hover:ring-pink-400 focus-visible:ring-2 focus-visible:ring-pink-400 transition-shadow"
      style={box}
    >
      <img
        src={albumArtUrl(artId)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="rounded object-cover"
        style={box}
      />
    </Link>
  );
}
