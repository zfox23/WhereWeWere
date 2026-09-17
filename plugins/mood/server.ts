/**
 * Mood check-in type — server half.
 *
 * CUSTOM storage: Mood keeps its pre-existing tables (mood_checkins,
 * mood_activities, mood_activity_groups, mood_checkin_activities) so the
 * Daylio import, timestamp reconciliation, and activity-group manager keep
 * working untouched. The framework uses this half for the unified timeline,
 * backups, start-over, and mounts the plugin-owned API router.
 *
 * This router owns ALL mood-specific API surface (check-in CRUD, activity
 * groups/activities, stats, and the Daylio import) — no mood-specific routes
 * live in the core platform.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import * as unzipper from 'unzipper';
import type {
  CheckinTypeServerPlugin,
  PluginTimelineContext,
} from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query, pool } from '../../server/src/db';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { createImportUpload, removeImportFile } from '../../server/src/plugins/uploads';

import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

/**
 * Bare SQL expression computing the activities JSON array for a mood check-in
 * (`mc` in scope). Keep this WITHOUT a column alias so it can be embedded both
 * as the `activities` column and inside `json_build_object(...)` for `data`.
 */
const ACTIVITIES_JSON = `
  COALESCE(
    (SELECT json_agg(json_build_object(
      'id', ma.id, 'name', ma.name, 'group_name', mag.name, 'icon', ma.icon
    ) ORDER BY mag.display_order, ma.display_order)
    FROM mood_checkin_activities mca
    JOIN mood_activities ma ON mca.activity_id = ma.id
    JOIN mood_activity_groups mag ON ma.group_id = mag.id
    WHERE mca.mood_checkin_id = mc.id),
    '[]'::json
  )`;

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/mood-checkins
// (moved from server/src/routes/mood-checkins.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const router = Router();

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
             mc.checked_in_at, mc.created_at, mc.updated_at, mc.mood_timezone,
             ${ACTIVITIES_JSON} AS activities
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
              mc.checked_in_at, mc.created_at, mc.updated_at, mc.mood_timezone,
              ${ACTIVITIES_JSON} AS activities
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
    const { mood, note, checked_in_at, mood_timezone, activity_ids } = req.body;

    if (!mood || mood < 1 || mood > 5) {
      return res.status(400).json({ error: 'mood must be between 1 and 5' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, mood_timezone)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5)
       RETURNING *`,
      [USER_ID, mood, note || null, checked_in_at || null, mood_timezone || null]
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
    const { mood, note, checked_in_at, mood_timezone, activity_ids } = req.body;

    if (mood !== undefined && (mood < 1 || mood > 5)) {
      return res.status(400).json({ error: 'mood must be between 1 and 5' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE mood_checkins
       SET mood = COALESCE($2, mood),
           note = COALESCE($3, note),
           checked_in_at = COALESCE($4::timestamptz, checked_in_at),
           mood_timezone = COALESCE($5, mood_timezone)
       WHERE id = $1
       RETURNING *`,
      [id, mood ?? null, note, checked_in_at || null, mood_timezone || null]
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

// ---------------------------------------------------------------------------
// Activity groups / activities
// (moved from server/src/routes/mood-activities.ts; behavior unchanged)
// ---------------------------------------------------------------------------

// GET /activities/groups - list all activity groups with nested activities
router.get('/activities/groups', async (_req: Request, res: Response) => {
  try {
    const groupsResult = await query(
      `SELECT g.id, g.name, g.display_order,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', a.id,
                  'name', a.name,
                  'group_id', a.group_id,
                  'display_order', a.display_order,
                  'icon', a.icon,
                  'mood_checkin_count', (
                    SELECT COUNT(*)::int
                    FROM mood_checkin_activities mca
                    JOIN mood_checkins mc ON mc.id = mca.mood_checkin_id
                    WHERE mca.activity_id = a.id AND mc.user_id = $1
                  )
                ) ORDER BY a.display_order)
                FROM mood_activities a WHERE a.group_id = g.id),
                '[]'::json
              ) AS activities
       FROM mood_activity_groups g
       WHERE g.user_id = $1
       ORDER BY g.display_order`,
      [USER_ID]
    );

    res.json(groupsResult.rows);
  } catch (err) {
    console.error('Error listing activity groups:', err);
    res.status(500).json({ error: 'Failed to list activity groups' });
  }
});

// POST /activities/groups - create activity group
router.post('/activities/groups', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const maxOrder = await query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM mood_activity_groups WHERE user_id = $1',
      [USER_ID]
    );

    const result = await query(
      `INSERT INTO mood_activity_groups (user_id, name, display_order)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [USER_ID, name, maxOrder.rows[0].next_order]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating activity group:', err);
    res.status(500).json({ error: 'Failed to create activity group' });
  }
});

// PUT /activities/groups/:id - update activity group
router.put('/activities/groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, display_order } = req.body;

    const result = await query(
      `UPDATE mood_activity_groups
       SET name = COALESCE($2, name),
           display_order = COALESCE($3, display_order)
       WHERE id = $1 AND user_id = $4
       RETURNING *`,
      [id, name ?? null, display_order ?? null, USER_ID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity group not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating activity group:', err);
    res.status(500).json({ error: 'Failed to update activity group' });
  }
});

// DELETE /activities/groups/:id - delete activity group
router.delete('/activities/groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM mood_activity_groups WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, USER_ID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity group not found' });
    }

    res.json({ message: 'Activity group deleted', id });
  } catch (err) {
    console.error('Error deleting activity group:', err);
    res.status(500).json({ error: 'Failed to delete activity group' });
  }
});

// POST /activities/activities - create activity
router.post('/activities/activities', async (req: Request, res: Response) => {
  try {
    const { group_id, name, icon } = req.body;
    if (!group_id || !name) {
      return res.status(400).json({ error: 'group_id and name are required' });
    }

    const maxOrder = await query(
      'SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order FROM mood_activities WHERE group_id = $1',
      [group_id]
    );

    const result = await query(
      `INSERT INTO mood_activities (group_id, name, display_order, icon)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [group_id, name, maxOrder.rows[0].next_order, icon || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Failed to create activity' });
  }
});

// PUT /activities/activities/reorder - reorder activities in a group
router.put('/activities/activities/reorder', async (req: Request, res: Response) => {
  try {
    const { group_id, activity_ids } = req.body as {
      group_id?: string;
      activity_ids?: string[];
    };

    if (!group_id || !Array.isArray(activity_ids) || activity_ids.length === 0) {
      return res.status(400).json({ error: 'group_id and non-empty activity_ids are required' });
    }

    const existingActivities = await query(
      `SELECT id
       FROM mood_activities
       WHERE group_id = $1`,
      [group_id]
    );

    const existingIds = existingActivities.rows.map((row) => String(row.id));
    if (existingIds.length !== activity_ids.length) {
      return res.status(400).json({ error: 'activity_ids must include all activities in the group exactly once' });
    }

    const uniqueIncomingIds = new Set(activity_ids);
    if (uniqueIncomingIds.size !== activity_ids.length) {
      return res.status(400).json({ error: 'activity_ids contains duplicates' });
    }

    const existingIdSet = new Set(existingIds);
    const hasUnknownIds = activity_ids.some((id) => !existingIdSet.has(id));
    if (hasUnknownIds) {
      return res.status(400).json({ error: 'activity_ids contains IDs not in this group' });
    }

    const result = await query(
      `UPDATE mood_activities AS a
       SET display_order = ordered.display_order
       FROM (
         SELECT id, (ordinality - 1)::int AS display_order
         FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ordinality)
       ) AS ordered
       WHERE a.id = ordered.id
         AND a.group_id = $2
       RETURNING a.*`,
      [activity_ids, group_id]
    );

    if (result.rows.length !== activity_ids.length) {
      return res.status(400).json({ error: 'Failed to reorder all activities in group' });
    }

    res.json({ message: 'Activities reordered', count: result.rows.length });
  } catch (err) {
    console.error('Error reordering activities:', err);
    res.status(500).json({ error: 'Failed to reorder activities' });
  }
});

// PUT /activities/activities/:id - update activity
router.put('/activities/activities/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, group_id, display_order, icon } = req.body;

    const result = await query(
      `UPDATE mood_activities
       SET name = COALESCE($2, name),
           group_id = COALESCE($3, group_id),
           display_order = COALESCE($4, display_order),
           icon = CASE WHEN $5::varchar IS NOT NULL THEN $5 ELSE icon END
       WHERE id = $1
       RETURNING *`,
      [id, name ?? null, group_id ?? null, display_order ?? null, icon ?? null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating activity:', err);
    res.status(500).json({ error: 'Failed to update activity' });
  }
});

// DELETE /activities/activities/:id - delete activity
router.delete('/activities/activities/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM mood_activities WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    res.json({ message: 'Activity deleted', id });
  } catch (err) {
    console.error('Error deleting activity:', err);
    res.status(500).json({ error: 'Failed to delete activity' });
  }
});

// ---------------------------------------------------------------------------
// Stats (moved from the mood-* endpoints in server/src/routes/stats.ts)
// ---------------------------------------------------------------------------

const DATE_RANGE_WHERE = (hasRange: boolean) =>
  hasRange
    ? "AND (checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC'))::date BETWEEN $2::date AND $3::date"
    : '';
const DATE_RANGE_PARAMS = (user_id: unknown, from: unknown, to: unknown) =>
  typeof from === 'string' && typeof to === 'string' && from && to
    ? [user_id, from, to]
    : [user_id];

// GET /stats/daily - avg/min/max mood per day for line/span chart
router.get('/stats/daily', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `SELECT
         TO_CHAR(DATE(checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC')), 'YYYY-MM-DD') AS date,
         ROUND(AVG(mood)::numeric, 2)::float AS avg_mood,
         MIN(mood)::int AS min_mood,
         MAX(mood)::int AS max_mood,
         COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         ${DATE_RANGE_WHERE(hasRange)}
       GROUP BY DATE(checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC'))
       ORDER BY date ASC`,
      DATE_RANGE_PARAMS(user_id, from, to)
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-daily:', err);
    res.status(500).json({ error: 'Failed to get mood daily stats' });
  }
});

// GET /stats/monthly - count of each mood per month
router.get('/stats/monthly', async (req: Request, res: Response) => {
  try {
    const { user_id, year } = req.query;
    if (!user_id || !year) return res.status(400).json({ error: 'user_id and year are required' });

    const yearNum = parseInt(year as string, 10);

    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC')), 'YYYY-MM') AS month,
         mood,
         COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         AND EXTRACT(YEAR FROM checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC')) = $2
       GROUP BY month, mood
       ORDER BY month ASC, mood ASC`,
      [user_id, yearNum]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-monthly:', err);
    res.status(500).json({ error: 'Failed to get mood monthly stats' });
  }
});

// GET /stats/by-day-of-week - avg mood per day of week
router.get('/stats/by-day-of-week', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `SELECT
         EXTRACT(DOW FROM checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC'))::int AS dow,
         ROUND(AVG(mood)::numeric, 2)::float AS avg_mood,
         COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         ${DATE_RANGE_WHERE(hasRange)}
       GROUP BY dow
       ORDER BY dow`,
      DATE_RANGE_PARAMS(user_id, from, to)
    );

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dataMap = new Map(result.rows.map((r: any) => [r.dow, r]));
    const data = dayNames.map((name, i) => ({
      day: name,
      avg_mood: (dataMap.get(i) as any)?.avg_mood ?? null,
      count: (dataMap.get(i) as any)?.count ?? 0,
    }));

    res.json(data);
  } catch (err) {
    console.error('Error getting mood-by-day-of-week:', err);
    res.status(500).json({ error: 'Failed to get mood day-of-week stats' });
  }
});

// GET /stats/activity-correlations - avg mood and impact per activity (min 2 checkins)
router.get('/stats/activity-correlations', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `WITH filtered_checkins AS (
         SELECT id, mood
         FROM mood_checkins
         WHERE user_id = $1
           ${DATE_RANGE_WHERE(hasRange)}
       ),
       baseline AS (
         SELECT AVG(mood)::numeric AS avg_mood
         FROM filtered_checkins
       )
       SELECT
         ma.id AS activity_id,
         ma.name AS activity_name,
         mag.name AS group_name,
         ROUND(AVG(fc.mood)::numeric, 2)::float AS avg_mood,
         ROUND((AVG(fc.mood) - COALESCE((SELECT avg_mood FROM baseline), AVG(fc.mood)))::numeric, 2)::float AS mood_impact,
         COUNT(*)::int AS checkin_count
       FROM mood_checkin_activities mca
       JOIN mood_activities ma ON mca.activity_id = ma.id
       JOIN mood_activity_groups mag ON ma.group_id = mag.id
       JOIN filtered_checkins fc ON mca.mood_checkin_id = fc.id
       GROUP BY ma.id, ma.name, mag.name
       HAVING COUNT(*) >= 2
       ORDER BY mood_impact DESC, avg_mood DESC, checkin_count DESC`,
      DATE_RANGE_PARAMS(user_id, from, to)
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-activity-correlations:', err);
    res.status(500).json({ error: 'Failed to get mood activity correlations' });
  }
});

// GET /stats/activity-combinations - repeated multi-activity combinations (min 2 checkins)
router.get('/stats/activity-combinations', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `WITH filtered_checkins AS (
         SELECT id, mood
         FROM mood_checkins
         WHERE user_id = $1
           ${DATE_RANGE_WHERE(hasRange)}
       ),
       baseline AS (
         SELECT AVG(mood)::numeric AS avg_mood
         FROM filtered_checkins
       ),
       exact_combinations AS (
         SELECT
           fc.id AS mood_checkin_id,
           fc.mood,
           STRING_AGG(ma.id::text, ',' ORDER BY ma.name, ma.id::text) AS combination_key,
           STRING_AGG(ma.name, ' + ' ORDER BY ma.name, ma.id::text) AS combination_name,
           COUNT(*)::int AS activity_count
         FROM filtered_checkins fc
         JOIN mood_checkin_activities mca ON mca.mood_checkin_id = fc.id
         JOIN mood_activities ma ON ma.id = mca.activity_id
         GROUP BY fc.id, fc.mood
         HAVING COUNT(*) >= 2
       )
       SELECT
         combination_key,
         combination_name,
         activity_count,
         ROUND(AVG(mood)::numeric, 2)::float AS avg_mood,
         ROUND((AVG(mood) - COALESCE((SELECT avg_mood FROM baseline), AVG(mood)))::numeric, 2)::float AS mood_impact,
         COUNT(*)::int AS checkin_count
       FROM exact_combinations
       GROUP BY combination_key, combination_name, activity_count
       HAVING COUNT(*) >= 2
       ORDER BY mood_impact DESC, avg_mood DESC, checkin_count DESC, combination_name ASC`,
      DATE_RANGE_PARAMS(user_id, from, to)
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-activity-combinations:', err);
    res.status(500).json({ error: 'Failed to get mood activity combinations' });
  }
});

// GET /stats/count-range - count of each mood level in date range
router.get('/stats/count-range', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = Boolean(typeof from === 'string' && typeof to === 'string' && from && to);
    const result = await query(
      `SELECT mood, COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         ${DATE_RANGE_WHERE(hasRange)}
       GROUP BY mood
       ORDER BY mood ASC`,
      DATE_RANGE_PARAMS(user_id, from, to)
    );

    const countMap = new Map(result.rows.map((r: any) => [r.mood, r.count]));
    const data = [1, 2, 3, 4, 5].map((mood) => ({ mood, count: countMap.get(mood) || 0 }));

    res.json(data);
  } catch (err) {
    console.error('Error getting mood-count-range:', err);
    res.status(500).json({ error: 'Failed to get mood count range' });
  }
});

// GET /stats/heatmap - avg mood per day for year-in-pixels
router.get('/stats/heatmap', async (req: Request, res: Response) => {
  try {
    const { user_id, year } = req.query;
    if (!user_id || !year) return res.status(400).json({ error: 'user_id and year are required' });

    const yearNum = parseInt(year as string, 10);

    const result = await query(
      `SELECT
         TO_CHAR(DATE(checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC')), 'YYYY-MM-DD') AS date,
         ROUND(AVG(mood)::numeric, 1)::float AS avg_mood
       FROM mood_checkins
       WHERE user_id = $1
         AND (checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC'))::date >= $2::date
         AND (checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC'))::date < ($2::date + INTERVAL '1 year')
       GROUP BY DATE(checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC'))
       ORDER BY date ASC`,
      [user_id, `${yearNum}-01-01`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-heatmap:', err);
    res.status(500).json({ error: 'Failed to get mood heatmap' });
  }
});

// ---------------------------------------------------------------------------
// Daylio import
// (moved from server/src/routes/import-daylio.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const daylioUpload = createImportUpload({
  fileFilter: (file) =>
    file.mimetype === 'application/zip' || file.originalname.endsWith('.daylio')
      ? null
      : 'Only .daylio files are allowed',
});

interface DaylioEntry {
  id: number;
  datetime: number;
  timeZoneOffset?: number;
  mood: number;
  tags?: number[];
  note?: string;
}

interface DaylioTag {
  id: number;
  name: string;
  id_tag_group: number;
}

interface DaylioTagGroup {
  id: number;
  name: string;
}

interface DaylioBackup {
  dayEntries: DaylioEntry[];
  tags: DaylioTag[];
  tag_groups: DaylioTagGroup[];
  metadata?: {
    timezone?: string;
    timeZone?: string;
  };
}

function normalizeEpochMillis(value: number): number {
  // Daylio exports can use milliseconds, but some exports may provide seconds.
  return value < 1e12 ? value * 1000 : value;
}

/**
 * Custom mapping for known-broken Daylio timeZoneOffset values.
 * Used when Daylio records invalid offset values.
 */
const DAYLIO_OFFSET_FIXES: Record<number, string> = {
  57600000: 'America/Los_Angeles',  // Should be PDT (UTC-7)
  54000000: 'America/New_York',     // Should be EST (UTC-5)
};

/**
 * Convert a Daylio timeZoneOffset (ms, Android UTC offset convention) to an IANA
 * timezone name suitable for Intl.DateTimeFormat. Returns null for non-whole-hour
 * offsets (rare; caller should fall back to a named timezone).
 * Note: POSIX/IANA Etc/GMT sign is inverted relative to UTC offset:
 *   UTC-4 (offsetMs = -14400000) → Etc/GMT+4
 *   UTC+1 (offsetMs = +3600000)  → Etc/GMT-1
 */
function offsetMsToIanaTz(offsetMs: number): string | null {
  // Check custom fixes first
  if (offsetMs in DAYLIO_OFFSET_FIXES) {
    return DAYLIO_OFFSET_FIXES[offsetMs];
  }

  const totalMinutes = Math.round(offsetMs / 60000);
  if (totalMinutes % 60 !== 0) return null;
  const hours = totalMinutes / 60;
  if (hours === 0) return 'UTC';
  return `Etc/GMT${hours > 0 ? '-' : '+'}${Math.abs(hours)}`;
}

function formatOffset(raw: string): string {
  if (raw === 'GMT' || raw === 'UTC') return '+00:00';
  const cleaned = raw.replace(/^(GMT|UTC)/, '');
  const match = cleaned.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return '+00:00';
  const [, sign, hour, minute] = match;
  return `${sign}${hour.padStart(2, '0')}:${(minute || '00').padStart(2, '0')}`;
}

function toTimezoneAwareIso(epochMillis: number, timeZone: string): string {
  const date = new Date(epochMillis);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');
  const tzName = getPart('timeZoneName');
  const offset = formatOffset(tzName);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

// Icon mapping for common activities
const ACTIVITY_ICON_MAP: Record<string, string> = {
  // Social activities
  'friends': 'people-fill',
  'family': 'people-fill',
  'Date': 'heart',
  'girlfriend': 'heart',
  'boyfriend': 'heart',
  'talking to strangers': 'chat-bubble',
  'social': 'people-fill',
  'party': 'confetti',
  "friends i don't know yet": 'telescope',
  'meaningful conversations': 'chat-dots',
  'alone time': 'person',

  // Activities & Recreation
  'gaming': 'joystick',
  'board games': 'dice-1',
  'movies & tv': 'film',
  'reading': 'book',
  'music': 'music-note',
  'photography': 'camera',
  'videography': 'camera-video',
  'hiking': 'mountain',
  'climbing': 'mountain',
  'biking': 'bicycle',
  'walking': 'person-walking',
  'swimming': 'water',
  'dancing': 'disco',
  'outdoors': 'tree',
  'beach': 'water-waves',
  'relax': 'sun-glasses',
  'cooking': 'fire',

  // Work & Productivity
  'work': 'briefcase',
  'programming': 'code',
  'ai': 'lightbulb',
  'writing': 'pencil',
  'therapy': 'person-heart',
  'workout': 'dumbbell',

  // Health
  'adderall': 'pill',
  'caffeine': 'cup',
  'alcohol': 'cup',
  'weed': 'leaf',
  'mushrooms': 'leaf',
  'sick': 'face-tired',
  "crohn's flareup": 'heart-break',
  'pain': 'heart-break',
  'tummy ache': 'star',
  'sore voice': 'mic',
  'physically exhausted': 'hourglass-split',

  // Sleep
  'awake': 'eye',
  'tired': 'moon',
  'nap': 'moon',
  'sleep': 'moon',

  // Other
  'ate delicious food': 'heart',
  'cleaning': 'broom',
  'errands': 'arrow-down-up',
  'mosby disturbance': 'exclamation-triangle',
  'street noise': 'exclamation-triangle',
  'feeling strong': 'lightning-fill',
  'energized': 'lightning-fill',
  'focused': 'target',
  'calm': 'cloud-sun',
  'excited': 'star-fill',
  'anxious': 'exclamation-triangle',
  'angry': 'exclamation-triangle',
  'stress': 'exclamation-triangle',
  'bored': 'dash',
  'sad': 'heart-break',
  'suicidal': 'heart-break',
  'hopeless': 'heart-break',
  'frantic': 'lightning-fill',
  'valued': 'star-fill',
  'gratitude': 'hand-thumbs-up',
  'repair': 'screwdriver',
  'fussy': 'exclamation-triangle',
  'something amazing': 'star-fill',
  'something hilarious': 'emoji-laughing',
  'something frustrating': 'exclamation-triangle',
};

function guessActivityIcon(activityName: string): string {
  const lowercaseName = activityName.toLowerCase();

  // Direct lookup
  if (ACTIVITY_ICON_MAP[lowercaseName]) {
    return ACTIVITY_ICON_MAP[lowercaseName];
  }

  // Fuzzy matching
  for (const [key, icon] of Object.entries(ACTIVITY_ICON_MAP)) {
    if (lowercaseName.includes(key) || key.includes(lowercaseName)) {
      return icon;
    }
  }

  // Default icons based on activity name patterns
  if (lowercaseName.includes('work') || lowercaseName.includes('job')) return 'briefcase';
  if (lowercaseName.includes('play') || lowercaseName.includes('game')) return 'joystick';
  if (lowercaseName.includes('walk') || lowercaseName.includes('run')) return 'person-walking';
  if (lowercaseName.includes('exercise') || lowercaseName.includes('work out')) return 'dumbbell';
  if (lowercaseName.includes('eat') || lowercaseName.includes('cook')) return 'fire';
  if (lowercaseName.includes('sleep') || lowercaseName.includes('nap')) return 'moon';

  // Default fallback
  return 'circle-fill';
}

async function findOrCreateActivityGroup(
  name: string,
  cache: Map<string, string>
): Promise<string> {
  const key = `group:${name.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;

  const existing = await query(
    'SELECT id FROM mood_activity_groups WHERE user_id = $1 AND LOWER(name) = $2',
    [USER_ID, name.toLowerCase().trim()]
  );
  if (existing.rows.length > 0) {
    cache.set(key, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const result = await query(
    'INSERT INTO mood_activity_groups (user_id, name) VALUES ($1, $2) RETURNING id',
    [USER_ID, name.trim()]
  );
  cache.set(key, result.rows[0].id);
  return result.rows[0].id;
}

async function findOrCreateActivity(
  name: string,
  groupId: string,
  cache: Map<string, string>,
  icon?: string
): Promise<string> {
  const key = `activity:${groupId}:${name.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;

  const existing = await query(
    'SELECT id FROM mood_activities WHERE group_id = $1 AND LOWER(name) = $2',
    [groupId, name.toLowerCase().trim()]
  );
  if (existing.rows.length > 0) {
    cache.set(key, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const result = await query(
    'INSERT INTO mood_activities (group_id, name, icon) VALUES ($1, $2, $3) RETURNING id',
    [groupId, name.trim(), icon || null]
  );
  cache.set(key, result.rows[0].id);
  return result.rows[0].id;
}

async function extractBackupFromZip(zipPath: string): Promise<DaylioBackup> {
  return new Promise((resolve, reject) => {
    let backupContent = '';

    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', (entry: any) => {
        if (entry.path === 'backup.daylio') {
          entry.on('data', (data: Buffer) => {
            backupContent += data.toString('utf-8');
          });
          entry.on('end', () => {
            // backupContent is base64-encoded
            try {
              const decoded = Buffer.from(backupContent, 'base64').toString('utf-8');
              const parsed = JSON.parse(decoded) as DaylioBackup;
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse backup.daylio: ${(err as any).message}`));
            }
          });
        } else {
          entry.autodrain();
        }
      })
      .on('error', reject);
  });
}

// POST /import/daylio - import Daylio .daylio file
router.post('/import/daylio', daylioUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No .daylio file provided' });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const backup = await extractBackupFromZip(file.path);
    const importTimezoneRaw = (req.body?.source_timezone || req.body?.time_zone || '').toString().trim();
    const backupTimezoneRaw = backup.metadata?.timezone || backup.metadata?.timeZone || '';
    const selectedTimezone = [importTimezoneRaw, backupTimezoneRaw, 'UTC'].find((tz) => isValidTimeZone(tz)) || 'UTC';

    // Build tag ID -> tag name mapping
    const tagMap = new Map<number, string>();
    backup.tags.forEach((tag) => {
      tagMap.set(tag.id, tag.name);
    });

    // Build tag group ID -> group name mapping
    const tagGroupMap = new Map<number, string>();
    backup.tag_groups.forEach((group) => {
      tagGroupMap.set(group.id, group.name);
    });

    // Build tag ID -> tag group ID mapping
    const tagToGroupMap = new Map<number, number>();
    backup.tags.forEach((tag) => {
      tagToGroupMap.set(tag.id, tag.id_tag_group);
    });

    // Cache for groups and activities
    const cacheGroupId = new Map<string, string>();
    const cacheActivityId = new Map<string, string>();

    for (const entry of backup.dayEntries) {
      try {
        const { datetime, timeZoneOffset, mood, tags: tagIds = [], note = null } = entry;

        if (!datetime || !mood || mood < 1 || mood > 5) {
          skipped++;
          continue;
        }

        // Invert Daylio mood scale (1=Excellent→5, 5=Awful→1 in WhereWeWere)
        const invertedMood = 6 - mood;

        // Compute dedup hash from datetime
        const daylioHash = crypto
          .createHash('sha256')
          .update(`daylio:${datetime}`)
          .digest('hex')
          .slice(0, 16);

        // Check for duplicate
        const existing = await query(
          'SELECT id FROM mood_checkins WHERE daylio_hash = $1',
          [daylioHash]
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Determine the timezone for this entry:
        // Prefer the per-entry timeZoneOffset (converted to IANA name via fix map or Etc/GMT±N),
        // fall back to the global selectedTimezone from the import form / backup metadata.
        let entryIanaTz: string = selectedTimezone;
        if (timeZoneOffset !== undefined && timeZoneOffset !== null) {
          const convertedTz = offsetMsToIanaTz(timeZoneOffset);
          // If conversion failed (returns null), log and use selectedTimezone
          if (convertedTz === null && !isValidTimeZone(selectedTimezone)) {
            // Both offset conversion and selectedTimezone failed
            errors.push(
              `Entry ${entry.id} (${new Date(normalizeEpochMillis(datetime)).toISOString()}): ` +
              `timeZoneOffset ${timeZoneOffset} is invalid (not in fix map or convertible), ` +
              `and fallback timezone "${selectedTimezone}" is also invalid. Using UTC.`
            );
            entryIanaTz = 'UTC';
          } else if (convertedTz !== null) {
            // Conversion succeeded
            entryIanaTz = convertedTz;
          } else {
            // Offset conversion failed, but selectedTimezone is valid
            errors.push(
              `Entry ${entry.id}: timeZoneOffset ${timeZoneOffset} is not a whole hour. Using fallback: ${selectedTimezone}`
            );
          }
        }

        const checkedInAt = toTimezoneAwareIso(normalizeEpochMillis(datetime), entryIanaTz);

        // Insert mood checkin (with mood_timezone for correct display)
        const insertResult = await query(
          `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, daylio_hash, mood_timezone)
           VALUES ($1, $2, $3, $4::timestamptz, $5, $6)
           RETURNING id`,
          [USER_ID, invertedMood, note, checkedInAt, daylioHash, entryIanaTz]
        );

        const moodCheckinId = insertResult.rows[0].id;

        // Link activities (from tags)
        if (tagIds && tagIds.length > 0) {
          const tagNameSet = new Set<string>();

          for (const tagId of tagIds) {
            const tagName = tagMap.get(tagId);
            if (!tagName) continue;

            tagNameSet.add(tagName);
          }

          for (const tagName of tagNameSet) {
            try {
              // Find the tag and its group
              const tagId = [...tagMap.entries()].find(([_, name]) => name === tagName)?.[0];
              if (!tagId) continue;

              const groupId = tagToGroupMap.get(tagId);
              if (!groupId) continue;

              const groupName = tagGroupMap.get(groupId);
              if (!groupName) continue;

              // Find or create group
              const actGroupId = await findOrCreateActivityGroup(groupName, cacheGroupId);

              // Guess icon for activity
              const icon = guessActivityIcon(tagName);

              // Find or create activity
              const activityId = await findOrCreateActivity(tagName, actGroupId, cacheActivityId, icon);

              // Link activity to mood checkin
              await query(
                'INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [moodCheckinId, activityId]
              );
            } catch (actErr: any) {
              errors.push(`Failed to link activity "${tagName}": ${actErr.message}`);
            }
          }
        }

        imported++;
      } catch (rowErr: any) {
        errors.push(`Entry error: ${rowErr.message || rowErr}`);
        skipped++;
      }
    }

    // Clean up temp file
    removeImportFile(file.path);

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err: any) {
    console.error('Daylio import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message || String(err) });
  }
});

// POST /import/daylio/replace-br - replace literal <br> with newline in existing mood checkin notes
router.post('/import/daylio/replace-br', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `UPDATE mood_checkins
       SET note = REPLACE(note, '<br>', E'\n')
       WHERE user_id = $1
         AND note IS NOT NULL
         AND POSITION('<br>' IN note) > 0`,
      [USER_ID]
    );

    return res.json({ updated: result.rowCount ?? 0 });
  } catch (err: any) {
    console.error('Failed to replace <br> in mood checkins:', err);
    return res.status(500).json({ error: 'Failed to replace line breaks' });
  }
});

// ---------------------------------------------------------------------------
// Plugin server half
// ---------------------------------------------------------------------------

/** LLM label map for mood levels (used by the llm hook). */
const MOOD_LABELS: Record<number, string> = {
  1: 'bad',
  2: 'okay',
  3: 'neutral',
  4: 'good',
  5: 'great',
};

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: { mount: '/mood-checkins', router },

  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'mood'`,
        id: 'mc.id',
        user_id: 'mc.user_id',
        notes: 'mc.note',
        checked_in_at: 'mc.checked_in_at',
        created_at: 'mc.created_at',
        mood: 'mc.mood',
        mood_timezone: 'mc.mood_timezone',
        activities: ACTIVITIES_JSON,
        data: `json_build_object(
          'mood', mc.mood,
          'note', mc.note,
          'activities', ${ACTIVITIES_JSON}
        )::jsonb`,
        timezone: 'mc.mood_timezone',
      })}
      FROM mood_checkins mc
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'mc',
      timestampColumn: 'checked_in_at',
      timezoneColumn: 'mood_timezone',
      search: (c, q) => c.push(`mc.note ILIKE '%' || ? || '%'`, q),
    });

    const moodValue = ctx.filterParams.mood ? parseInt(ctx.filterParams.mood, 10) : NaN;
    if (moodValue >= 1 && moodValue <= 5) {
      conds.push('mc.mood = ?', moodValue);
    }
    if (ctx.filterParams.activity) {
      conds.push(
        `EXISTS (
          SELECT 1 FROM mood_checkin_activities mca2
          JOIN mood_activities ma2 ON mca2.activity_id = ma2.id
          WHERE mca2.mood_checkin_id = mc.id
            AND ma2.name ILIKE ?
        )`,
        ctx.filterParams.activity,
      );
    }

    return conds.build();
  },

  extraBackupTables: [
    {
      table: 'moodActivityGroups',
      select: `SELECT id, name, display_order, created_at, updated_at
               FROM mood_activity_groups WHERE user_id = $1 ORDER BY display_order`,
      // userIdFirst: the framework prepends user_id as the first parameter,
      // so user_id must be $1 here.
      insert: `INSERT INTO mood_activity_groups (user_id, id, name, display_order, created_at, updated_at)
               VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
               ON CONFLICT (id) DO NOTHING`,
      userIdFirst: true,
    },
    {
      table: 'moodActivities',
      select: `SELECT ma.id, ma.group_id, ma.name, ma.display_order, ma.icon, ma.created_at, ma.updated_at
               FROM mood_activities ma
               JOIN mood_activity_groups mag ON mag.id = ma.group_id
               WHERE mag.user_id = $1 ORDER BY mag.display_order, ma.display_order`,
      insert: `INSERT INTO mood_activities (id, group_id, name, display_order, icon, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()))
               ON CONFLICT (id) DO NOTHING`,
      userIdFirst: false,
    },
    {
      table: 'moodCheckinActivities',
      select: `SELECT mca.mood_checkin_id, mca.activity_id
               FROM mood_checkin_activities mca
               JOIN mood_checkins mc ON mc.id = mca.mood_checkin_id
               WHERE mc.user_id = $1`,
      insert: `INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
      userIdFirst: false,
    },
  ],

  // FK order: groups -> activities -> checkins -> junction
  backupOrder: ['moodActivityGroups', 'moodActivities', 'primary', 'moodCheckinActivities'],

  // When a backup carries a plugins.mood payload the framework restores via
  // backupImport/extraBackupTables and skips these legacy keys. Old backups
  // without a plugins payload keep the legacy import path.
  legacyBackupKeys: ['moodActivityGroups', 'moodActivities', 'moodCheckins', 'moodCheckinActivities'],

  backupExport: async ({ user_id }) => {
    const result = await query(
      `SELECT id, mood, note, checked_in_at, mood_timezone, created_at, updated_at, daylio_hash
       FROM mood_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
      [user_id],
    );
    return result.rows;
  },

  backupImport: async ({ user_id, client: txClient }, payload) => {
    const rows = Array.isArray(payload) ? payload : [];
    let inserted = 0;
    // Use the framework's transaction client when provided so restore stays
    // atomic; open our own connection only when running standalone.
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    try {
      for (const row of rows) {
        if (!row || typeof row.id !== 'string') continue;
        const result = await client.query(
          `INSERT INTO mood_checkins (id, user_id, mood, note, checked_in_at, mood_timezone, created_at, updated_at, daylio_hash)
           VALUES ($1, $2, $3, $4, $5::timestamptz, $6, COALESCE($7::timestamptz, NOW()), COALESCE($8::timestamptz, NOW()), $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            user_id,
            row.mood,
            row.note ?? null,
            row.checked_in_at,
            row.mood_timezone ?? null,
            row.created_at ?? null,
            row.updated_at ?? null,
            row.daylio_hash ?? null,
          ],
        );
        if ((result.rowCount ?? 0) > 0) inserted++;
      }
    } finally {
      if (ownsClient) client.release();
    }
    return inserted;
  },

  /**
   * Legacy backup restore (backups without a `plugins.mood` payload keep
   * mood rows under the top-level moodActivityGroups / moodActivities /
   * moodCheckins / moodCheckinActivities keys). Behavior mirrors the
   * pre-plugin core import loops.
   */
  restoreLegacyBackup: async ({ user_id, client: txClient }, data) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const counts: Record<string, { inserted: number; skipped: number }> = {
      moodActivityGroups: { inserted: 0, skipped: 0 },
      moodActivities: { inserted: 0, skipped: 0 },
      moodCheckins: { inserted: 0, skipped: 0 },
      moodCheckinActivities: { inserted: 0, skipped: 0 },
    };
    const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

    for (const group of asArray<Record<string, unknown>>(data.moodActivityGroups)) {
      if (!group?.id || !group.name) {
        counts.moodActivityGroups.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO mood_activity_groups (id, user_id, name, display_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [group.id, user_id, group.name, (group.display_order as number) ?? 0, group.created_at || null, group.updated_at || null]
      );
      (result.rowCount ?? 0) === 1 ? counts.moodActivityGroups.inserted += 1 : counts.moodActivityGroups.skipped += 1;
    }

    for (const activity of asArray<Record<string, unknown>>(data.moodActivities)) {
      if (!activity?.id || !activity.group_id || !activity.name) {
        counts.moodActivities.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO mood_activities (id, group_id, name, display_order, icon, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [
          activity.id,
          activity.group_id,
          activity.name,
          (activity.display_order as number) ?? 0,
          typeof activity.icon === 'string' && activity.icon.length > 0 ? activity.icon : null,
          activity.created_at || null,
          activity.updated_at || null,
        ]
      );
      (result.rowCount ?? 0) === 1 ? counts.moodActivities.inserted += 1 : counts.moodActivities.skipped += 1;
    }

    for (const row of asArray<Record<string, unknown>>(data.moodCheckins)) {
      if (!row?.id) {
        counts.moodCheckins.skipped += 1;
        continue;
      }
      const mood = Number(row.mood ?? 0);
      if (mood < 1 || mood > 5) {
        counts.moodCheckins.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO mood_checkins (
           id, user_id, mood, note,
           checked_in_at, mood_timezone, created_at, updated_at,
           daylio_hash
         )
         VALUES (
           $1, $2, $3, $4,
           COALESCE($5::timestamptz, NOW()), $6,
           COALESCE($7::timestamptz, NOW()),
           COALESCE($8::timestamptz, NOW()),
           $9
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          user_id,
          mood,
          (typeof row.note === 'string' && row.note) || null,
          row.checked_in_at || null,
          typeof row.mood_timezone === 'string' && row.mood_timezone ? row.mood_timezone : null,
          row.created_at || null,
          row.updated_at || null,
          (typeof row.daylio_hash === 'string' && row.daylio_hash) || null,
        ]
      );
      (result.rowCount ?? 0) === 1 ? counts.moodCheckins.inserted += 1 : counts.moodCheckins.skipped += 1;
    }

    for (const link of asArray<Record<string, unknown>>(data.moodCheckinActivities)) {
      if (!link?.mood_checkin_id || !link.activity_id) {
        counts.moodCheckinActivities.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id)
         VALUES ($1, $2)
         ON CONFLICT (mood_checkin_id, activity_id) DO NOTHING`,
        [link.mood_checkin_id, link.activity_id]
      );
      (result.rowCount ?? 0) === 1 ? counts.moodCheckinActivities.inserted += 1 : counts.moodCheckinActivities.skipped += 1;
    }

    return counts;
  },

  deleteUserData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const result = await run(
      'DELETE FROM mood_checkins WHERE user_id = $1 RETURNING id',
      [user_id],
    );
    return result.rowCount ?? 0;
  },

  settingsKeys: [
    {
      name: 'mood_icon_pack',
      type: 'string',
      label: 'Mood icon pack',
      default: 'emoji',
    },
  ],

  // `mood_icon_pack` used to live on user_settings (old backups still carry
  // it in settings.mood_icon_pack) — claim it so legacy restores land in
  // plugin_settings instead of a (now removed) user_settings column.
  legacySettingsKeys: ['mood_icon_pack'],

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo/scrobble anchor timestamps for Immich and Maloja enrichment.
  resolveTimestamps: () => ({
    sql: 'SELECT id, checked_in_at FROM mood_checkins WHERE id = ANY($1::uuid[])',
  }),

  // "This day in previous years" reflection branch.
  reflectionBranch: () => ({
    sql: `
      SELECT
        'mood' AS type,
        mc.id,
        mc.checked_in_at,
        mc.note,
        NULL::uuid AS venue_id,
        NULL::text AS venue_name,
        NULL::text AS city,
        NULL::text AS country,
        NULL::double precision AS latitude,
        NULL::double precision AS longitude,
        NULL::text AS venue_category,
        NULL::text AS venue_timezone,
        EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::int
        )::int AS years_ago,
        json_build_object(
          'mood', mc.mood,
          'mood_timezone', mc.mood_timezone,
          'activities', ${ACTIVITIES_JSON}
        )::jsonb AS data
      FROM mood_checkins mc
      WHERE mc.user_id = $1
        AND TO_CHAR(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // Earliest check-in date for the "all time" period selector.
  earliestDate: () => ({
    sql: `SELECT MIN(DATE(checked_in_at AT TIME ZONE COALESCE(mood_timezone, 'UTC')))::text AS date
          FROM mood_checkins WHERE user_id = $1`,
  }),

  // LLM life summary contribution.
  llm: {
    label: 'mood check-ins',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT mc.checked_in_at, mc.mood_timezone AS timezone,
                json_build_object(
                  'mood', mc.mood,
                  'note', mc.note,
                  COALESCE(
                    (
                      SELECT json_agg(json_build_object('name', ma.name, 'group_name', mag.name))
                      FROM mood_checkin_activities mca
                      JOIN mood_activities ma ON mca.activity_id = ma.id
                      JOIN mood_activity_groups mag ON mag.id = ma.group_id
                      WHERE mca.mood_checkin_id = mc.id
                    ),
                    '[]'::json
                  ) AS activities
                )::jsonb AS data
         FROM mood_checkins mc
         WHERE mc.user_id = $1
           AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date >= $2::date
           AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date <= $3::date
         ORDER BY mc.checked_in_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row) => {
      const d = row.data as { mood: number; note: string | null; activities: { name: string }[] };
      const acts = d.activities?.length
        ? ` (activities: ${d.activities.map((a) => a.name).join(', ')})`
        : '';
      const note = d.note ? ` — note: "${d.note}"` : '';
      const label = MOOD_LABELS[d.mood] || d.mood;
      return [`- mood: ${label}${acts}${note}`];
    },
  },

  // Timestamp reconciliation participation.
  reconcile: {
    anchorLabel: 'mood check-in',
    scanAll: true,
    detailPath: (id) => `/mood-checkins/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT id, checked_in_at, mood_timezone AS original_timezone
         FROM mood_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
        [user_id],
      );
      return result.rows;
    },
    apply: async (id, suggested_timezone) => {
      // Label-only: the stored instant is the true moment; reconciliation
      // only corrects the stored timezone label.
      const result = await query(
        `UPDATE mood_checkins
         SET mood_timezone = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, suggested_timezone],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },

  // Start-over: wipe the user-scoped activity groups/activities. The
  // framework deletes plugin_checkins (deleteUserData) and plugin_settings
  // rows on its own.
  resetSettings: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const groupsResult = await run(
      'DELETE FROM mood_activity_groups WHERE user_id = $1 RETURNING id',
      [user_id],
    );
    return groupsResult.rowCount ?? 0;
  },
};
