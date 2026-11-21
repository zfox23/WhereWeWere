/**
 * /location-checkins/lists/* — named lists of location CHECK-INS (not venues),
 * so events like concerts or broadway shows can be collected into one
 * browsable section without a new check-in type. Mirrors /venues/lists.
 *
 * Mounted on the check-ins router before its /:id routes so "lists" isn't
 * treated as a check-in id.
 */

import { Router, Request, Response } from 'express';
import { query } from '../../../server/src/db';
import { createListKit, inTransaction, type Db } from '../../../server/src/services/lists';
import { mountRankRoutes } from '../../../server/src/services/lists/routes';
import { currentUserId } from '../../../server/src/auth/context';
import { addTimezone } from './helpers';
import { mountListCrudRoutes } from './listCrud';

export const checkinListsRouter = Router();

const checkinListKit = createListKit({
  lists: 'checkin_lists', items: 'checkin_list_items', itemId: 'checkin_id', sessions: 'checkin_rank_sessions',
});

export function normalizeListIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(ids));
}

/**
 * Attach a check-in to exactly the given lists (full-replacement: any
 * membership not in the set is detached). Runs on the caller's transaction
 * client so it commits atomically with the surrounding check-in
 * insert/update. Returns the list ids the check-in is now a member of.
 */
export async function attachCheckinLists(
  checkinId: string,
  listIds: string[],
  client: Db
): Promise<string[]> {
  const userId = currentUserId();
  await client.query(
    `INSERT INTO checkin_list_items (list_id, checkin_id)
     SELECT l.id, $1 FROM checkin_lists l
     WHERE l.id = ANY($2::uuid[]) AND l.user_id = $3
     ON CONFLICT (list_id, checkin_id) DO NOTHING`,
    [checkinId, listIds, userId]
  );
  await client.query(
    `DELETE FROM checkin_list_items cli
     USING checkin_lists cl
     WHERE cli.list_id = cl.id
       AND cl.user_id = $2
       AND cli.checkin_id = $3
       AND NOT (cl.id = ANY($1::uuid[]))`,
    [listIds, userId, checkinId]
  );
  return getCheckinListIds(checkinId, client);
}

/** The current user's list ids a check-in belongs to (for GET /:id and saves). */
export async function getCheckinListIds(checkinId: string, executor: Db = { query }): Promise<string[]> {
  const result = await executor.query(
    `SELECT cli.list_id FROM checkin_list_items cli
     JOIN checkin_lists cl ON cl.id = cli.list_id AND cl.user_id = $2
     WHERE cli.checkin_id = $1 ORDER BY cli.list_id`,
    [checkinId, currentUserId()]
  );
  return result.rows.map((r: any) => r.list_id as string);
}

// GET /lists - checkin lists with their item counts
checkinListsRouter.get('/lists', async (_req: Request, res: Response) => {
  try {
    const listsResult = await query(
      'SELECT id, name, created_at, updated_at FROM checkin_lists WHERE user_id = $1 ORDER BY name ASC',
      [currentUserId()]
    );
    const countsResult = await query(
      `SELECT list_id, COUNT(*)::int AS count
       FROM checkin_list_items
       WHERE list_id IN (SELECT id FROM checkin_lists WHERE user_id = $1)
       GROUP BY list_id`,
      [currentUserId()]
    );
    const countById = new Map(countsResult.rows.map((r: any) => [r.list_id as string, r.count as number]));
    res.json(
      listsResult.rows.map((l: any) => ({
        ...l,
        item_count: countById.get(l.id) ?? 0,
      }))
    );
  } catch (err) {
    console.error('Error listing checkin lists:', err);
    res.status(500).json({ error: 'Failed to list checkin lists' });
  }
});

// GET /lists/:id/items - the check-ins in a list, with display fields
checkinListsRouter.get('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const userId = currentUserId();
    const listResult = await query(
      'SELECT id FROM checkin_lists WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Checkin list not found' });
    }
    const itemsResult = await query(
      `SELECT cli.checkin_id,
              cli.rank,
              cli.added_at,
              c.checked_in_at,
              c.checkin_timezone AS venue_timezone,
              c.notes,
              c.rating,
              v.id AS venue_id,
              v.name AS venue_name,
              pv.id AS parent_venue_id,
              pv.name AS parent_venue_name
       FROM checkin_list_items cli
       JOIN checkins c ON cli.checkin_id = c.id AND c.user_id = $2
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venues pv ON v.parent_venue_id = pv.id
       WHERE cli.list_id = $1
       ORDER BY (cli.rank IS NULL) ASC, cli.rank ASC, c.checked_in_at DESC, cli.added_at ASC`,
      [req.params.id, userId]
    );
    const items = itemsResult.rows.map((row: any) => addTimezone(row));
    const checkinIds = items.map((i: any) => i.checkin_id as string);
    let companionsByCheckin = new Map<string, string[]>();
    if (checkinIds.length > 0) {
      const compResult = await query(
        `SELECT checkin_id, name FROM companions
         WHERE checkin_type = 'location' AND checkin_id = ANY($1::uuid[]) AND user_id = $2
         ORDER BY name ASC`,
        [checkinIds, userId]
      );
      for (const row of compResult.rows) {
        const list = companionsByCheckin.get(row.checkin_id) ?? [];
        list.push(row.name);
        companionsByCheckin.set(row.checkin_id, list);
      }
    }
    res.json(items.map((i: any) => ({ ...i, companions: companionsByCheckin.get(i.checkin_id) ?? [] })));
  } catch (err) {
    console.error('Error listing checkin list items:', err);
    res.status(500).json({ error: 'Failed to list checkin list items' });
  }
});

// POST /lists/:id/items - add a check-in to a list (idempotent; optional rank)
checkinListsRouter.post('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const { checkin_id, rank } = req.body ?? {};
    if (!checkin_id) return res.status(400).json({ error: 'checkin_id is required' });
    const rankValue =
      rank == null ? null : typeof rank === 'number' && Number.isInteger(rank) && rank >= 1 ? rank : null;

    const userId = currentUserId();
    const listId = String(req.params.id);
    const outcome = await inTransaction(async (tx) => {
      if (!(await checkinListKit.ownsList(userId, listId, tx))) return 'no-list' as const;
      const checkin = await tx.query('SELECT id FROM checkins WHERE id = $1 AND user_id = $2', [checkin_id, userId]);
      if (checkin.rows.length === 0) return 'no-checkin' as const;
      await tx.query(
        `INSERT INTO checkin_list_items (list_id, checkin_id, rank)
         VALUES ($1, $2, $3)
         ON CONFLICT (list_id, checkin_id) DO NOTHING`,
        [listId, checkin_id, rankValue]
      );
      return 'added' as const;
    });
    if (outcome === 'no-list') return res.status(404).json({ error: 'Checkin list not found' });
    if (outcome === 'no-checkin') return res.status(404).json({ error: 'Check-in not found' });
    res.status(201).json({ message: 'Added to list' });
  } catch (err) {
    // The (list_id, rank) unique index: another item already holds that rank.
    if ((err as { code?: string } | null)?.code === '23505') {
      return res.status(409).json({ error: 'That rank is already taken in this list' });
    }
    console.error('Error adding check-in to list:', err);
    res.status(500).json({ error: 'Failed to add check-in to list' });
  }
});

// POST/PUT/DELETE /lists[/:id] and DELETE /lists/:id/items/:checkinId.
mountListCrudRoutes(checkinListsRouter, {
  lists: 'checkin_lists',
  items: 'checkin_list_items',
  itemId: 'checkin_id',
  returning: 'id, name, created_at, updated_at',
  label: 'Checkin list',
  itemNotInList: 'Check-in is not in this list',
  removeItemFailed: 'Failed to remove check-in from list',
});

// PUT /lists/:id/ranks (bulk re-rank), PUT /lists/:id/items/:itemId/rank (one rank) and
// /lists/:id/rank-session come from the shared list kit.
mountRankRoutes(checkinListsRouter, checkinListKit);
