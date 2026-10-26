/**
 * Shared ranked-list kit: the operations every plugin's lists need, driven by a
 * small descriptor naming that plugin's tables. Each plugin keeps its own item
 * tables (they carry real foreign keys and cascades); only the generic parts
 * live here: name rules, ownership, rank writes and paused ranking sessions.
 *
 * Table and column names come from descriptors (code), never from requests.
 */

import type { Response } from 'express';
import { pool, query } from '../../db';

export const MAX_NAME = 100;

export class NameTakenError extends Error {}
export class InvalidNameError extends Error {}

/** Trim, collapse whitespace and bound a list name; throws InvalidNameError. */
export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_NAME) throw new InvalidNameError(`Give the list a name of 1 to ${MAX_NAME} characters`);
  return name;
}

/** Map a unique-violation to NameTakenError; rethrow anything else. */
export function nameTakenOrThrow(err: unknown): never {
  if ((err as { code?: string })?.code === '23505') throw new NameTakenError('You already have a list with that name');
  throw err;
}

/** 400 / 409 for name problems, 500 (logged) for the rest. */
export function listError(res: Response, err: unknown, what: string) {
  if (err instanceof InvalidNameError) return res.status(400).json({ error: err.message });
  if (err instanceof NameTakenError) return res.status(409).json({ error: err.message });
  console.error(`Error ${what}:`, err);
  return res.status(500).json({ error: `Failed ${what}` });
}

/** The pool helper or a transaction client. */
export type Db = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> };

export interface ListDescriptor {
  /** Table of lists: id UUID, user_id, updated_at. */
  lists: string;
  /** Table of items: list_id, rank (INT NULL, 1..n among ranked) and the id column below. */
  items: string;
  /** The UUID column that identifies an item within its list (what `ranked_ids` holds). */
  itemId: string;
  /** Paused ranking sessions: list_id UUID PK -> lists ON DELETE CASCADE, state JSONB, updated_at. */
  sessions: string;
}

async function inTransaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function createListKit(d: ListDescriptor) {
  /** True when the list exists and belongs to the user. */
  async function ownsList(userId: string, listId: string, db: Db = { query }): Promise<boolean> {
    const r = await db.query(`SELECT 1 FROM ${d.lists} WHERE id = $1 AND user_id = $2`, [listId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  const touch = (listId: string, db: Db = { query }) =>
    db.query(`UPDATE ${d.lists} SET updated_at = NOW() WHERE id = $1`, [listId]);

  /** Give `ids` ranks 1..n in that order and every other item on the list none. */
  async function writeRanks(tx: Db, listId: string, ids: string[]): Promise<void> {
    // Cleared first: the unique (list_id, rank) indexes check row by row.
    await tx.query(`UPDATE ${d.items} SET rank = NULL WHERE list_id = $1 AND rank IS NOT NULL`, [listId]);
    await tx.query(
      `UPDATE ${d.items} i SET rank = l.rank
       FROM (SELECT it.${d.itemId} AS id, ROW_NUMBER() OVER (ORDER BY r.ord) AS rank
             FROM unnest($2::uuid[]) WITH ORDINALITY AS r(id, ord)
             JOIN ${d.items} it ON it.${d.itemId} = r.id AND it.list_id = $1) l
       WHERE i.list_id = $1 AND i.${d.itemId} = l.id`,
      [listId, ids],
    );
    await touch(listId, tx);
  }

  /**
   * Drag-to-rank: the given item ids become ranks 1..n in that order and every
   * other item on the list becomes unranked. Ids not on the list are ignored.
   * False when there is no such list for the user.
   */
  async function setRanks(userId: string, listId: string, rankedIds: string[]): Promise<boolean> {
    if (!(await ownsList(userId, listId))) return false;
    await inTransaction((tx) => writeRanks(tx, listId, [...new Set(rankedIds)]));
    return true;
  }

  /**
   * Put one item at `rank` (the others make room, so ranks stay 1..n; a rank
   * past the end lands at the end) or, with null, take it out of the ranking
   * (the ranks below close the gap). Unranked items stay unranked.
   */
  async function setRank(
    userId: string,
    listId: string,
    itemId: string,
    rank: number | null,
  ): Promise<{ status: 'ok'; rank: number | null } | { status: 'no-list' } | { status: 'no-item' }> {
    return inTransaction(async (tx) => {
      // The list row serializes concurrent re-ranks of one list.
      const list = await tx.query(`SELECT 1 FROM ${d.lists} WHERE id = $1 AND user_id = $2 FOR UPDATE`, [listId, userId]);
      if ((list.rowCount ?? 0) === 0) return { status: 'no-list' as const };
      const item = await tx.query(`SELECT 1 FROM ${d.items} WHERE list_id = $1 AND ${d.itemId} = $2`, [listId, itemId]);
      if ((item.rowCount ?? 0) === 0) return { status: 'no-item' as const };
      const others = await tx.query(
        `SELECT ${d.itemId}::text AS id FROM ${d.items}
         WHERE list_id = $1 AND rank IS NOT NULL AND ${d.itemId} <> $2 ORDER BY rank`,
        [listId, itemId],
      );
      const order: string[] = others.rows.map((r: { id: string }) => r.id);
      let placed: number | null = null;
      if (rank !== null) {
        placed = Math.min(rank, order.length + 1);
        order.splice(placed - 1, 0, itemId);
      }
      await writeRanks(tx, listId, order);
      return { status: 'ok' as const, rank: placed };
    });
  }

  async function getRankSession(userId: string, listId: string): Promise<{ state: RankSessionStateDto; updated_at: string } | null> {
    const r = await query(
      `SELECT s.state, s.updated_at FROM ${d.sessions} s JOIN ${d.lists} l ON l.id = s.list_id WHERE s.list_id = $2 AND l.user_id = $1`,
      [userId, listId],
    );
    return r.rows[0] ?? null;
  }

  /** Save (replace) a list's paused session. False when there is no such list. */
  async function saveRankSession(userId: string, listId: string, state: RankSessionStateDto): Promise<boolean> {
    const r = await query(
      `INSERT INTO ${d.sessions} (list_id, state, updated_at)
       SELECT l.id, $3::jsonb, NOW() FROM ${d.lists} l WHERE l.id = $2 AND l.user_id = $1
       ON CONFLICT (list_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
       RETURNING list_id`,
      [userId, listId, JSON.stringify(state)],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async function deleteRankSession(userId: string, listId: string): Promise<boolean> {
    const r = await query(
      `DELETE FROM ${d.sessions} s USING ${d.lists} l WHERE s.list_id = l.id AND l.id = $2 AND l.user_id = $1 RETURNING s.list_id`,
      [userId, listId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  return { ownsList, touch, setRanks, setRank, getRankSession, saveRankSession, deleteRankSession };
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
