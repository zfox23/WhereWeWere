/**
 * Music plugin — lists of songs and albums (favorites and so on).
 *
 * Items are added by the opaque identity strings the server handed out
 * (see identity.ts); the display fields are copied from the user's own plays,
 * never taken from the request, so a list can only hold music that was played.
 */

import { query } from '../../../server/src/db';
import { albumRefSql, songKeySql, UNKNOWN_ALBUM } from './identity';

export const MAX_NAME = 100;

export interface ListItem {
  id: string;
  /** "song:..." or "album:..."; what a row's identity is compared against. */
  item_key: string;
  kind: 'song' | 'album';
  title: string;
  artists: string[];
  album: string | null;
  album_ref: string | null;
  art_id: string | null;
  added_at: string;
  /** 1..n among the ranked items; null when unranked. */
  rank: number | null;
}

export interface MusicList {
  id: string;
  name: string;
  updated_at: string;
  item_count: number;
  /** Up to four distinct covers, best-ranked items first, for the index card. */
  covers: string[];
  items: ListItem[];
}

/** A list item with the user's all-time play data for it. */
export interface ListItemWithStats extends ListItem {
  plays: number;
  listened_seconds: number;
  last_played_at: string | null;
}

export class NameTakenError extends Error {}
export class InvalidNameError extends Error {}

export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_NAME) throw new InvalidNameError(`Give the list a name of 1 to ${MAX_NAME} characters`);
  return name;
}

/** The pool helper or a transaction client. */
export type Db = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> };

// position is the order of adding (restores add many items in one instant, so added_at alone ties).
const ITEM_ORDER = `i.rank NULLS LAST, i.position, i.added_at, i.id`;

export async function getLists(userId: string): Promise<MusicList[]> {
  const [lists, items] = await Promise.all([
    query(`SELECT id, name, updated_at FROM music_lists WHERE user_id = $1 ORDER BY created_at, id`, [userId]),
    query(
      `SELECT i.id, i.list_id, i.item_key, i.kind, i.title, i.artists, i.album, i.album_ref, i.added_at, i.rank, a.id AS art_id
       FROM music_list_items i
       JOIN music_lists l ON l.id = i.list_id
       LEFT JOIN music_albums a
         ON a.user_id = l.user_id AND a.album_key = i.album_ref AND a.thumb_file IS NOT NULL
       WHERE l.user_id = $1
       ORDER BY ${ITEM_ORDER}`,
      [userId],
    ),
  ]);
  const byList = new Map<string, ListItem[]>();
  for (const { list_id, ...item } of items.rows) {
    const bucket = byList.get(list_id) ?? [];
    bucket.push(item as ListItem);
    byList.set(list_id, bucket);
  }
  return lists.rows.map((l: { id: string; name: string; updated_at: string }) => {
    const listItems = byList.get(l.id) ?? [];
    const covers = [...new Set(listItems.flatMap((i) => (i.art_id ? [i.art_id] : [])))].slice(0, 4);
    return { ...l, item_count: listItems.length, covers, items: listItems };
  });
}

/** One list's items with the user's all-time plays of each, or null when there is no such list. */
export async function getListItems(userId: string, listId: string): Promise<ListItemWithStats[] | null> {
  const list = await query(`SELECT 1 FROM music_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
  if ((list.rowCount ?? 0) === 0) return null;
  const base = `i.id, i.position, i.item_key, i.kind, i.title, i.artists, i.album, i.album_ref, i.added_at, i.rank, a.id AS art_id,
                st.plays, st.seconds AS listened_seconds, st.last_played_at`;
  const join = `FROM music_list_items i
       JOIN music_lists l ON l.id = i.list_id
       LEFT JOIN music_albums a ON a.user_id = l.user_id AND a.album_key = i.album_ref AND a.thumb_file IS NOT NULL`;
  const stats = (match: string) => `LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS plays,
                COALESCE(SUM(COALESCE(m.listened_for, m.track_length, 0)), 0)::int AS seconds,
                MAX(m.played_at) AS last_played_at
         FROM music_scrobbles m WHERE m.user_id = l.user_id AND ${match}
       ) st ON true`;
  // Two statements so each can use its index: albums by album_key, songs by title.
  const [albums, songs] = await Promise.all([
    query(`SELECT ${base} ${join} ${stats('m.album_key = i.album_ref')} WHERE i.list_id = $1 AND i.kind = 'album'`, [listId]),
    query(
      `SELECT ${base} ${join}
       ${stats(`lower(btrim(m.title)) = split_part(substr(i.item_key, 6), chr(31), 1) AND ${songKeySql('m.')} = substr(i.item_key, 6)`)}
       WHERE i.list_id = $1 AND i.kind = 'song'`,
      [listId],
    ),
  ]);
  const all = [...albums.rows, ...songs.rows] as (ListItemWithStats & { position: number })[];
  return all
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.position - b.position || a.id.localeCompare(b.id))
    .map(({ position: _position, ...item }) => item);
}

const touch = (listId: string) => query(`UPDATE music_lists SET updated_at = NOW() WHERE id = $1`, [listId]);

async function insertList(db: Db, userId: string, name: string): Promise<{ id: string; name: string } | null> {
  const result = await db.query(
    // clock_timestamp(): inside a restore transaction NOW() is the same for every list, which would scramble their order.
    `INSERT INTO music_lists (user_id, name, created_at) VALUES ($1, $2, clock_timestamp()) ON CONFLICT DO NOTHING RETURNING id, name`,
    [userId, name],
  );
  return result.rows[0] ?? null;
}

export async function createList(userId: string, rawName: unknown) {
  const created = await insertList({ query }, userId, cleanName(rawName));
  if (!created) throw new NameTakenError('You already have a list with that name');
  return { ...created, items: [] as ListItem[] };
}

export async function renameList(userId: string, id: string, rawName: unknown) {
  const name = cleanName(rawName);
  try {
    const result = await query(`UPDATE music_lists SET name = $3, updated_at = NOW() WHERE id = $2 AND user_id = $1 RETURNING id, name`, [userId, id, name]);
    return result.rows[0] ?? null;
  } catch (err: any) {
    if (err?.code === '23505') throw new NameTakenError('You already have a list with that name');
    throw err;
  }
}

export async function deleteList(userId: string, id: string): Promise<boolean> {
  const result = await query(`DELETE FROM music_lists WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
  return (result.rowCount ?? 0) > 0;
}

export type AddItemRequest =
  | { kind: 'album'; album_ref: string }
  | { kind: 'song'; song_key: string; album_ref?: string | null };

/** Display fields for an album identity, from the plays that carry it. */
async function describeAlbum(db: Db, userId: string, ref: string) {
  const r = await db.query(
    `SELECT MIN(album) AS album,
            (ARRAY_AGG(COALESCE(album_artists[1], artists[1]) ORDER BY played_at DESC))[1] AS artist
     FROM music_scrobbles WHERE user_id = $1 AND ${albumRefSql()} = $2
     HAVING COUNT(*) > 0`,
    [userId, ref],
  );
  return r.rows[0] as { album: string | null; artist: string } | undefined;
}

/**
 * Add a song or album. Returns null when nothing played matches the identity,
 * otherwise whether it was newly added (false: already on the list).
 */
export async function addItem(userId: string, listId: string, req: AddItemRequest): Promise<{ added: boolean } | null> {
  const list = await query(`SELECT 1 FROM music_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
  if ((list.rowCount ?? 0) === 0) return null;

  let item: { key: string; kind: 'song' | 'album'; title: string; artists: string[]; album: string | null; albumRef: string | null };
  if (req.kind === 'album') {
    const album = await describeAlbum({ query }, userId, req.album_ref);
    if (!album) return null;
    item = {
      key: `album:${req.album_ref}`,
      kind: 'album',
      title: album.album ?? UNKNOWN_ALBUM,
      artists: [album.artist],
      album: album.album,
      albumRef: req.album_ref,
    };
  } else {
    // The album context must be one this song was actually played on.
    // (artists is an array, so take the latest play by ordering rather than aggregating.)
    const latest = await query(
      `SELECT title, artists FROM music_scrobbles WHERE user_id = $1 AND ${songKeySql()} = $2
       ORDER BY played_at DESC, id DESC LIMIT 1`,
      [userId, req.song_key],
    );
    const row = latest.rows[0];
    if (!row) return null;
    const played = await query(
      `SELECT ${albumRefSql()} AS ref FROM music_scrobbles WHERE user_id = $1 AND ${songKeySql()} = $2
       ORDER BY played_at DESC, id DESC`,
      [userId, req.song_key],
    );
    row.refs = played.rows.map((r: { ref: string }) => r.ref);
    const albumRef: string = req.album_ref && row.refs.includes(req.album_ref) ? req.album_ref : row.refs[0];
    const album = await describeAlbum({ query }, userId, albumRef);
    item = {
      key: `song:${req.song_key}`,
      kind: 'song',
      title: row.title,
      artists: row.artists,
      album: album?.album ?? null,
      albumRef,
    };
  }

  const result = await query(
    `INSERT INTO music_list_items (list_id, item_key, kind, title, artists, album, album_ref, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             COALESCE((SELECT MAX(position) + 1 FROM music_list_items WHERE list_id = $1), 0))
     ON CONFLICT (list_id, item_key) DO NOTHING`,
    [listId, item.key, item.kind, item.title, item.artists, item.album, item.albumRef],
  );
  if ((result.rowCount ?? 0) > 0) await touch(listId);
  return { added: (result.rowCount ?? 0) > 0 };
}

export async function removeItem(userId: string, listId: string, itemId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM music_list_items i USING music_lists l
     WHERE i.id = $3 AND i.list_id = $2 AND l.id = i.list_id AND l.user_id = $1 RETURNING i.id`,
    [userId, listId, itemId],
  );
  if ((result.rowCount ?? 0) === 0) return false;
  // Ranks stay gap-free: close the hole.
  await query(
    `UPDATE music_list_items i SET rank = r.rn
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY rank) AS rn FROM music_list_items WHERE list_id = $1 AND rank IS NOT NULL) r
     WHERE i.id = r.id`,
    [listId],
  );
  await touch(listId);
  return true;
}

/**
 * Drag-to-rank: the given item ids become ranks 1..n in that order and every
 * other item on the list becomes unranked. Ids not on the list are ignored.
 */
export async function setRanks(userId: string, listId: string, rankedIds: string[]): Promise<boolean> {
  const list = await query(`SELECT 1 FROM music_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
  if ((list.rowCount ?? 0) === 0) return false;
  const unique = [...new Set(rankedIds)];
  await query(
    `WITH listed AS (
       SELECT i.id, ROW_NUMBER() OVER (ORDER BY r.ord) AS rank
       FROM unnest($2::uuid[]) WITH ORDINALITY AS r(id, ord)
       JOIN music_list_items i ON i.id = r.id AND i.list_id = $1
     )
     UPDATE music_list_items i SET rank = (SELECT l.rank FROM listed l WHERE l.id = i.id) WHERE i.list_id = $1`,
    [listId, unique],
  );
  await touch(listId);
  return true;
}

// ---- Backup -------------------------------------------------------------

export interface ListBackup {
  name: string;
  items: {
    kind: 'song' | 'album'; title: string; artists: string[]; album: string | null;
    item_key: string; album_ref: string | null; rank: number | null;
  }[];
}

export async function exportLists(userId: string): Promise<ListBackup[]> {
  return (await getLists(userId)).map((l) => ({
    name: l.name,
    items: l.items.map(({ kind, title, artists, album, item_key, album_ref, rank }) => ({ kind, title, artists, album, item_key, album_ref, rank })),
  }));
}

const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);

/** Merge backed-up lists in: lists match by name, items by identity; nothing existing is changed. */
export async function importLists(db: Db, userId: string, payload: unknown): Promise<number> {
  if (!Array.isArray(payload)) return 0;
  let added = 0;
  for (const raw of payload) {
    const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    let name: string;
    try {
      name = cleanName(l.name);
    } catch {
      continue;
    }
    const existing = await db.query(`SELECT id FROM music_lists WHERE user_id = $1 AND lower(name) = lower($2)`, [userId, name]);
    const listId: string | undefined = existing.rows[0]?.id ?? (await insertList(db, userId, name))?.id;
    if (!listId) continue;
    // A list this restore creates gets its ranks back; a list that already
    // exists keeps its own ranking and takes new items unranked.
    const created = existing.rows.length === 0;
    const ordered = (Array.isArray(l.items) ? l.items : []).slice(0, 10_000).sort((x: any, y: any) => (Number(x?.rank) || Infinity) - (Number(y?.rank) || Infinity));
    let nextRank = 1;
    for (const rawItem of ordered) {
      const i = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
      const key = str(i.item_key, 2000);
      const title = str(i.title);
      if ((i.kind !== 'song' && i.kind !== 'album') || !key || !title || !key.startsWith(`${i.kind}:`)) continue;
      const artists = (Array.isArray(i.artists) ? i.artists : []).flatMap((a) => (str(a) ? [str(a) as string] : []));
      const result = await db.query(
        `INSERT INTO music_list_items (list_id, item_key, kind, title, artists, album, album_ref, position, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 COALESCE((SELECT MAX(position) + 1 FROM music_list_items WHERE list_id = $1), 0), $8)
         ON CONFLICT (list_id, item_key) DO NOTHING`,
        [listId, key, i.kind, title, artists, str(i.album), str(i.album_ref, 2000), created && Number(i.rank) > 0 ? nextRank : null],
      );
      if ((result.rowCount ?? 0) > 0 && created && Number(i.rank) > 0) nextRank++;
      added += result.rowCount ?? 0;
    }
  }
  return added;
}


// ---- Paused ranking sessions -------------------------------------------

export interface RankSessionStateDto {
  mode: 'continue' | 'scratch';
  initialRanks: Record<string, number | null>;
  itemIds: string[];
  answers: { a: string; b: string; r: 'a' | 'b' | 'tie' }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SESSION_ITEMS = 1000;
const MAX_SESSION_ANSWERS = 10_000;

/** Check a client-supplied session; null when it isn't one. Nothing is trusted beyond its shape. */
export function validateRankSession(raw: unknown): RankSessionStateDto | null {
  const s = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null;
  if (!s || (s.mode !== 'continue' && s.mode !== 'scratch')) return null;
  if (!Array.isArray(s.itemIds) || s.itemIds.length > MAX_SESSION_ITEMS || !s.itemIds.every((i: unknown) => typeof i === 'string' && UUID.test(i))) return null;
  if (!Array.isArray(s.answers) || s.answers.length > MAX_SESSION_ANSWERS) return null;
  const ids = new Set<string>(s.itemIds);
  const answers: RankSessionStateDto['answers'] = [];
  for (const a of s.answers) {
    if (!a || !ids.has(a.a) || !ids.has(a.b) || a.a === a.b || !['a', 'b', 'tie'].includes(a.r)) return null;
    answers.push({ a: a.a, b: a.b, r: a.r });
  }
  const initialRanks: Record<string, number | null> = {};
  for (const id of ids) {
    const r = s.initialRanks?.[id];
    initialRanks[id] = Number.isInteger(r) && r > 0 && r <= MAX_SESSION_ITEMS ? r : null;
  }
  return { mode: s.mode, initialRanks, itemIds: [...s.itemIds], answers };
}

export async function getRankSession(userId: string, listId: string): Promise<{ state: RankSessionStateDto; updated_at: string } | null> {
  const r = await query(
    `SELECT s.state, s.updated_at FROM music_rank_sessions s JOIN music_lists l ON l.id = s.list_id WHERE s.list_id = $2 AND l.user_id = $1`,
    [userId, listId],
  );
  return r.rows[0] ?? null;
}

/** Save (replace) a list's paused session. False when there is no such list. */
export async function saveRankSession(userId: string, listId: string, state: RankSessionStateDto): Promise<boolean> {
  const r = await query(
    `INSERT INTO music_rank_sessions (list_id, state, updated_at)
     SELECT l.id, $3::jsonb, NOW() FROM music_lists l WHERE l.id = $2 AND l.user_id = $1
     ON CONFLICT (list_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
     RETURNING list_id`,
    [userId, listId, JSON.stringify(state)],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteRankSession(userId: string, listId: string): Promise<boolean> {
  const r = await query(
    `DELETE FROM music_rank_sessions s USING music_lists l WHERE s.list_id = l.id AND l.id = $2 AND l.user_id = $1 RETURNING s.list_id`,
    [userId, listId],
  );
  return (r.rowCount ?? 0) > 0;
}
