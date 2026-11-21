/** /location-checkins/stats/* — location stats (mounted by the check-ins router). */

import { Router, Request, Response } from 'express';
import { query } from '../../../server/src/db';
import { pagination, parseYear, parseMonth } from '../../../server/src/services/queryParams';
import { currentUserId } from '../../../server/src/auth/context';

export const statsRouter = Router();

function buildDateRangeClause(from: unknown, to: unknown, column: string, timezoneColumn?: string) {
  const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
  const localDateExpr = timezoneColumn
    ? `(${column} AT TIME ZONE COALESCE(${timezoneColumn}, 'UTC'))::date`
    : `(${column})::date`;
  return {
    hasRange,
    whereClause: hasRange
      ? ` AND ${localDateExpr} >= $2::date AND ${localDateExpr} <= $3::date`
      : '',
    params: hasRange ? [from, to] : [],
  };
}

// GET /stats/summary - overall stats summary
statsRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at', 'c.checkin_timezone');

    const result = await query(
      `SELECT
         COUNT(c.id)::int AS total_checkins,
         COUNT(DISTINCT c.venue_id)::int AS unique_venues,
         COUNT(DISTINCT DATE(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC')))::int AS days_with_checkins,
         u.created_at AS member_since
       FROM checkins c
       JOIN users u ON u.id = $1
       WHERE c.user_id = $1
         ${whereClause}
       GROUP BY u.created_at`,
      [user_id, ...rangeParams]
    );

    if (result.rows.length === 0) {
      // User exists but has no check-ins
      const userResult = await query(
        'SELECT created_at FROM users WHERE id = $1',
        [user_id]
      );

      return res.json({
        total_checkins: 0,
        unique_venues: 0,
        days_with_checkins: 0,
        member_since: userResult.rows.length > 0
          ? userResult.rows[0].created_at
          : null,
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting summary:', err);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// GET /stats/top-venues?limit=10 - most visited venues
statsRouter.get('/top-venues', async (req: Request, res: Response) => {
  try {
    const { limit = '10', from, to } = req.query;
    const user_id = currentUserId();

    const { hasRange, whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at', 'c.checkin_timezone');
    const limitParamIndex = hasRange ? 4 : 2;

    const result = await query(
      `SELECT v.id AS venue_id, v.name AS venue_name, v.address, v.city, v.state,
              vc.name AS category_name, vc.icon AS category_icon,
              COUNT(c.id)::int AS checkin_count,
              MAX(c.checked_in_at) AS last_checkin
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
         ${whereClause}
       GROUP BY v.id, vc.name, vc.icon
       ORDER BY checkin_count DESC
       LIMIT $${limitParamIndex}`,
      [user_id, ...rangeParams, pagination(limit, 0, { limit: 10, maxLimit: 200 }).limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting top venues:', err);
    res.status(500).json({ error: 'Failed to get top venues' });
  }
});

// GET /stats/category-breakdown - check-ins by category
statsRouter.get('/category-breakdown', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at', 'c.checkin_timezone');

    const result = await query(
      `SELECT COALESCE(vc.name, 'Uncategorized') AS category_name,
              vc.icon AS category_icon,
              COUNT(c.id)::int AS checkin_count
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
         ${whereClause}
       GROUP BY vc.name, vc.icon
       ORDER BY checkin_count DESC`,
      [user_id, ...rangeParams]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting category breakdown:', err);
    res.status(500).json({ error: 'Failed to get category breakdown' });
  }
});

// GET /stats/heatmap?year= - check-ins per day for a year
statsRouter.get('/heatmap', async (req: Request, res: Response) => {
  try {
    const { year } = req.query;
    const user_id = currentUserId();

    if (!year) {
      return res.status(400).json({ error: 'year is required' });
    }

    const yearNum = parseYear(year);
    if (yearNum === null) return res.status(400).json({ error: 'year must be a valid year' });

    const result = await query(
      `SELECT TO_CHAR(DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')), 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         AND (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date >= $2::date
         AND (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date < ($2::date + INTERVAL '1 year')
       GROUP BY DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))
       ORDER BY date ASC`,
      [user_id, `${yearNum}-01-01`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting heatmap:', err);
    res.status(500).json({ error: 'Failed to get heatmap' });
  }
});

// GET /stats/monthly?year=&month= - check-ins per day for a month
statsRouter.get('/monthly', async (req: Request, res: Response) => {
  try {
    const { year, month } = req.query;
    const user_id = currentUserId();

    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const yearNum = parseYear(year);
    const monthNum = parseMonth(month);
    if (yearNum === null) return res.status(400).json({ error: 'year must be a valid year' });
    if (monthNum === null) {
      return res.status(400).json({ error: 'month must be between 1 and 12' });
    }

    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;

    const result = await query(
      // DATE(...)::text keeps pg from turning the date into a JS Date (which
      // serializes as a server-timezone-shifted ISO timestamp).
      `SELECT DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::text AS date,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         AND (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date >= $2::date
         AND (checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::date < ($2::date + INTERVAL '1 month')
       GROUP BY DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))
       ORDER BY date ASC`,
      [user_id, startDate]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting monthly stats:', err);
    res.status(500).json({ error: 'Failed to get monthly stats' });
  }
});

// GET /stats/countries - check-ins grouped by country
statsRouter.get('/countries', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at', 'c.checkin_timezone');

    const result = await query(
      `SELECT COALESCE(v.country, 'Unknown') AS country,
              COUNT(c.id)::int AS checkin_count,
              COUNT(DISTINCT c.venue_id)::int AS unique_venues
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
         ${whereClause}
       GROUP BY v.country
       ORDER BY checkin_count DESC`,
      [user_id, ...rangeParams]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting countries:', err);
    res.status(500).json({ error: 'Failed to get countries' });
  }
});

// GET /stats/map-data?from=&to= - venue locations with check-in counts for a date range
statsRouter.get('/map-data', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
    const whereRange = hasRange
      ? "AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date BETWEEN $2::date AND $3::date"
      : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `SELECT v.id AS venue_id, v.name AS venue_name,
              v.latitude, v.longitude,
              COUNT(c.id)::int AS checkin_count,
              (ARRAY_AGG(c.checked_in_at ORDER BY c.checked_in_at DESC))[1] AS last_checkin_at,
              (ARRAY_AGG(c.checkin_timezone ORDER BY c.checked_in_at DESC))[1] AS last_checkin_timezone,
              -- Only the latest local day is consumed (the "last visit" link), so
              -- don't ship every visit day; text avoids JS Date serialization.
              ARRAY[MAX(DATE(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC')))::text] AS dates
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
         ${whereRange}
       GROUP BY v.id
       ORDER BY checkin_count DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting map data:', err);
    res.status(500).json({ error: 'Failed to get map data' });
  }
});

// GET /stats/day-of-week - check-ins by day of week
statsRouter.get('/day-of-week', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'checked_in_at', 'checkin_timezone');

    const result = await query(
      `SELECT EXTRACT(DOW FROM checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))::int AS dow,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         ${whereClause}
       GROUP BY dow
       ORDER BY dow`,
      [user_id, ...rangeParams]
    );

    // Fill in missing days with 0
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const countMap = new Map(result.rows.map((r: any) => [r.dow, r.count]));
    const data = dayNames.map((name, i) => ({ day: name, count: countMap.get(i) || 0 }));

    res.json(data);
  } catch (err) {
    console.error('Error getting day-of-week:', err);
    res.status(500).json({ error: 'Failed to get day-of-week' });
  }
});

// GET /stats/time-of-day - check-ins by time bucket
statsRouter.get('/time-of-day', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'checked_in_at', 'checkin_timezone');

    const result = await query(
      `SELECT
         CASE
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')) BETWEEN 5 AND 11 THEN 'Morning'
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')) BETWEEN 12 AND 16 THEN 'Afternoon'
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')) BETWEEN 17 AND 20 THEN 'Evening'
           ELSE 'Night'
         END AS period,
         COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         ${whereClause}
       GROUP BY period`,
      [user_id, ...rangeParams]
    );

    const order = ['Morning', 'Afternoon', 'Evening', 'Night'];
    const countMap = new Map(result.rows.map((r: any) => [r.period, r.count]));
    const data = order.map((period) => ({ period, count: countMap.get(period) || 0 }));

    res.json(data);
  } catch (err) {
    console.error('Error getting time-of-day:', err);
    res.status(500).json({ error: 'Failed to get time-of-day' });
  }
});

// GET /stats/busiest-days - top 10 calendar days by check-in count
statsRouter.get('/busiest-days', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'checked_in_at', 'checkin_timezone');

    const result = await query(
      `SELECT TO_CHAR(DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')), 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         ${whereClause}
       GROUP BY DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC'))
       ORDER BY count DESC, date DESC
       LIMIT 10`,
      [user_id, ...rangeParams]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting busiest days:', err);
    res.status(500).json({ error: 'Failed to get busiest days' });
  }
});

// GET /stats/top-cities - cities ranked by check-in count
statsRouter.get('/top-cities', async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const user_id = currentUserId();

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at', 'c.checkin_timezone');

    const result = await query(
      `SELECT COALESCE(v.city, 'Unknown') AS city,
              COALESCE(v.country, '') AS country,
              COUNT(c.id)::int AS checkin_count,
              COUNT(DISTINCT c.venue_id)::int AS unique_venues
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
         ${whereClause}
       GROUP BY v.city, v.country
       ORDER BY checkin_count DESC
       LIMIT 10`,
      [user_id, ...rangeParams]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting top cities:', err);
    res.status(500).json({ error: 'Failed to get top cities' });
  }
});

// GET /stats/additional-stats - extra fun stats
statsRouter.get('/additional-stats', async (req: Request, res: Response) => {
  try {
    const user_id = currentUserId();

    // Most common category
    const topCategory = await query(
      `SELECT COALESCE(vc.name, 'Uncategorized') AS name, COUNT(*)::int AS count
       FROM checkins c JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
       GROUP BY vc.name ORDER BY count DESC LIMIT 1`,
      [user_id]
    );

    // Longest gap between check-ins (in local calendar days), computed in SQL
    // over distinct days; ties resolve to the earliest gap.
    const gapResult = await query(
      `SELECT prev::text AS gap_start, d::text AS gap_end, (d - prev)::int AS days
       FROM (
         SELECT d, LAG(d) OVER (ORDER BY d) AS prev
         FROM (
           SELECT DISTINCT DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')) AS d
           FROM checkins WHERE user_id = $1
         ) days
       ) gaps
       WHERE prev IS NOT NULL
       ORDER BY days DESC, d ASC
       LIMIT 1`,
      [user_id]
    );
    const longestGap = gapResult.rows[0]?.days ?? 0;
    const gapStart = gapResult.rows[0]?.gap_start ?? '';
    const gapEnd = gapResult.rows[0]?.gap_end ?? '';

    // Venues visited only once
    const oneTimers = await query(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT venue_id FROM checkins WHERE user_id = $1
         GROUP BY venue_id HAVING COUNT(*) = 1
       ) sub`,
      [user_id]
    );

    // First ever check-in
    const firstCheckin = await query(
      `SELECT c.checked_in_at, v.name AS venue_name
       FROM checkins c JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
       ORDER BY c.checked_in_at ASC LIMIT 1`,
      [user_id]
    );

    res.json({
      top_category: topCategory.rows[0] || null,
      longest_gap: { days: longestGap, start: gapStart, end: gapEnd },
      one_time_venues: oneTimers.rows[0]?.count || 0,
      first_checkin: firstCheckin.rows[0] || null,
    });
  } catch (err) {
    console.error('Error getting additional stats:', err);
    res.status(500).json({ error: 'Failed to get additional stats' });
  }
});
