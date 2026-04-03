import { Router, Request, Response } from 'express';
import {
  listVenueMergeSuggestions,
  resolveVenueMergeSuggestion,
  type VenueMergeSuggestionStatus,
} from '../services/venueMerge';

const router = Router();

function isSuggestionStatus(value: unknown): value is VenueMergeSuggestionStatus | 'all' {
  return value === 'pending' || value === 'denied' || value === 'applied' || value === 'invalid' || value === 'all';
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const status = isSuggestionStatus(req.query.status) ? req.query.status : 'pending';
    const suggestions = await listVenueMergeSuggestions(status);
    res.json(suggestions);
  } catch (err) {
    console.error('Error listing venue merge suggestions:', err);
    res.status(500).json({ error: 'Failed to load venue merge suggestions' });
  }
});

router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const suggestionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await resolveVenueMergeSuggestion(suggestionId, 'approve');
    res.json(result);
  } catch (err: any) {
    const message = err?.message || 'Failed to approve venue merge suggestion';
    const statusCode = message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: message });
  }
});

router.post('/:id/deny', async (req: Request, res: Response) => {
  try {
    const suggestionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await resolveVenueMergeSuggestion(suggestionId, 'deny');
    res.json(result);
  } catch (err: any) {
    const message = err?.message || 'Failed to deny venue merge suggestion';
    const statusCode = message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: message });
  }
});

router.post('/resolve', async (req: Request, res: Response) => {
  try {
    const { ids, action } = req.body as { ids?: string[]; action?: 'approve' | 'deny' };

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    if (action !== 'approve' && action !== 'deny') {
      return res.status(400).json({ error: 'action must be approve or deny' });
    }

    const results = [] as Array<{ id: string; status: string; movedCheckins?: number; error?: string }>;

    for (const id of ids) {
      try {
        const result = await resolveVenueMergeSuggestion(id, action);
        results.push(result);
      } catch (err: any) {
        results.push({ id, status: 'error', error: err?.message || 'Resolution failed' });
      }
    }

    res.json({
      action,
      total: ids.length,
      resolved: results.filter((result) => result.status !== 'error').length,
      results,
    });
  } catch (err) {
    console.error('Error resolving venue merge suggestions:', err);
    res.status(500).json({ error: 'Failed to resolve venue merge suggestions' });
  }
});

export const venueMergesRouter = router;