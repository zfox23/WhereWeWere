/**
 * Core companion routes.
 *
 * GET /api/v1/companions
 *   One row per companion name: check-in count and most recent check-in
 *   (feeds the Profile "Companions" tab).
 *
 * GET /api/v1/companions/names?q=&limit=
 *   Distinct companion names across all check-in types that implement
 *   companions, for the "Here With…" chip input autocomplete. The name pool
 *   is shared, so a name entered on any check-in type autocompletes on all.
 *
 * POST /api/v1/companions/names        { name }
 *   Add a standalone companion name to the shared pool (409 if it exists).
 *
 * PUT /api/v1/companions/names         { from, to }
 *   Rename a companion name across every check-in (and its standalone row).
 *
 * DELETE /api/v1/companions/names      { name }
 *   Remove a companion name from every check-in (and its standalone row).
 */

import { Router, Request, Response } from 'express';
import {
  searchCompanionNames,
  listCompanionSummaries,
  addCompanionName,
  renameCompanionName,
  deleteCompanionName,
} from '../services/companions';
import { pluginTimestampUnion } from '../plugins/registry';

const router = Router();

function sendError(res: Response, err: unknown): void {
  const error = err as Error & { status?: number };
  console.error('Companion request failed:', err);
  res.status(error.status ?? 500).json({ error: error.message || 'Companion request failed' });
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const summaries = await listCompanionSummaries(pluginTimestampUnion(''));
    res.json(summaries);
  } catch (err) {
    sendError(res, err);
  }
});

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

router.post('/names', async (req: Request, res: Response) => {
  try {
    const name = await addCompanionName(typeof req.body?.name === 'string' ? req.body.name : '');
    res.status(201).json({ name });
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/names', async (req: Request, res: Response) => {
  try {
    const from = typeof req.body?.from === 'string' ? req.body.from : '';
    const to = typeof req.body?.to === 'string' ? req.body.to : '';
    const updated = await renameCompanionName(from, to);
    res.json({ updated });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/names', async (req: Request, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const deleted = await deleteCompanionName(name);
    res.json({ deleted });
  } catch (err) {
    sendError(res, err);
  }
});

export const companionsRouter = router;
