/**
 * Routes every ranked list shares: bulk re-rank and the paused ranking session.
 * A plugin mounts them on the router that already serves its `/lists/...` paths.
 */

import type { Router, Request, Response } from 'express';
import { isUuid } from '../batching';
import { listError, validateRankSession, type createListKit } from './index';

export function mountRankRoutes(router: Router, kit: ReturnType<typeof createListKit>, userId: string): void {
  // Drag-to-rank: the item ids in their new rank order; everyone else on the list becomes unranked.
  router.put('/lists/:id/ranks', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.id);
      const ids: unknown = req.body?.ranked_ids;
      if (!isUuid(listId) || !Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && isUuid(i))) {
        return res.status(400).json({ error: 'ranked_ids must be a list of item ids' });
      }
      if (!(await kit.setRanks(userId, listId, ids as string[]))) return res.status(404).json({ error: 'List not found' });
      res.json({ ranked_ids: [...new Set(ids as string[])] });
    } catch (err) {
      listError(res, err, 'ranking the list');
    }
  });

  // Put one item at a rank, or take it out of the ranking with rank: null.
  router.put('/lists/:id/items/:itemId/rank', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.id);
      const itemId = String(req.params.itemId);
      if (!isUuid(listId) || !isUuid(itemId)) return res.status(400).json({ error: 'Invalid id' });
      const raw = req.body?.rank;
      const rank = raw == null ? null : typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : undefined;
      if (rank === undefined) return res.status(400).json({ error: 'rank must be a whole number from 1, or null' });
      const result = await kit.setRank(userId, listId, itemId, rank);
      if (result.status === 'no-list') return res.status(404).json({ error: 'List not found' });
      if (result.status === 'no-item') return res.status(404).json({ error: 'Item is not in this list' });
      res.json({ rank: result.rank });
    } catch (err) {
      listError(res, err, 'ranking the item');
    }
  });

  // A paused "rank by comparing" session, so it can be resumed later.
  router.get('/lists/:id/rank-session', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.id);
      if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
      const session = await kit.getRankSession(userId, listId);
      if (!session) return res.status(404).json({ error: 'No paused session' });
      res.json(session);
    } catch (err) {
      listError(res, err, 'loading the ranking session');
    }
  });

  router.put('/lists/:id/rank-session', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.id);
      if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
      const state = validateRankSession(req.body?.state);
      if (!state) return res.status(400).json({ error: 'Not a ranking session' });
      if (!(await kit.saveRankSession(userId, listId, state))) return res.status(404).json({ error: 'List not found' });
      res.json({ saved: true });
    } catch (err) {
      listError(res, err, 'saving the ranking session');
    }
  });

  router.delete('/lists/:id/rank-session', async (req: Request, res: Response) => {
    try {
      const listId = String(req.params.id);
      if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
      await kit.deleteRankSession(userId, listId);
      res.json({ deleted: true });
    } catch (err) {
      listError(res, err, 'discarding the ranking session');
    }
  });
}
