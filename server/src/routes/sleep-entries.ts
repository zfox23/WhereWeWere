import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();
const USER_ID = '00000000-0000-0000-0000-000000000001';

function sanitizeTimezone(value: unknown): string {
  const tz = String(value || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function normalizeRating(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
}

function normalizeComment(value: unknown): string | null {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

// GET / - list sleep entries
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id,
      from,
      to,
      limit = '50',
      offset = '0',
    } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`se.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`(se.started_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date >= $${paramIndex}::date`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`(se.started_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date <= $${paramIndex}::date`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const result = await query(
      `SELECT se.id, se.user_id, se.sleep_as_android_id, se.sleep_timezone,
              se.started_at, se.ended_at, se.rating, se.comment,
              se.created_at, se.updated_at
       FROM sleep_entries se
       ${whereClause}
       ORDER BY se.started_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing sleep entries:', err);
    res.status(500).json({ error: 'Failed to list sleep entries' });
  }
});

// GET /:id - get single sleep entry
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT se.id, se.user_id, se.sleep_as_android_id, se.sleep_timezone,
              se.started_at, se.ended_at, se.rating, se.comment,
              se.created_at, se.updated_at
       FROM sleep_entries se
       WHERE se.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting sleep entry:', err);
    res.status(500).json({ error: 'Failed to get sleep entry' });
  }
});

// POST / - create sleep entry
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      sleep_as_android_id,
      sleep_timezone,
      started_at,
      ended_at,
      rating,
      comment,
    } = req.body;

    if (!started_at || !ended_at) {
      return res.status(400).json({ error: 'started_at and ended_at are required' });
    }

    const result = await query(
      `INSERT INTO sleep_entries (
         user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, rating, comment
       )
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
       RETURNING *`,
      [
        USER_ID,
        Number.isFinite(Number(sleep_as_android_id)) ? Number(sleep_as_android_id) : Date.now(),
        sanitizeTimezone(sleep_timezone),
        started_at,
        ended_at,
        normalizeRating(rating),
        normalizeComment(comment),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Duplicate sleep_as_android_id for this user' });
    }
    console.error('Error creating sleep entry:', err);
    res.status(500).json({ error: 'Failed to create sleep entry' });
  }
});

// PUT /:id - update sleep entry
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      sleep_timezone,
      started_at,
      ended_at,
      rating,
      comment,
    } = req.body;

    const result = await query(
      `UPDATE sleep_entries
       SET sleep_timezone = COALESCE($2, sleep_timezone),
           started_at = COALESCE($3::timestamptz, started_at),
           ended_at = COALESCE($4::timestamptz, ended_at),
           rating = COALESCE($5, rating),
           comment = $6,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        sleep_timezone != null ? sanitizeTimezone(sleep_timezone) : null,
        started_at || null,
        ended_at || null,
        rating != null ? normalizeRating(rating) : null,
        normalizeComment(comment),
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating sleep entry:', err);
    res.status(500).json({ error: 'Failed to update sleep entry' });
  }
});

// DELETE /:id - delete sleep entry
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM sleep_entries WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sleep entry not found' });
    }

    res.json({ message: 'Sleep entry deleted', id });
  } catch (err) {
    console.error('Error deleting sleep entry:', err);
    res.status(500).json({ error: 'Failed to delete sleep entry' });
  }
});

export const sleepEntriesRouter = router;
