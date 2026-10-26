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

/** Song identity of a play: its title and artists, as the library groups them. */
export const songKeySql = (alias = '') =>
  `(lower(btrim(${alias}title)) || chr(31) || lower(array_to_string(${alias}artists, chr(31))))`;

/** The same two as list-item keys. */
export const songItemKeySql = (alias = '') => `('song:' || ${songKeySql(alias)})`;
export const albumItemKeySql = (alias = '') => `('album:' || ${albumRefSql(alias)})`;

export const UNKNOWN_ALBUM = 'Unknown album';
