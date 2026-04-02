import { Router, Request, Response } from 'express';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';

const router = Router();

function addTimezone(row: any): any {
  if (row.type === 'location' && row.venue_latitude != null && row.venue_longitude != null) {
    const tzResults = findTimezone(Number(row.venue_latitude), Number(row.venue_longitude));
    row.venue_timezone = tzResults[0] || null;
  }
  return row;
}

// GET / - unified timeline of location + mood checkins
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    // Mood/activity filters always return only mood checkins — handle as early return
    if (req.query.mood || req.query.activity) {
      const mp: unknown[] = [];
      const mc: string[] = [];
      let mi = 1;

      if (user_id) { mc.push(`mc.user_id = $${mi}`); mp.push(user_id); mi++; }
      if (from)    { mc.push(`mc.checked_in_at >= $${mi}`); mp.push(from); mi++; }
      if (to)      { mc.push(`mc.checked_in_at <= $${mi}`); mp.push(to); mi++; }

      if (req.query.mood) {
        const mv = parseInt(req.query.mood as string, 10);
        if (mv >= 1 && mv <= 5) { mc.push(`mc.mood = $${mi}`); mp.push(mv); mi++; }
      }

      if (req.query.activity) {
        mc.push(
          `EXISTS (
            SELECT 1 FROM mood_checkin_activities mca2
            JOIN mood_activities ma2 ON mca2.activity_id = ma2.id
            WHERE mca2.mood_checkin_id = mc.id
              AND ma2.name ILIKE $${mi}
          )`
        );
        mp.push(req.query.activity as string);
        mi++;
      }

      mp.push(parseInt(limit as string, 10));
      const lp = `$${mi}`; mi++;
      mp.push(parseInt(offset as string, 10));
      const op = `$${mi}`;

      const wh = mc.length > 0 ? `WHERE ${mc.join(' AND ')}` : '';
      const sql = `
        SELECT 'mood' AS type, mc.id, mc.user_id, NULL AS venue_id, mc.note AS notes, NULL AS rating,
               mc.checked_in_at, mc.created_at,
               NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
               NULL AS venue_category,
               NULL AS parent_venue_id, NULL AS parent_venue_name,
               mc.mood,
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
        ${wh}
        ORDER BY mc.checked_in_at DESC
        LIMIT ${lp} OFFSET ${op}
      `;
      const result = await query(sql, mp);
      return res.json(result.rows.map(addTimezone));
    }

    const params: unknown[] = [];
    const locationConditions: string[] = [];
    const moodConditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      locationConditions.push(`c.user_id = $${paramIndex}`);
      moodConditions.push(`mc.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from) {
      locationConditions.push(`c.checked_in_at >= $${paramIndex}`);
      moodConditions.push(`mc.checked_in_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      locationConditions.push(`c.checked_in_at <= $${paramIndex}`);
      moodConditions.push(`mc.checked_in_at <= $${paramIndex}`);
      params.push(to);
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

    if (req.query.q) {
      const searchQuery = req.query.q as string;
      locationConditions.push(
        `(c.search_vector @@ plainto_tsquery('english', $${paramIndex})
         OR v.search_vector @@ plainto_tsquery('english', $${paramIndex}))`
      );
      moodConditions.push(
        `mc.note ILIKE '%' || $${paramIndex} || '%'`
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

    // If location-only filters are active, exclude mood checkins
    const hasLocationOnlyFilter = req.query.category || req.query.country;

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    let sql: string;

    if (hasLocationOnlyFilter) {
      // Only location checkins when location-specific filters are active
      sql = `
        SELECT 'location' AS type, c.id, c.user_id, c.venue_id, c.notes, c.rating,
               c.checked_in_at, c.created_at,
               v.name AS venue_name, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
               vc.name AS venue_category,
               pv.id AS parent_venue_id, pv.name AS parent_venue_name,
               NULL::smallint AS mood, NULL::json AS activities
        FROM checkins c
        JOIN venues v ON c.venue_id = v.id
        LEFT JOIN venue_categories vc ON v.category_id = vc.id
        LEFT JOIN venues pv ON v.parent_venue_id = pv.id
        ${locationWhere}
        ORDER BY c.checked_in_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;
    } else {
      sql = `
        (
          SELECT 'location' AS type, c.id, c.user_id, c.venue_id, c.notes, c.rating,
                 c.checked_in_at, c.created_at,
                 v.name AS venue_name, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
                 vc.name AS venue_category,
                 pv.id AS parent_venue_id, pv.name AS parent_venue_name,
                 NULL::smallint AS mood, NULL::json AS activities
          FROM checkins c
          JOIN venues v ON c.venue_id = v.id
          LEFT JOIN venue_categories vc ON v.category_id = vc.id
          LEFT JOIN venues pv ON v.parent_venue_id = pv.id
          ${locationWhere}
        )
        UNION ALL
        (
          SELECT 'mood' AS type, mc.id, mc.user_id, NULL AS venue_id, mc.note AS notes, NULL AS rating,
                 mc.checked_in_at, mc.created_at,
                 NULL AS venue_name, NULL AS venue_latitude, NULL AS venue_longitude,
                 NULL AS venue_category,
                 NULL AS parent_venue_id, NULL AS parent_venue_name,
                 mc.mood,
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
          ${moodWhere}
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
