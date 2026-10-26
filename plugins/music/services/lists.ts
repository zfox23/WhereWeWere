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
}

export interface MusicList {
  id: string;
  name: string;
  items: ListItem[];
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

export async function getLists(userId: string): Promise<MusicList[]> {
  const [lists, items] = await Promise.all([
    query(`SELECT id, name FROM music_lists WHERE user_id = $1 ORDER BY created_at, id`, [userId]),
    query(
      `SELECT i.id, i.list_id, i.item_key, i.kind, i.title, i.artists, i.album, i.album_ref, i.added_at, a.id AS art_id
       FROM music_list_items i
       JOIN music_lists l ON l.id = i.list_id
       LEFT JOIN music_albums a
         ON a.user_id = l.user_id AND a.album_key = i.album_ref AND a.thumb_file IS NOT NULL
       WHERE l.user_id = $1
       ORDER BY i.position, i.added_at, i.id`,
      [userId],
    ),
  ]);
  const byList = new Map<string, ListItem[]>();
  for (const { list_id, ...item } of items.rows) {
    const bucket = byList.get(list_id) ?? [];
    bucket.push(item as ListItem);
    byList.set(list_id, bucket);
  }
  return lists.rows.map((l: { id: string; name: string }) => ({ ...l, items: byList.get(l.id) ?? [] }));
}

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
    const result = await query(`UPDATE music_lists SET name = $3 WHERE id = $2 AND user_id = $1 RETURNING id, name`, [userId, id, name]);
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
  return { added: (result.rowCount ?? 0) > 0 };
}

export async function removeItem(userId: string, listId: string, itemId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM music_list_items i USING music_lists l
     WHERE i.id = $3 AND i.list_id = $2 AND l.id = i.list_id AND l.user_id = $1 RETURNING i.id`,
    [userId, listId, itemId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Put the list's items in the given order; ids not on the list are ignored, omitted items go last. */
export async function reorderItems(userId: string, listId: string, itemIds: string[]): Promise<boolean> {
  const list = await query(`SELECT 1 FROM music_lists WHERE id = $1 AND user_id = $2`, [listId, userId]);
  if ((list.rowCount ?? 0) === 0) return false;
  // Unlisted items move out of the way first so the listed ones lead.
  await query(`UPDATE music_list_items SET position = position + 1000000 WHERE list_id = $1`, [listId]);
  await query(
    `UPDATE music_list_items i SET position = o.pos
     FROM (SELECT id, ord - 1 AS pos FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ord)) o
     WHERE i.list_id = $1 AND i.id = o.id`,
    [listId, itemIds],
  );
  // Anything not mentioned keeps its relative order after the listed items.
  await query(
    `UPDATE music_list_items i SET position = r.pos
     FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, added_at, id) - 1 AS pos
           FROM music_list_items WHERE list_id = $1) r
     WHERE i.id = r.id`,
    [listId],
  );
  return true;
}

// ---- Backup -------------------------------------------------------------

export interface ListBackup {
  name: string;
  items: { kind: 'song' | 'album'; title: string; artists: string[]; album: string | null; item_key: string; album_ref: string | null }[];
}

export async function exportLists(userId: string): Promise<ListBackup[]> {
  return (await getLists(userId)).map((l) => ({
    name: l.name,
    items: l.items.map(({ kind, title, artists, album, item_key, album_ref }) => ({ kind, title, artists, album, item_key, album_ref })),
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
    for (const rawItem of (Array.isArray(l.items) ? l.items : []).slice(0, 10_000)) {
      const i = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
      const key = str(i.item_key, 2000);
      const title = str(i.title);
      if ((i.kind !== 'song' && i.kind !== 'album') || !key || !title || !key.startsWith(`${i.kind}:`)) continue;
      const artists = (Array.isArray(i.artists) ? i.artists : []).flatMap((a) => (str(a) ? [str(a) as string] : []));
      const result = await db.query(
        `INSERT INTO music_list_items (list_id, item_key, kind, title, artists, album, album_ref, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
                 COALESCE((SELECT MAX(position) + 1 FROM music_list_items WHERE list_id = $1), 0))
         ON CONFLICT (list_id, item_key) DO NOTHING`,
        [listId, key, i.kind, title, artists, str(i.album), str(i.album_ref, 2000)],
      );
      added += result.rowCount ?? 0;
    }
  }
  return added;
}

