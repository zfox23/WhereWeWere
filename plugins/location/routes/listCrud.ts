/**
 * Create / rename / delete / remove-item routes shared by the plugin's two
 * kinds of named list (check-in lists and venue lists). They differ only in
 * table names and wording; listing and adding items stay with each list kind
 * because their shapes really do differ.
 *
 * Table and column names come from the descriptors below (code), never from
 * requests.
 */

import type { Router, Request, Response } from 'express';
import { query } from '../../../server/src/db';
import { currentUserId } from '../../../server/src/auth/context';

export interface ListCrudDescriptor {
  /** Lists table: id, user_id, name. */
  lists: string;
  /** Items table: list_id plus the `itemId` column. */
  items: string;
  itemId: string;
  /** Columns returned when a list is created or renamed. */
  returning: string;
  /** Capitalized noun for messages, e.g. "Venue list". */
  label: string;
  /** 404 message when removing an item that isn't on the list. */
  itemNotInList: string;
  /** 500 message when removing an item fails. */
  removeItemFailed: string;
}

function requireName(req: Request, res: Response): string | null {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return null;
  }
  return name.trim();
}

function isNameTaken(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

export function mountListCrudRoutes(router: Router, d: ListCrudDescriptor): void {
  const lower = d.label.toLowerCase();

  router.post('/lists', async (req: Request, res: Response) => {
    try {
      const name = requireName(req, res);
      if (name === null) return;
      const result = await query(
        `INSERT INTO ${d.lists} (user_id, name) VALUES ($1, $2) RETURNING ${d.returning}`,
        [currentUserId(), name]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (isNameTaken(err)) return res.status(409).json({ error: 'A list with that name already exists' });
      console.error(`Error creating ${lower}:`, err);
      res.status(500).json({ error: `Failed to create ${lower}` });
    }
  });

  router.put('/lists/:id', async (req: Request, res: Response) => {
    try {
      const name = requireName(req, res);
      if (name === null) return;
      const result = await query(
        `UPDATE ${d.lists} SET name = $2 WHERE id = $1 AND user_id = $3 RETURNING ${d.returning}`,
        [req.params.id, name, currentUserId()]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: `${d.label} not found` });
      res.json(result.rows[0]);
    } catch (err) {
      if (isNameTaken(err)) return res.status(409).json({ error: 'A list with that name already exists' });
      console.error(`Error renaming ${lower}:`, err);
      res.status(500).json({ error: `Failed to rename ${lower}` });
    }
  });

  // Items cascade.
  router.delete('/lists/:id', async (req: Request, res: Response) => {
    try {
      const result = await query(
        `DELETE FROM ${d.lists} WHERE id = $1 AND user_id = $2 RETURNING id`,
        [req.params.id, currentUserId()]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: `${d.label} not found` });
      res.json({ message: `${d.label} deleted`, id: result.rows[0].id });
    } catch (err) {
      console.error(`Error deleting ${lower}:`, err);
      res.status(500).json({ error: `Failed to delete ${lower}` });
    }
  });

  router.delete('/lists/:id/items/:itemId', async (req: Request, res: Response) => {
    try {
      const result = await query(
        `DELETE FROM ${d.items} i
         USING ${d.lists} l
         WHERE i.list_id = l.id AND l.id = $1 AND l.user_id = $2 AND i.${d.itemId} = $3
         RETURNING i.list_id`,
        [req.params.id, currentUserId(), req.params.itemId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: d.itemNotInList });
      res.json({ message: 'Removed from list' });
    } catch (err) {
      console.error(`Error removing item from ${lower}:`, err);
      res.status(500).json({ error: d.removeItemFailed });
    }
  });
}
