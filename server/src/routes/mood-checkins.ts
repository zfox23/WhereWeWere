import { Router, Request, Response } from 'express';
import { query, pool } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

// GET / - list mood checkins with activities
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`mc.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`mc.checked_in_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`mc.checked_in_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const sql = `
      SELECT mc.id, mc.user_id, mc.mood, mc.note,
             mc.checked_in_at, mc.created_at, mc.updated_at,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', ma.id, 'name', ma.name, 'group_name', mag.name
               ) ORDER BY mag.display_order, ma.display_order)
               FROM mood_checkin_activities mca
               JOIN mood_activities ma ON mca.activity_id = ma.id
               JOIN mood_activity_groups mag ON ma.group_id = mag.id
               WHERE mca.mood_checkin_id = mc.id),
               '[]'::json
             ) AS activities
      FROM mood_checkins mc
      ${whereClause}
      ORDER BY mc.checked_in_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing mood checkins:', err);
    res.status(500).json({ error: 'Failed to list mood checkins' });
  }
});

// GET /:id - get single mood checkin with activities
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT mc.id, mc.user_id, mc.mood, mc.note,
              mc.checked_in_at, mc.created_at, mc.updated_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', ma.id, 'name', ma.name, 'group_name', mag.name
                ) ORDER BY mag.display_order, ma.display_order)
                FROM mood_checkin_activities mca
                JOIN mood_activities ma ON mca.activity_id = ma.id
                JOIN mood_activity_groups mag ON ma.group_id = mag.id
                WHERE mca.mood_checkin_id = mc.id),
                '[]'::json
              ) AS activities
       FROM mood_checkins mc
       WHERE mc.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mood checkin not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting mood checkin:', err);
    res.status(500).json({ error: 'Failed to get mood checkin' });
  }
});

// POST / - create mood checkin
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { mood, note, checked_in_at, activity_ids } = req.body;

    if (!mood || mood < 1 || mood > 5) {
      return res.status(400).json({ error: 'mood must be between 1 and 5' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
       RETURNING *`,
      [USER_ID, mood, note || null, checked_in_at || null]
    );

    const moodCheckin = result.rows[0];

    if (activity_ids && activity_ids.length > 0) {
      const values = activity_ids.map((_: string, i: number) =>
        `($1, $${i + 2})`
      ).join(', ');
      await client.query(
        `INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id)
         VALUES ${values}`,
        [moodCheckin.id, ...activity_ids]
      );
    }

    await client.query('COMMIT');

    res.status(201).json(moodCheckin);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating mood checkin:', err);
    res.status(500).json({ error: 'Failed to create mood checkin' });
  } finally {
    client.release();
  }
});

// PUT /:id - update mood checkin
router.put('/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { mood, note, checked_in_at, activity_ids } = req.body;

    if (mood !== undefined && (mood < 1 || mood > 5)) {
      return res.status(400).json({ error: 'mood must be between 1 and 5' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE mood_checkins
       SET mood = COALESCE($2, mood),
           note = COALESCE($3, note),
           checked_in_at = COALESCE($4::timestamptz, checked_in_at)
       WHERE id = $1
       RETURNING *`,
      [id, mood ?? null, note, checked_in_at || null]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mood checkin not found' });
    }

    if (activity_ids !== undefined) {
      await client.query(
        'DELETE FROM mood_checkin_activities WHERE mood_checkin_id = $1',
        [id]
      );
      if (activity_ids.length > 0) {
        const values = activity_ids.map((_: string, i: number) =>
          `($1, $${i + 2})`
        ).join(', ');
        await client.query(
          `INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id)
           VALUES ${values}`,
          [id, ...activity_ids]
        );
      }
    }

    await client.query('COMMIT');

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating mood checkin:', err);
    res.status(500).json({ error: 'Failed to update mood checkin' });
  } finally {
    client.release();
  }
});

// DELETE /:id - delete mood checkin
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM mood_checkins WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mood checkin not found' });
    }

    res.json({ message: 'Mood checkin deleted', id });
  } catch (err) {
    console.error('Error deleting mood checkin:', err);
    res.status(500).json({ error: 'Failed to delete mood checkin' });
  }
});

export const moodCheckinsRouter = router;
