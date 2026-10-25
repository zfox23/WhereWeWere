import { tmdb } from './tmdb';
import { normalizeTitle } from './titleMatch';

// ============================================================================
// Identity resolution for Plex media.scrobble webhooks.
//
// Plex's current agents use plex:// guids; the TMDB/TVDB/IMDb ids live in the
// Metadata.Guid[] array. For an episode that array describes the EPISODE, not
// the show, and the show's own external ids are never in the payload — so a
// show's TMDB id has to be looked up (via /find from an episode's tvdb/imdb
// id, else by title search).
// ============================================================================

export interface PlexExternalIds {
  tmdb: string | null;
  tvdb: string | null;
  imdb: string | null;
}

export interface ResolvedTmdbItem {
  externalId: string;
  title: string;
  releaseYear: number | null;
  imageUrl: string | null;
  externalUrl: string;
}

/** Collect tmdb/tvdb/imdb ids from a Metadata.Guid[] array (and legacy guid strings). */
export function parsePlexGuids(guids: unknown, ...extraGuidStrings: unknown[]): PlexExternalIds {
  const ids: PlexExternalIds = { tmdb: null, tvdb: null, imdb: null };
  const entries: string[] = [];
  if (Array.isArray(guids)) {
    for (const g of guids) {
      const id = g && typeof g === 'object' ? (g as { id?: unknown }).id : null;
      if (typeof id === 'string') entries.push(id);
    }
  }
  for (const g of extraGuidStrings) if (typeof g === 'string') entries.push(g);
  for (const entry of entries) {
    const m = entry.match(/^(tmdb|tvdb|imdb):\/\/(.+)$/);
    if (!m) continue;
    const [, scheme, id] = m;
    if (scheme === 'imdb' ? /^tt\d+$/.test(id) : /^\d+$/.test(id)) {
      ids[scheme as keyof PlexExternalIds] ??= id;
    }
  }
  return ids;
}

/** Split Plex's "Bluey (2018)" disambiguation suffix into a title and year hint. */
export function splitTitleYear(title: string): { title: string; year: number | null } {
  const m = title.match(/^(.*\S)\s+\((\d{4})\)$/);
  return m ? { title: m[1], year: parseInt(m[2], 10) } : { title, year: null };
}

/** Resolve a movie's TMDB identity from its Plex Guid[] ids. */
export async function resolvePlexMovie(apiKey: string | null, tmdbId: string): Promise<ResolvedTmdbItem | null> {
  const d = await tmdb.getMovieDetails(apiKey, tmdbId);
  if (!d) return null;
  return {
    externalId: tmdbId,
    title: d.title,
    releaseYear: d.releaseYear,
    imageUrl: d.imageUrl,
    externalUrl: `https://www.themoviedb.org/movie/${tmdbId}`,
  };
}

/**
 * Resolve a show's TMDB identity from one of its episodes' Plex ids and the
 * show title. Returns null when nothing can be resolved with confidence
 * (callers fall back to a title-only item).
 */
export async function resolvePlexShow(
  apiKey: string | null,
  episodeIds: PlexExternalIds,
  showTitle: string
): Promise<ResolvedTmdbItem | null> {
  if (!apiKey) return null;

  let showId: string | null = null;
  if (episodeIds.tvdb) showId = await tmdb.findShowId(apiKey, 'tvdb_id', episodeIds.tvdb);
  if (!showId && episodeIds.imdb) showId = await tmdb.findShowId(apiKey, 'imdb_id', episodeIds.imdb);
  if (showId) {
    const d = await tmdb.getTvShowDetails(apiKey, showId);
    if (d) {
      return {
        externalId: showId,
        title: d.title,
        releaseYear: d.releaseYear,
        imageUrl: d.imageUrl,
        externalUrl: `https://www.themoviedb.org/tv/${showId}`,
      };
    }
  }

  // Title search: only an exact normalized-title match counts (TMDB ranks by
  // popularity, so the first exact hit is the best guess); a "(YYYY)" suffix
  // narrows to the matching first-air year.
  const { title, year } = splitTitleYear(showTitle);
  const results = await tmdb.searchTv(apiKey, title);
  if (!results) return null;
  const key = normalizeTitle(title);
  const exact = results.filter((r) => normalizeTitle(r.title) === key);
  const pick = (year != null ? exact.find((r) => r.releaseYear === year) : exact[0]) ?? null;
  return pick;
}
