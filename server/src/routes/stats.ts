import { Router, Request, Response } from 'express';
import { earliestDateSources, pluginReflectionBranches } from '../plugins/registry';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';

const router = Router();

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

// GET /summary?user_id= - overall stats summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

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

// GET /top-venues?user_id=&limit=10 - most visited venues
router.get('/top-venues', async (req: Request, res: Response) => {
  try {
    const { user_id, limit = '10', from, to } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

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
      [user_id, ...rangeParams, parseInt(limit as string, 10)]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting top venues:', err);
    res.status(500).json({ error: 'Failed to get top venues' });
  }
});

// GET /category-breakdown?user_id= - check-ins by category
router.get('/category-breakdown', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

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

// GET /heatmap?user_id=&year= - check-ins per day for a year
router.get('/heatmap', async (req: Request, res: Response) => {
  try {
    const { user_id, year } = req.query;

    if (!user_id || !year) {
      return res.status(400).json({ error: 'user_id and year are required' });
    }

    const yearNum = parseInt(year as string, 10);

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

// GET /monthly?user_id=&year=&month= - check-ins per day for a month
router.get('/monthly', async (req: Request, res: Response) => {
  try {
    const { user_id, year, month } = req.query;

    if (!user_id || !year || !month) {
      return res.status(400).json({ error: 'user_id, year, and month are required' });
    }

    const yearNum = parseInt(year as string, 10);
    const monthNum = parseInt(month as string, 10);

    if (monthNum < 1 || monthNum > 12) {
      return res.status(400).json({ error: 'month must be between 1 and 12' });
    }

    const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;

    const result = await query(
      `SELECT DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')) AS date,
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

// GET /countries?user_id= - check-ins grouped by country
router.get('/countries', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

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

// GET /map-data?user_id=&from=&to= - venue locations with check-in counts for a date range
router.get('/map-data', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

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
              ARRAY_AGG(DISTINCT DATE(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC')) ORDER BY DATE(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC')) DESC) AS dates
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

// GET /day-of-week?user_id= - check-ins by day of week
router.get('/day-of-week', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

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
    console.error('Error getting day-of-week stats:', err);
    res.status(500).json({ error: 'Failed to get day-of-week stats' });
  }
});

// GET /time-of-day?user_id= - check-ins by time bucket
router.get('/time-of-day', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

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
    console.error('Error getting time-of-day stats:', err);
    res.status(500).json({ error: 'Failed to get time-of-day stats' });
  }
});

// GET /busiest-days?user_id= - top 10 calendar days by check-in count
router.get('/busiest-days', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

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

// GET /top-cities?user_id= - cities ranked by check-in count
router.get('/top-cities', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

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

// GET /reflections?user_id= - check-ins from this date in past years
router.get('/reflections', async (req: Request, res: Response) => {
  try {
    const { user_id, target_date } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const targetDate = typeof target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(target_date)
      ? target_date
      : new Date().toISOString().slice(0, 10);

    // Find location entries and each plugin's entries (mood, sleep, ...) that
    // happened on this month/day in prior years. Plugin rows arrive through
    // their reflectionBranch hook; plugin-specific payloads live in `data`.
    const locationBranch = `(
          SELECT
            'location' AS type,
            c.id,
            c.checked_in_at,
            c.notes AS note,
            v.id AS venue_id,
            v.name AS venue_name,
            v.city,
            v.country,
            v.latitude,
            v.longitude,
            vc.name AS venue_category,
            c.checkin_timezone AS venue_timezone,
            EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::int AS reflection_year,
            (
              EXTRACT(YEAR FROM $2::date)::int
              - EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::int
            )::int AS years_ago,
            NULL::jsonb AS data
          FROM checkins c
          JOIN venues v ON c.venue_id = v.id
          LEFT JOIN venue_categories vc ON v.category_id = vc.id
          WHERE c.user_id = $1
              AND TO_CHAR(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
            AND EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))
                < EXTRACT(YEAR FROM $2::date)
        )`;
    const branches = [locationBranch, ...pluginReflectionBranches()];
    const result = await query(
      `${branches.join('\n        UNION ALL\n        ')}
        ORDER BY checked_in_at DESC`,
      [user_id, targetDate]
    );

    // Group by year. Every row is a generic item; plugin-typed payloads
    // (e.g. sleep's started/ended times) live in `data`.
    const byYear: Record<number, { items: any[] }> = {};
    for (const row of result.rows) {
      const tzResults = row.latitude != null && row.longitude != null
        ? findTimezone(Number(row.latitude), Number(row.longitude))
        : [];
      const venueTimezone = row.venue_timezone || tzResults[0] || null;

      const year = Number(row.reflection_year);
      if (!byYear[year]) byYear[year] = { items: [] };
      byYear[year].items.push({
        type: row.type,
        id: row.id,
        note: row.note,
        checked_in_at: row.checked_in_at,
        venue_id: row.venue_id,
        venue_name: row.venue_name,
        city: row.city,
        country: row.country,
        venue_category: row.venue_category,
        venue_timezone: venueTimezone,
        years_ago: Number(row.years_ago),
        data: row.data ?? null,
      });
    }

    const reflections = Object.entries(byYear)
      .map(([year, entry]) => ({
        year: parseInt(year),
        years_ago: entry.items[0]?.years_ago ?? 0,
        items: entry.items,
      }))
      .sort((a, b) => b.year - a.year);

    res.json(reflections);
  } catch (err) {
    console.error('Error getting reflections:', err);
    res.status(500).json({ error: 'Failed to get reflections' });
  }
});

// GET /additional-stats?user_id= - extra fun stats
router.get('/additional-stats', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    // Most common category
    const topCategory = await query(
      `SELECT COALESCE(vc.name, 'Uncategorized') AS name, COUNT(*)::int AS count
       FROM checkins c JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
       GROUP BY vc.name ORDER BY count DESC LIMIT 1`,
      [user_id]
    );

    // Longest gap between check-ins
    const gapResult = await query(
      `SELECT DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')) AS d
       FROM checkins WHERE user_id = $1
       ORDER BY checked_in_at`,
      [user_id]
    );
    let longestGap = 0;
    let gapStart = '';
    let gapEnd = '';
    const dates = gapResult.rows.map((r: any) => String(r.d).slice(0, 10));
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.floor(
        (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff > longestGap) {
        longestGap = diff;
        gapStart = dates[i - 1];
        gapEnd = dates[i];
      }
    }

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

// GET /earliest-dates?user_id= - earliest entry date for each data type
router.get('/earliest-dates', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Every data type — built-in checkins/tracks plus each plugin's
    // earliestDate hook — flows through the same source list.
    const earliestResults = await Promise.all(
      earliestDateSources().map(({ key, sql }) =>
        query(sql, [user_id])
          .then((r) => ({ key, date: r.rows[0]?.date ?? null }))
          .catch(() => ({ key, date: null as string | null })),
      )
    );

    const response: Record<string, string | null> = {};
    for (const { key, date } of earliestResults) {
      response[key] = date;
    }

    res.json(response);
  } catch (err) {
    console.error('Error getting earliest dates:', err);
    res.status(500).json({ error: 'Failed to get earliest dates' });
  }
});

export const statsRouter = router;
