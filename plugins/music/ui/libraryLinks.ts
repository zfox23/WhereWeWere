/**
 * Links into Profile > Music > Library, filtered to one artist, song, album or genre
 * ("Show in library" on the album and artist pages).
 */

import type { MusicLibraryView } from './types';

/** URL of the Music profile's Library subtab filtered to `q` and, optionally, a genre (the library is all-time). */
export function libraryHref(view: MusicLibraryView, q: string, genre?: string): string {
  const params = new URLSearchParams({ tab: 'plugin:music', musicSection: 'library' });
  if (view !== 'songs') params.set('musicView', view);
  if (q) params.set('q', q);
  if (genre) params.set('genre', genre);
  return `/profile?${params}`;
}
