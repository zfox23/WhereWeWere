/**
 * Mood check-in type — server half.
 *
 * CUSTOM storage: Mood keeps its pre-existing tables (mood_checkins,
 * mood_activities, mood_activity_groups, mood_checkin_activities) so the
 * Daylio import, timestamp reconciliation, and activity-group manager keep
 * working untouched. The framework uses this half for the unified timeline,
 * backups, start-over, and mounts the plugin-owned API router.
 */

import { Router, Request, Response } from 'express';
import type {
  CheckinTypeServerPlugin,
  PluginTimelineContext,
} from 'wwp-shared';
import { query, pool } from '../../server/src/db';

const USER_ID = '00000000-0000-0000-0000-000000000001';

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
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', ma.id, 'name', ma.name, 'group_name', mag.name, 'icon', ma.icon
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
              mc.checked_in_at, mc.created_at, mc.updated_at, mc.mood_timezone,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', ma.id, 'name', ma.name, 'group_name', mag.name, 'icon', ma.icon
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
// Plugin server half
// ---------------------------------------------------------------------------

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: { mount: '/mood-checkins', router },

  buildTimelineSelect: () => ({
    sql: `
      SELECT 'mood' AS type, mc.id, mc.user_id, NULL AS venue_id, mc.note AS notes,
             mc.checked_in_at, mc.created_at,
             NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
             NULL::text AS venue_timezone,
             NULL AS venue_category,
             NULL AS parent_venue_id, NULL AS parent_venue_name,
             mc.mood, mc.mood_timezone,
             COALESCE(
               (SELECT json_agg(json_build_object(
                 'id', ma.id, 'name', ma.name, 'group_name', mag.name, 'icon', ma.icon
               ) ORDER BY mag.display_order, ma.display_order)
               FROM mood_checkin_activities mca
               JOIN mood_activities ma ON mca.activity_id = ma.id
               JOIN mood_activity_groups mag ON ma.group_id = mag.id
               WHERE mca.mood_checkin_id = mc.id),
               '[]'::json
             ) AS activities,
             NULL::bigint AS sleep_as_android_id,
             NULL::timestamptz AS sleep_started_at,
             NULL::timestamptz AS sleep_ended_at,
             NULL::text AS sleep_timezone,
             NULL::numeric AS sleep_rating,
             NULL::text AS sleep_comment,
             NULL::text AS track_name,
             NULL::numeric AS track_distance_m,
             NULL::text AS track_timezone,
             NULL::timestamptz AS track_started_at,
             NULL::timestamptz AS track_ended_at,
             NULL::bigint AS track_elapsed_time_s,
             NULL::text AS media_type,
             NULL::uuid AS media_item_id,
             NULL::text AS media_title,
             NULL::text AS media_image_url,
             NULL::text AS media_author,
             NULL::smallint AS media_rating,
             NULL::text AS media_checkin_type,
             NULL::int AS media_season_number,
             NULL::int AS media_episode_number,
             NULL::text AS media_episode_title,
             NULL::text AS media_timezone,
             json_build_object(
               'mood', mc.mood,
               'note', mc.note,
               'activities', COALESCE(
                 (SELECT json_agg(json_build_object(
                   'id', ma2.id, 'name', ma2.name, 'group_name', mag2.name, 'icon', ma2.icon
                 ) ORDER BY mag2.display_order, ma2.display_order)
                 FROM mood_checkin_activities mca2
                 JOIN mood_activities ma2 ON mca2.activity_id = ma2.id
                 JOIN mood_activity_groups mag2 ON ma2.group_id = mag2.id
                 WHERE mca2.mood_checkin_id = mc.id),
                 '[]'::json
               )
             )::jsonb AS data
      FROM mood_checkins mc
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const push = (cond: string, value: unknown) => {
      values.push(value);
      conditions.push(cond.replace('?', `$${values.length}`));
    };

    if (ctx.user_id) {
      push('mc.user_id = ?', ctx.user_id);
    }
    if (ctx.from) {
      push(`(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date >= ?::date`, ctx.from);
    }
    if (ctx.to) {
      push(`(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date <= ?::date`, ctx.to);
    }
    if (ctx.q) {
      push(`mc.note ILIKE '%' || ? || '%'`, ctx.q);
    }

    const moodValue = ctx.filterParams.mood ? parseInt(ctx.filterParams.mood, 10) : NaN;
    if (moodValue >= 1 && moodValue <= 5) {
      push('mc.mood = ?', moodValue);
    }
    if (ctx.filterParams.activity) {
      push(
        `EXISTS (
          SELECT 1 FROM mood_checkin_activities mca2
          JOIN mood_activities ma2 ON mca2.activity_id = ma2.id
          WHERE mca2.mood_checkin_id = mc.id
            AND ma2.name ILIKE ?
        )`,
        ctx.filterParams.activity,
      );
    }

    return { sql: conditions.length > 0 ? conditions.join(' AND ') : null, values };
  },

  extraBackupTables: [
    {
      table: 'moodActivityGroups',
      select: `SELECT id, name, display_order, created_at, updated_at
               FROM mood_activity_groups WHERE user_id = $1 ORDER BY display_order`,
      insert: `INSERT INTO mood_activity_groups (id, user_id, name, display_order, created_at, updated_at)
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

  deleteUserData: async ({ user_id, client: txClient }) => {
    if (txClient) {
      const result = await txClient.query(
        'DELETE FROM mood_checkins WHERE user_id = $1 RETURNING id',
        [user_id],
      );
      return result.rowCount ?? 0;
    }
    const result = await query('DELETE FROM mood_checkins WHERE user_id = $1 RETURNING id', [user_id]);
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
};
