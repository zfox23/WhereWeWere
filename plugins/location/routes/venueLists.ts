/**
 * /venues/lists/* — named lists of venues. Mounted on the venues router
 * before its /:id routes so "lists" isn't treated as a venue id.
 */

import { Router, Request, Response } from 'express';
import { query } from '../../../server/src/db';
import { createListKit, inTransaction } from '../../../server/src/services/lists';
import { mountRankRoutes } from '../../../server/src/services/lists/routes';
import { currentUserId } from '../../../server/src/auth/context';
import { mountListCrudRoutes } from './listCrud';

export const venueListsRouter = Router();

const venueListKit = createListKit({
  lists: 'venue_lists', items: 'venue_list_items', itemId: 'venue_id', sessions: 'venue_rank_sessions',
});

// GET /lists - lists with their venues
venueListsRouter.get('/lists', async (_req: Request, res: Response) => {
  try {
    const listsResult = await query(
      'SELECT id, name, created_at, updated_at FROM venue_lists WHERE user_id = $1 ORDER BY created_at',
      [currentUserId()]
    );
    const itemsResult = await query(
      `SELECT l.id AS list_id,
              json_agg(json_build_object(
                'id', v.id, 'name', v.name, 'added_at', vli.added_at, 'rank', vli.rank
              ) ORDER BY vli.added_at, vli.position) FILTER (WHERE v.id IS NOT NULL) AS items
       FROM venue_lists l
       LEFT JOIN venue_list_items vli ON vli.list_id = l.id
       LEFT JOIN venues v ON vli.venue_id = v.id
       WHERE l.user_id = $1
       GROUP BY l.id`,
      [currentUserId()]
    );
    const itemsById = new Map(itemsResult.rows.map((r: any) => [r.list_id as string, r.items]));
    res.json(listsResult.rows.map((l: any) => ({ ...l, items: itemsById.get(l.id) || [] })));
  } catch (err) {
    console.error('Error listing venue lists:', err);
    res.status(500).json({ error: 'Failed to list venue lists' });
  }
});

// GET /lists/:id/items - the venues in a list, with display fields and rank
venueListsRouter.get('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const listResult = await query(
      'SELECT id FROM venue_lists WHERE id = $1 AND user_id = $2',
      [req.params.id, currentUserId()]
    );
    if (listResult.rows.length === 0) {
      return res.status(404).json({ error: 'Venue list not found' });
    }
    const result = await query(
      `SELECT vli.venue_id, vli.rank, vli.added_at,
              v.name AS venue_name, v.city, v.state, v.country, vr.rating,
              vc.name AS category_name, vc.icon AS category_icon,
              (ARRAY_AGG(c.checked_in_at ORDER BY c.checked_in_at DESC, c.id DESC)
                 FILTER (WHERE c.id IS NOT NULL))[1] AS last_checkin_at,
              (ARRAY_AGG(c.checkin_timezone ORDER BY c.checked_in_at DESC, c.id DESC)
                 FILTER (WHERE c.id IS NOT NULL))[1] AS last_checkin_timezone,
              COUNT(c.id)::int AS checkin_count
       FROM venue_list_items vli
       JOIN venues v ON v.id = vli.venue_id
       LEFT JOIN venue_categories vc ON vc.id = v.category_id
       LEFT JOIN venue_ratings vr ON vr.venue_id = v.id AND vr.user_id = $2
       LEFT JOIN checkins c ON c.venue_id = v.id AND c.user_id = $2
       WHERE vli.list_id = $1
       GROUP BY vli.list_id, vli.venue_id, vli.rank, vli.added_at, v.id, vc.id, vr.rating
       ORDER BY vli.rank ASC NULLS LAST, vli.added_at`,
      [req.params.id, currentUserId()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing venue list items:', err);
    res.status(500).json({ error: 'Failed to list venue list items' });
  }
});

// PUT /lists/:id/ranks (bulk re-rank) and /lists/:id/rank-session come from the shared list kit.
mountRankRoutes(venueListsRouter, venueListKit);

// POST /lists/:id/items - add a venue to a list (idempotent)
venueListsRouter.post('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const { venue_id } = req.body;
    if (!venue_id) return res.status(400).json({ error: 'venue_id is required' });
    const listId = String(req.params.id);
    const outcome = await inTransaction(async (tx) => {
      if (!(await venueListKit.ownsList(currentUserId(), listId, tx))) return 'no-list' as const;
      const venue = await tx.query('SELECT id FROM venues WHERE id = $1', [venue_id]);
      if (venue.rows.length === 0) return 'no-venue' as const;
      const maxPos = await tx.query(
        'SELECT COALESCE(MAX(position), 0)::int AS pos FROM venue_list_items WHERE list_id = $1',
        [listId]
      );
      await tx.query(
        `INSERT INTO venue_list_items (list_id, venue_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (list_id, venue_id) DO NOTHING`,
        [listId, venue_id, (maxPos.rows[0]?.pos ?? 0) + 1]
      );
      return 'added' as const;
    });
    if (outcome === 'no-list') return res.status(404).json({ error: 'Venue list not found' });
    if (outcome === 'no-venue') return res.status(404).json({ error: 'Venue not found' });
    res.status(201).json({ message: 'Added to list' });
  } catch (err) {
    console.error('Error adding to venue list:', err);
    res.status(500).json({ error: 'Failed to add venue to list' });
  }
});

// POST/PUT/DELETE /lists[/:id] and DELETE /lists/:id/items/:venueId.
mountListCrudRoutes(venueListsRouter, {
  lists: 'venue_lists',
  items: 'venue_list_items',
  itemId: 'venue_id',
  returning: 'id, name, created_at',
  label: 'Venue list',
  itemNotInList: 'Venue not in list',
  removeItemFailed: 'Failed to remove venue from list',
});
