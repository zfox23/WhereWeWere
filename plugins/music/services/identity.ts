/**
 * Music plugin — what makes two plays "the same song" or "the same album".
 *
 * Built in SQL, and only in SQL, so the library's grouping, list membership
 * and the album modal can never disagree. The client treats the results as
 * opaque strings: `song_key` and `album_ref` on rows, handed back unchanged.
 */

/**
 * Album identity of a play: its generated `album_key` ("album|first album
 * artist"), or, for a play with no album, "|artist" (the "Unknown album" of
 * that artist).
 */
export const albumRefSql = (alias = '') =>
  `COALESCE(${alias}album_key, '|' || lower(btrim(COALESCE(${alias}album_artists[1], ${alias}artists[1], ''))))`;

/**
 * Song identity of a play: its title (without a trailing "(feat. X)" credit or
 * remaster tag) and first artist, so one song written differently by Spotify
 * and Last.fm is still one song. It is the generated `song_key` column (see
 * migration 065), which is also indexed.
 */
export const songKeySql = (alias = '') => `${alias}song_key`;

/** The artists of a group of plays of one song: the fullest credit seen (an array of names). */
export const fullestArtistsSql = (alias = '') =>
  `(ARRAY_AGG(to_jsonb(${alias}artists) ORDER BY cardinality(${alias}artists) DESC, ${alias}played_at DESC))[1]`;

/** The spelling of a song's title used most recently. */
export const latestTitleSql = (alias = '') => `(ARRAY_AGG(${alias}title ORDER BY ${alias}played_at DESC))[1]`;

/** The same two as list-item keys. */
export const songItemKeySql = (alias = '') => `('song:' || ${songKeySql(alias)})`;
export const albumItemKeySql = (alias = '') => `('album:' || ${albumRefSql(alias)})`;

export const UNKNOWN_ALBUM = 'Unknown album';
