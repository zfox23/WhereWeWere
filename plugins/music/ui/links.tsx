/**
 * Where songs, artists, albums and genres open: each has a page of its own, so a
 * click is an ordinary navigation (Back returns to where it was clicked,
 * middle-click opens a new tab).
 *
 * The links stop their click from bubbling: they sit inside cards and rows
 * that have click actions of their own.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** An album's page, identified by its ref or, failing that, its cover. */
export function albumPath(id: { albumRef?: string | null; artId?: string | null }): string {
  const params = new URLSearchParams();
  if (id.albumRef != null) params.set('ref', id.albumRef);
  else if (id.artId) params.set('art_id', id.artId);
  return `/music/album?${params}`;
}

export const songPath = (songKey: string): string => `/music/song?${new URLSearchParams({ key: songKey })}`;

export const artistPath = (name: string): string => `/music/artist?${new URLSearchParams({ name })}`;

export const genrePath = (name: string): string => `/music/genre?${new URLSearchParams({ name })}`;

export const LINK_CLASS = 'hover:underline decoration-dotted underline-offset-2';

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** A song's title opening its page; plain text without a key. */
export function SongLink({ songKey, children, className = LINK_CLASS }: { songKey: string | null | undefined; children: ReactNode; className?: string }) {
  if (!songKey) return <span>{children}</span>;
  return (
    <Link to={songPath(songKey)} onClick={stop} className={className}>
      {children}
    </Link>
  );
}

export function ArtistLink({ name, children, className = LINK_CLASS }: { name: string; children?: ReactNode; className?: string }) {
  return (
    <Link to={artistPath(name)} onClick={stop} title={`Show ${name}`} className={className}>
      {children ?? name}
    </Link>
  );
}

/** Artists as individual links, comma separated. */
export function ArtistLinks({ artists }: { artists: string[] | null | undefined }) {
  return (
    <>
      {(artists ?? []).map((a, i) => (
        <span key={`${a}-${i}`}>
          {i > 0 && ', '}
          <ArtistLink name={a} />
        </span>
      ))}
    </>
  );
}

export function GenreLink({ name, children, className = LINK_CLASS }: { name: string; children?: ReactNode; className?: string }) {
  return (
    <Link to={genrePath(name)} onClick={stop} title={`Show the genre ${name}`} className={className}>
      {children ?? name}
    </Link>
  );
}
