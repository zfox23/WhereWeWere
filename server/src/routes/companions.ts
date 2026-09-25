/**
 * Core companion routes.
 *
 * GET /api/v1/companions/names?q=&limit=
 *   Distinct companion names across all check-in types that implement
 *   companions, for the "Here With…" chip input autocomplete. The name pool
 *   is shared, so a name entered on any check-in type autocompletes on all.
 */

import { Router, Request, Response } from 'express';
import { searchCompanionNames } from '../services/companions';

const router = Router();

router.get('/names', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = req.query.limit != null ? String(req.query.limit) : '50';
    const names = await searchCompanionNames(q || null, limit);
    res.json(names);
  } catch (err) {
    console.error('Error listing companion names:', err);
    res.status(500).json({ error: 'Failed to list companion names' });
  }
});

export const companionsRouter = router;
