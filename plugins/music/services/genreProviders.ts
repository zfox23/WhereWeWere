/**
 * Music plugin — genres from MusicBrainz.
 *
 * MusicBrainz keeps community-voted genres on release groups (an album across
 * all its editions) and on artists. An album is found by searching its title
 * and artist, an artist by its name; the genres are read from a second,
 * by-id lookup. Pure mapping over an injected client, so tests never reach
 * the network.
 */

import { isVariantOf, normalizeTitle, plausibleTitle, rankCandidate, sameArtist } from './albumMatch';
import type { MusicBrainzGet } from './albumProviders';

export interface GenreMatch {
  /** The MusicBrainz id of the release group or artist the genres belong to. */
  mbid: string;
  /** Best first; empty when the entity is known but nobody has tagged it. */
  genres: string[];
}

export interface GenreProvider {
  album(q: { album: string; artist: string }): Promise<GenreMatch | null>;
  artist(name: string): Promise<GenreMatch | null>;
}

/** Genres kept per album or artist. */
export const MAX_GENRES = 6;
const MAX_GENRE_LENGTH = 60;
/** Search results whose genres are read before giving up on finding any. */
const LOOKUPS = 2;

/** A genre as stored: lower-case, single-spaced; null when empty or too long to be one. */
export function normalizeGenre(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const g = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return g && g.length <= MAX_GENRE_LENGTH ? g : null;
}

/** A list of genres as stored: normalised, de-duplicated, in the order given, at most `max`. */
export function cleanGenreList(raw: unknown, max = MAX_GENRES): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const g = normalizeGenre(v);
    if (g && !out.includes(g)) out.push(g);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The genres worth keeping from MusicBrainz's `genres` array: those with at
 * least a third of the top genre's votes, most votes first. A stray single
 * vote doesn't make a death-metal album "pop".
 */
export function pickGenres(raw: unknown): string[] {
  const voted = (Array.isArray(raw) ? raw : [])
    .map((g: any) => ({ name: normalizeGenre(g?.name), count: Number.isFinite(Number(g?.count)) ? Number(g.count) : 1 }))
    .filter((g): g is { name: string; count: number } => g.name !== null && g.count > 0);
  if (voted.length === 0) return [];
  const top = Math.max(...voted.map((g) => g.count));
  return cleanGenreList(
    voted
      .filter((g) => g.count >= Math.ceil(top / 3))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((g) => g.name),
  );
}

const credit = (c: any): string =>
  (Array.isArray(c?.['artist-credit']) ? c['artist-credit'] : []).map((a: any) => `${a?.name ?? ''}${a?.joinphrase ?? ''}`).join('');

export function musicBrainzGenres(get: MusicBrainzGet): GenreProvider {
  const esc = (s: string) => s.replace(/["\\]/g, ' ');

  /** The first of `ids` with genres; the first id with none when nobody tagged any. */
  async function firstWithGenres(kind: 'release-group' | 'artist', ids: string[]): Promise<GenreMatch | null> {
    if (ids.length === 0) return null;
    for (const id of ids.slice(0, LOOKUPS)) {
      const entity = await get(`/${kind}/${id}`, { inc: 'genres' });
      const genres = pickGenres(entity?.genres);
      if (genres.length > 0) return { mbid: id, genres };
    }
    return { mbid: ids[0], genres: [] };
  }

  return {
    async album({ album, artist }) {
      const found = await get('/release-group', {
        query: `releasegroup:"${esc(album)}" AND artist:"${esc(artist)}"`,
        limit: '10',
      });
      const played = { album, artist, titles: [] };
      const ids = (Array.isArray(found?.['release-groups']) ? found['release-groups'] : [])
        .filter((c: any) => plausibleTitle(album, String(c?.title ?? '')) && !isVariantOf(album, String(c?.title ?? '')))
        .filter((c: any) => sameArtist(artist, credit(c)) || /^various artists$/i.test(credit(c).trim()))
        // Stable: equally good candidates keep MusicBrainz's relevance order.
        .map((c: any, i: number) => ({ c, i, rank: rankCandidate(played, { title: String(c.title ?? ''), artist: credit(c) }) }))
        .sort((a: any, b: any) => b.rank - a.rank || a.i - b.i)
        .map(({ c }: any) => String(c.id));
      return firstWithGenres('release-group', ids);
    },

    async artist(name) {
      const found = await get('/artist', { query: `artist:"${esc(name)}"`, limit: '5' });
      const want = normalizeTitle(name);
      if (!want) return null;
      const ids = (Array.isArray(found?.artists) ? found.artists : [])
        .filter((c: any) =>
          [c?.name, ...(Array.isArray(c?.aliases) ? c.aliases.map((a: any) => a?.name) : [])].some(
            (n) => typeof n === 'string' && normalizeTitle(n) === want,
          ),
        )
        .map((c: any) => String(c.id));
      return firstWithGenres('artist', ids);
    },
  };
}
