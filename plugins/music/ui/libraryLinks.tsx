/**
 * Links into Profile > Music > Library, filtered to one artist, song or album.
 *
 * From the Home timeline they open the Library subtab in a new tab. From the
 * Music profile they switch to the Library subtab and filter it in place.
 */

import type { MouseEvent, ReactNode } from 'react';
import type { MusicLibraryView } from './types';

/** URL of the Music profile's Library subtab filtered to `q` (the library is all-time). */
export function libraryHref(view: MusicLibraryView, q: string): string {
  const params = new URLSearchParams({ tab: 'plugin:music', musicSection: 'library' });
  if (view !== 'songs') params.set('musicView', view);
  params.set('q', q);
  return `/profile?${params}`;
}

/** The current Music profile URL with the library set to `view` and `q`. */
function inPageUrl(view: MusicLibraryView, q: string): URL {
  const url = new URL(window.location.href);
  url.searchParams.set('musicSection', 'library');
  if (view === 'songs') url.searchParams.delete('musicView');
  else url.searchParams.set('musicView', view);
  // Sort columns differ per view; start from the defaults.
  url.searchParams.delete('sort');
  url.searchParams.delete('dir');
  url.searchParams.set('q', q);
  return url;
}

/** Filter the library on this page and bring it into view. */
export function jumpToLibrary(view: MusicLibraryView, q: string): void {
  const url = inPageUrl(view, q);
  window.history.pushState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  // The tab and the library both re-read the URL on popstate.
  window.dispatchEvent(new PopStateEvent('popstate'));
  setTimeout(() => document.getElementById('music-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

const LINK = 'hover:underline decoration-dotted underline-offset-2';

/** Opens the library in a new tab; safe inside rows that have a click action of their own. */
export function HomeLibraryLink({ view, q, children }: { view: MusicLibraryView; q: string; children: ReactNode }) {
  return (
    <a
      href={libraryHref(view, q)}
      target="_blank"
      rel="noopener noreferrer"
      title={`Show ${q} in your music library`}
      onClick={(e) => e.stopPropagation()}
      className={LINK}
    >
      {children}
    </a>
  );
}

/** Artists as individual links, comma separated. */
export function ArtistLinks({ artists }: { artists: string[] }) {
  return (
    <>
      {artists.map((a, i) => (
        <span key={`${a}-${i}`}>
          {i > 0 && ', '}
          <HomeLibraryLink view="artists" q={a}>{a}</HomeLibraryLink>
        </span>
      ))}
    </>
  );
}

/** Same-page link for the Music profile's top lists. */
export function ProfileLibraryLink({ view, q, children }: { view: MusicLibraryView; q: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks (new tab/window) use the href.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    jumpToLibrary(view, q);
  };
  const url = inPageUrl(view, q);
  return (
    <a href={`${url.pathname}${url.search}`} onClick={onClick} title={`Show ${q} in the library below`} className={LINK}>
      {children}
    </a>
  );
}
