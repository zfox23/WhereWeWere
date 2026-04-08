import { Router, Request, Response } from 'express';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';

const router = Router();

function addTimezone(row: any): any {
  if (row.type === 'location' && !row.venue_timezone && row.venue_latitude != null && row.venue_longitude != null) {
    const tzResults = findTimezone(Number(row.venue_latitude), Number(row.venue_longitude));
    row.venue_timezone = tzResults[0] || null;
  }
  return row;
}

function extractDateString(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// GET / - unified timeline of location + mood checkins
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    const params: unknown[] = [];
    const locationConditions: string[] = [];
    const moodConditions: string[] = [];
    const sleepConditions: string[] = [];
    let paramIndex = 1;
    const hasMoodTypeFilter = Boolean(req.query.mood || req.query.activity);
    const hasLocationTypeFilter = Boolean(req.query.venue_id || req.query.category || req.query.country);
    const hasSleepTypeFilter = Boolean(req.query.sleep_duration);
    const fromDate = extractDateString(from);
    const toDate = extractDateString(to);

    if (user_id) {
      locationConditions.push(`c.user_id = $${paramIndex}`);
      moodConditions.push(`mc.user_id = $${paramIndex}`);
      sleepConditions.push(`se.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (fromDate) {
      locationConditions.push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= $${paramIndex}::date`);
      moodConditions.push(`(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date >= $${paramIndex}::date`);
      sleepConditions.push(`(se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date >= $${paramIndex}::date`);
      params.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      locationConditions.push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= $${paramIndex}::date`);
      moodConditions.push(`(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::date <= $${paramIndex}::date`);
      sleepConditions.push(`(se.ended_at AT TIME ZONE COALESCE(se.sleep_timezone, 'UTC'))::date <= $${paramIndex}::date`);
      params.push(toDate);
      paramIndex++;
    }

    if (req.query.venue_id) {
      locationConditions.push(`c.venue_id = $${paramIndex}`);
      params.push(req.query.venue_id);
      paramIndex++;
    }

    // Location-only filters
    if (req.query.category) {
      locationConditions.push(`vc.name = $${paramIndex}`);
      params.push(req.query.category);
      paramIndex++;
    }

    if (req.query.country) {
      locationConditions.push(`v.country = $${paramIndex}`);
      params.push(req.query.country);
      paramIndex++;
    }

    if (req.query.mood) {
      const moodValue = parseInt(req.query.mood as string, 10);
      if (moodValue >= 1 && moodValue <= 5) {
        moodConditions.push(`mc.mood = $${paramIndex}`);
        params.push(moodValue);
        paramIndex++;
      }
    }

    if (req.query.activity) {
      moodConditions.push(
        `EXISTS (
          SELECT 1 FROM mood_checkin_activities mca2
          JOIN mood_activities ma2 ON mca2.activity_id = ma2.id
          WHERE mca2.mood_checkin_id = mc.id
            AND ma2.name ILIKE $${paramIndex}
        )`
      );
      params.push(req.query.activity);
      paramIndex++;
    }

    if (req.query.sleep_duration) {
      const durationFilter = String(req.query.sleep_duration).toLowerCase();
      if (durationFilter === 'lte6') {
        sleepConditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) <= 21600`);
      } else if (durationFilter === '6to8') {
        sleepConditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) > 21600`);
        sleepConditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) < 28800`);
      } else if (durationFilter === 'gte8') {
        sleepConditions.push(`EXTRACT(EPOCH FROM (se.ended_at - se.started_at)) >= 28800`);
      }
    }

    if (req.query.q) {
      const searchQuery = req.query.q as string;
      locationConditions.push(
        `(c.search_vector @@ plainto_tsquery('english', $${paramIndex})
         OR v.search_vector @@ plainto_tsquery('english', $${paramIndex}))`
      );
      moodConditions.push(
        `mc.note ILIKE '%' || $${paramIndex} || '%'`
      );
      sleepConditions.push(
        `se.comment ILIKE '%' || $${paramIndex} || '%'`
      );
      params.push(searchQuery);
      paramIndex++;
    }

    const locationWhere = locationConditions.length > 0
      ? `WHERE ${locationConditions.join(' AND ')}`
      : '';
    const moodWhere = moodConditions.length > 0
      ? `WHERE ${moodConditions.join(' AND ')}`
      : '';
    const sleepWhere = sleepConditions.length > 0
      ? `WHERE ${sleepConditions.join(' AND ')}`
      : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const locationSelect = `
      SELECT 'location' AS type, c.id, c.user_id, c.venue_id, c.notes,
             c.checked_in_at, c.created_at,
             v.name AS venue_name, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
              c.checkin_timezone AS venue_timezone,
             vc.name AS venue_category,
             pv.id AS parent_venue_id, pv.name AS parent_venue_name,
        NULL::smallint AS mood, NULL::text AS mood_timezone, NULL::json AS activities,
        NULL::bigint AS sleep_as_android_id,
        NULL::timestamptz AS sleep_started_at,
        NULL::timestamptz AS sleep_ended_at,
        NULL::text AS sleep_timezone,
        NULL::numeric AS sleep_rating,
        NULL::text AS sleep_comment
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      LEFT JOIN venues pv ON v.parent_venue_id = pv.id
      ${locationWhere}
    `;

    const moodSelect = `
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
             NULL::text AS sleep_comment
      FROM mood_checkins mc
      ${moodWhere}
    `;

    const sleepSelect = `
      SELECT 'sleep' AS type, se.id, se.user_id, NULL AS venue_id, se.comment AS notes,
             se.started_at AS checked_in_at, se.created_at,
             NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
             NULL::text AS venue_timezone,
             NULL AS venue_category,
             NULL AS parent_venue_id, NULL AS parent_venue_name,
             NULL::smallint AS mood, NULL::text AS mood_timezone, NULL::json AS activities,
             se.sleep_as_android_id, se.started_at AS sleep_started_at,
             se.ended_at AS sleep_ended_at, se.sleep_timezone,
             se.rating AS sleep_rating, se.comment AS sleep_comment
      FROM sleep_entries se
      ${sleepWhere}
    `;

    let sql: string;

    if (hasMoodTypeFilter) {
      sql = `
        ${moodSelect}
        ORDER BY checked_in_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;
    } else if (hasLocationTypeFilter) {
      sql = `
        ${locationSelect}
        ORDER BY checked_in_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;
    } else if (hasSleepTypeFilter) {
      sql = `
        ${sleepSelect}
        ORDER BY checked_in_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;
    } else {
      sql = `
        (
          ${locationSelect}
        )
        UNION ALL
        (
          ${moodSelect}
        )
        UNION ALL
        (
          ${sleepSelect}
        )
        ORDER BY checked_in_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;
    }

    const result = await query(sql, params);
    res.json(result.rows.map(addTimezone));
  } catch (err) {
    console.error('Error listing timeline:', err);
    res.status(500).json({ error: 'Failed to list timeline' });
  }
});

export const timelineRouter = router;
