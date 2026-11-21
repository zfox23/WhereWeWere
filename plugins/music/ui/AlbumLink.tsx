/**
 * An album name that opens the album's page. Works for any album, matched or
 * not; `albumRef` is the opaque identity from the row. Plays with no album
 * read "Unknown album".
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { UNKNOWN_ALBUM } from './format';
import { albumPath } from './links';

export function AlbumLink({ albumRef, children }: { albumRef: string | null | undefined; children?: ReactNode }) {
  if (albumRef == null) return <>{children ?? UNKNOWN_ALBUM}</>;
  return (
    <Link
      to={albumPath({ albumRef })}
      // A row or card around the name may have an action of its own.
      onClick={(e) => e.stopPropagation()}
      title="Show album"
      className="text-left hover:underline decoration-dotted underline-offset-2"
    >
      {children ?? UNKNOWN_ALBUM}
    </Link>
  );
}
