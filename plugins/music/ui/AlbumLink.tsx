/**
 * An album name that opens the album's details. Works for any album, matched
 * or not; `albumRef` is the opaque identity from the row. Plays with no album
 * read "Unknown album".
 */

import { useState, type ReactNode } from 'react';
import { AlbumModal } from './AlbumModal';
import { UNKNOWN_ALBUM } from './format';

export function AlbumLink({ albumRef, children }: { albumRef: string | null | undefined; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (albumRef == null) return <>{children ?? UNKNOWN_ALBUM}</>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Show album details"
        className="text-left hover:underline decoration-dotted underline-offset-2"
      >
        {children ?? UNKNOWN_ALBUM}
      </button>
      {open && <AlbumModal albumRef={albumRef} onClose={() => setOpen(false)} />}
    </>
  );
}
