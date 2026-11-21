/**
 * Links into Profile > Music > Library, filtered to one artist, song or album
 * ("Show in library" on the album and artist pages).
 */

import type { MusicLibraryView } from './types';

/** URL of the Music profile's Library subtab filtered to `q` (the library is all-time). */
export function libraryHref(view: MusicLibraryView, q: string): string {
  const params = new URLSearchParams({ tab: 'plugin:music', musicSection: 'library' });
  if (view !== 'songs') params.set('musicView', view);
  params.set('q', q);
  return `/profile?${params}`;
}
