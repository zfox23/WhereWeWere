/**
 * Music plugin — deciding whether a catalog release is the album a user
 * played. Pure functions; the providers feed them candidates.
 *
 * A wrong cover is worse than none, so a candidate is only accepted when its
 * title agrees and its tracklist contains something the user actually played.
 */

export interface ReleaseTrack {
  position: number;
  title: string;
  /** Seconds. */
  length: number | null;
}

export interface AlbumMatch {
  provider: 'deezer' | 'musicbrainz';
  externalId: string;
  title: string;
  artist: string;
  releaseDate: string | null;
  label: string | null;
  tracks: ReleaseTrack[];
  /** ~250px image, stored (resized) for thumbnails. */
  thumbUrl: string | null;
  /** Full-size image, fetched when the modal opens. */
  largeUrl: string | null;
}

/** Edition and remaster decorations that don't change which song or album it is. */
const EDITION_WORDS =
  'remaster(?:ed)?|deluxe|expanded|anniversary|edition|bonus|version|mono|stereo|single|explicit|clean';
const BRACKETED = new RegExp(`\\s*[\\(\\[][^\\)\\]]*\\b(?:${EDITION_WORDS})\\b[^\\)\\]]*[\\)\\]]`, 'gi');
const DASHED = new RegExp(`\\s+-\\s+(?:\\d{4}\\s+)?(?:${EDITION_WORDS})\\b.*$`, 'i');

/** "(feat. X)" credits, which catalogs and scrobblers disagree about. */
const FEATURING = /\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]/gi;

export function normalizeTitle(title: string): string {
  return title
    .replace(BRACKETED, '')
    .replace(FEATURING, '')
    .replace(DASHED, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sameArtist(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  return x !== '' && y !== '' && (x === y || x.includes(y) || y.includes(x));
}

/** How many of the played titles appear on the release. */
export function trackOverlap(playedTitles: string[], tracks: ReleaseTrack[]): number {
  const onRelease = new Set(tracks.map((t) => normalizeTitle(t.title)));
  const played = new Set(playedTitles.map(normalizeTitle));
  let n = 0;
  for (const t of played) if (t && onRelease.has(t)) n++;
  return n;
}

export interface Played {
  album: string;
  artist: string;
  titles: string[];
}

/**
 * Accept a release for what was played: the album title must agree after
 * normalisation and at least one played track must be on it. A different
 * title is tolerated only when the tracklist overlaps heavily (three or more
 * tracks and at least 75% of those played).
 */
export function acceptsRelease(played: Played, release: { title: string; tracks: ReleaseTrack[] }): boolean {
  const overlap = trackOverlap(played.titles, release.tracks);
  if (overlap < 1) return false;
  if (normalizeTitle(release.title) === normalizeTitle(played.album)) return true;
  const distinct = new Set(played.titles.map(normalizeTitle)).size;
  return overlap >= 3 && overlap / distinct >= 0.75;
}

/** Cheap pre-filter on search results, before spending a request on the tracklist. */
export function plausibleTitle(played: string, candidate: string): boolean {
  const a = normalizeTitle(played);
  const b = normalizeTitle(candidate);
  return a === b || (a.length >= 4 && (b.includes(a) || a.includes(b)));
}

/** Mixes, live sets and the like are different albums even when the name contains the played one. */
const VARIANT = /\b(?:dj mix|mixed|live|continuous|karaoke|tribute|instrumental)\b/i;

export function isVariantOf(playedAlbum: string, candidate: string): boolean {
  return VARIANT.test(candidate) && !VARIANT.test(playedAlbum);
}

/** Higher is better: exact title and artist first, so loose matches only use leftover verification budget. */
export function rankCandidate(played: Played, candidate: { title: string; artist: string }): number {
  return (
    (normalizeTitle(candidate.title) === normalizeTitle(played.album) ? 2 : 0) +
    (normalizeTitle(candidate.artist) === normalizeTitle(played.artist) ? 1 : 0)
  );
}
