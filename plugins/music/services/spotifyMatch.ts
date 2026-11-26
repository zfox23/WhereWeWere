/**
 * Music plugin — picking the Spotify track, album or artist that is the same
 * music as the user's plays, from Spotify search results. Pure functions.
 *
 * A candidate is only accepted when its name agrees and one of its artists is
 * the play's first artist; anything less gets a Spotify search link instead,
 * so the Open in Spotify button never opens the wrong music.
 */

/** Lower-cased, accents and punctuation removed, "&" as "and", credits and remaster tags dropped. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // "(feat. X)", "[with X]"
    .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/g, '')
    // "(2011 Remaster)", "[Remastered]"
    .replace(/\s*[([][^)\]]*remaster[^)\]]*[)\]]/g, '')
    // "Song - Remastered 2011", "Song - 2011 Remaster"
    .replace(/\s+-\s+(\d{4}\s+)?remaster.*$/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Looser than normalizeName: also drops any bracketed part and " - …" suffix
 * ("(Deluxe Edition)", " - Radio Edit"). Only used when nothing agrees exactly.
 */
export function looseName(text: string): string {
  const stripped = text.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+.*$/, '');
  return normalizeName(stripped || text);
}

interface Named {
  name?: unknown;
}

export interface TrackCandidate {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  artists?: Named[];
  album?: Named;
}

export interface AlbumCandidate {
  id?: unknown;
  name?: unknown;
  album_type?: unknown;
  artists?: Named[];
}

export interface ArtistCandidate {
  id?: unknown;
  name?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const hasId = (c: { id?: unknown }): c is { id: string } => typeof c.id === 'string' && c.id.length > 0;

function creditsArtist(candidate: { artists?: Named[] }, artist: string): boolean {
  const want = normalizeName(artist);
  return !!want && (candidate.artists ?? []).some((a) => normalizeName(str(a?.name)) === want);
}

/** The first candidate `accept`s at the strictest level that has one, preferring `bonus` within a level. */
function pick<T extends { id?: unknown }>(
  candidates: T[],
  levels: ((c: T) => boolean)[],
  bonus: (c: T) => boolean = () => false,
): string | null {
  for (const accept of levels) {
    const ok = candidates.filter((c) => hasId(c) && accept(c));
    const best = ok.find(bonus) ?? ok[0];
    if (best) return best.id as string;
  }
  return null;
}

/** The Spotify track that is this song, or null. */
export function pickTrack(candidates: TrackCandidate[], want: { title: string; artist: string; album?: string | null }): string | null {
  const title = normalizeName(want.title);
  const loose = looseName(want.title);
  const album = want.album ? normalizeName(want.album) : null;
  return pick(
    candidates.filter((c) => c && (c.type === undefined || c.type === 'track') && creditsArtist(c, want.artist)),
    [(c) => normalizeName(str(c.name)) === title, (c) => !!loose && looseName(str(c.name)) === loose],
    (c) => album !== null && normalizeName(str(c.album?.name)) === album,
  );
}

/** The Spotify album that is this album, or null. Full albums win over compilations of the same name. */
export function pickAlbum(candidates: AlbumCandidate[], want: { album: string; artist: string }): string | null {
  const title = normalizeName(want.album);
  const loose = looseName(want.album);
  return pick(
    candidates.filter((c) => c && creditsArtist(c, want.artist)),
    [(c) => normalizeName(str(c.name)) === title, (c) => !!loose && looseName(str(c.name)) === loose],
    (c) => c.album_type === 'album',
  );
}

/** The Spotify artist with exactly this name, or null. */
export function pickArtist(candidates: ArtistCandidate[], name: string): string | null {
  const want = normalizeName(name);
  return pick(candidates.filter(Boolean), [(c) => !!want && normalizeName(str(c.name)) === want]);
}

/** A value for a Spotify search field filter: no quotes, no "(feat. X)". */
export function searchTerm(text: string): string {
  return text
    .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, '')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
