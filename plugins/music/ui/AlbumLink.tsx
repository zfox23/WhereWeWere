/**
 * An album name that opens the album's details (middle-click or ctrl-click for its own page in a new tab). Works for any album, matched
 * or not; `albumRef` is the opaque identity from the row. Plays with no album
 * read "Unknown album".
 */

import { useState, type ReactNode } from 'react';
import { AlbumModal, albumPageHref } from './AlbumModal';
import { UNKNOWN_ALBUM } from './format';

export function AlbumLink({ albumRef, children }: { albumRef: string | null | undefined; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (albumRef == null) return <>{children ?? UNKNOWN_ALBUM}</>;
  return (
    <>
      <a
        href={albumPageHref({ albumRef })}
        onClick={(e) => {
          // A row or card around the name may have an action of its own.
          e.stopPropagation();
          // Modified clicks (new tab, new window) follow the link to the album's own page.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setOpen(true);
        }}
        title="Show album details"
        className="text-left hover:underline decoration-dotted underline-offset-2"
      >
        {children ?? UNKNOWN_ALBUM}
      </a>
      {open && <AlbumModal albumRef={albumRef} onClose={() => setOpen(false)} />}
    </>
  );
}
