/**
 * A tiny album cover. Clicking it opens the album's details (middle-click or ctrl-click for its own page in a new tab). Music without a
 * cover (no album, no match, or an image that fails to load) shows nothing.
 */

import { useState } from 'react';
import { albumArtUrl } from './api';
import { AlbumModal, albumPageHref } from './AlbumModal';

export function AlbumArt({ artId, albumRef, size = 24 }: { artId?: string | null; albumRef?: string | null; size?: number }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (!artId || failed) return null;
  return (
    <>
      <a
        href={albumPageHref({ albumRef, artId })}
        aria-label="Show album details"
        // Rows and cards around a cover are links or toggles of their own.
        onClick={(e) => {
          e.stopPropagation();
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
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
      </a>
      {open && <AlbumModal artId={artId} albumRef={albumRef} onClose={() => setOpen(false)} />}
    </>
  );
}
