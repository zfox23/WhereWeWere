/**
 * Music plugin — which genres a play has, in SQL (and only in SQL, so the
 * Overview, the genre page, the Library filter and the song page can never
 * disagree).
 *
 * A play takes its album's genres (`music_genres` kind 'album', keyed by its
 * `album_key`); when the album has none, or the play has no album, it takes
 * its first artist's (kind 'artist', keyed by the lower-cased name). A user's
 * edit replaces the catalog's genres in `music_genres.genres`.
 */

/** An artist's key in `music_genres`, from a name expression. */
export const artistKeyOf = (nameSql: string) => `lower(btrim(COALESCE(${nameSql}, '')))`;

/** The key of a play's first artist; `alias` with its dot ("m."), or ''. */
export const firstArtistKeySql = (alias = '') => artistKeyOf(`${alias}artists[1]`);

/**
 * Joins that give each play of `m` (a table alias, no dot) its genres, and
 * the expression reading them (a text[], empty when the play has none).
 * `p` prefixes the joined aliases so two uses in one query don't collide.
 */
export function playGenres(m: string, p = 'pg') {
  return {
    join: `
      LEFT JOIN music_genres ${p}_al
        ON ${p}_al.user_id = ${m}.user_id AND ${p}_al.kind = 'album' AND ${p}_al.item_key = ${m}.album_key
       AND cardinality(${p}_al.genres) > 0
      LEFT JOIN music_genres ${p}_ar
        ON ${p}_ar.user_id = ${m}.user_id AND ${p}_ar.kind = 'artist' AND ${p}_ar.item_key = ${firstArtistKeySql(`${m}.`)}`,
    genres: `COALESCE(${p}_al.genres, ${p}_ar.genres, '{}'::text[])`,
  };
}

/**
 * A condition: the play `alias` ("m." or '') has the genre bound to `param`
 * (e.g. "$5"). Expects the user at $1, like every music query.
 */
export function inGenreSql(alias: string, param: string): string {
  const pg = playGenres('gm', 'ig');
  return `${alias}id IN (
    SELECT gm.id FROM music_scrobbles gm ${pg.join}
    WHERE gm.user_id = $1 AND ${param}::text = ANY(${pg.genres}))`;
}
