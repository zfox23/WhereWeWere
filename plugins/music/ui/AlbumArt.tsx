/**
 * A tiny album cover. Clicking it opens the album's details; without a cover it
 * leaves a quiet placeholder so rows stay aligned.
 */

import { useState } from 'react';
import { albumArtUrl } from './api';
import { AlbumModal } from './AlbumModal';

export function AlbumArt({ artId, size = 24 }: { artId?: string | null; size?: number }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (!artId || failed) {
    return <span aria-hidden="true" className="inline-block shrink-0 rounded bg-gray-200/60 dark:bg-gray-700/50" style={box} />;
  }
  return (
    <>
      <button
        type="button"
        aria-label="Show album details"
        // Rows and cards around a cover are links or toggles of their own.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
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
      </button>
      {open && <AlbumModal artId={artId} onClose={() => setOpen(false)} />}
    </>
  );
}
