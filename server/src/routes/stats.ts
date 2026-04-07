import { Router, Request, Response } from 'express';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';

const router = Router();

function buildDateRangeClause(from: unknown, to: unknown, column: string) {
  const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
  return {
    hasRange,
    whereClause: hasRange
      ? ` AND ${column} >= $2::date AND ${column} < ($3::date + INTERVAL '1 day')`
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at');

    const result = await query(
      `SELECT
         COUNT(c.id)::int AS total_checkins,
         COUNT(DISTINCT c.venue_id)::int AS unique_venues,
         COUNT(DISTINCT DATE(c.checked_in_at AT TIME ZONE 'UTC'))::int AS days_with_checkins,
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

// GET /streaks?user_id= - check-in streaks
router.get('/streaks', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    // Get distinct check-in dates ordered
    const datesResult = await query(
      `SELECT DISTINCT DATE(checked_in_at AT TIME ZONE 'UTC') AS checkin_date
       FROM checkins
       WHERE user_id = $1
       ORDER BY checkin_date DESC`,
      [user_id]
    );

    if (datesResult.rows.length === 0) {
      return res.json({
        current_streak: 0,
        longest_streak: 0,
        last_checkin_date: null,
      });
    }

    const dates = datesResult.rows.map(
      (r: { checkin_date: string }) => new Date(r.checkin_date)
    );
    const lastCheckinDate = dates[0];

    // Calculate current streak (from today or last check-in date backwards)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    const firstDate = new Date(dates[0]);
    firstDate.setHours(0, 0, 0, 0);

    // Current streak only counts if last check-in was today or yesterday
    const diffFromToday = Math.floor(
      (today.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffFromToday <= 1) {
      currentStreak = 1;
      for (let i = 1; i < dates.length; i++) {
        const prevDate = new Date(dates[i - 1]);
        const currDate = new Date(dates[i]);
        prevDate.setHours(0, 0, 0, 0);
        currDate.setHours(0, 0, 0, 0);
        const diff = Math.floor(
          (prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diff === 1) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    // Calculate current streak date range
    let currentStreakStart: Date | null = null;
    let currentStreakEnd: Date | null = null;
    if (currentStreak > 0) {
      currentStreakEnd = new Date(dates[0]);
      currentStreakEnd.setHours(0, 0, 0, 0);
      currentStreakStart = new Date(dates[currentStreak - 1]);
      currentStreakStart.setHours(0, 0, 0, 0);
    }

    // Calculate longest streak
    let longestStreak = 1;
    let tempStreak = 1;
    let longestEnd = 0; // index of the start (most recent date) of longest streak
    for (let i = 1; i < dates.length; i++) {
      const prevDate = new Date(dates[i - 1]);
      const currDate = new Date(dates[i]);
      prevDate.setHours(0, 0, 0, 0);
      currDate.setHours(0, 0, 0, 0);
      const diff = Math.floor(
        (prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff === 1) {
        tempStreak++;
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
          longestEnd = i - tempStreak + 1; // dates are descending, so "end" is the more recent
        }
      } else {
        tempStreak = 1;
      }
    }

    // Longest streak date range (dates are descending)
    const longestStreakEnd = new Date(dates[longestEnd]);
    longestStreakEnd.setHours(0, 0, 0, 0);
    const longestStreakStart = new Date(dates[longestEnd + longestStreak - 1]);
    longestStreakStart.setHours(0, 0, 0, 0);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    res.json({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_checkin_date: lastCheckinDate,
      current_streak_start: currentStreakStart ? fmt(currentStreakStart) : null,
      current_streak_end: currentStreakEnd ? fmt(currentStreakEnd) : null,
      longest_streak_start: fmt(longestStreakStart),
      longest_streak_end: fmt(longestStreakEnd),
    });
  } catch (err) {
    console.error('Error getting streaks:', err);
    res.status(500).json({ error: 'Failed to get streaks' });
  }
});

// GET /top-venues?user_id=&limit=10 - most visited venues
router.get('/top-venues', async (req: Request, res: Response) => {
  try {
    const { user_id, limit = '10', from, to } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const { hasRange, whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at');
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at');

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
      `SELECT TO_CHAR(DATE(checked_in_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         AND checked_in_at >= $2::date
         AND checked_in_at < ($2::date + INTERVAL '1 year')
       GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
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
      `SELECT DATE(checked_in_at AT TIME ZONE 'UTC') AS date,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         AND checked_in_at >= $2::date
         AND checked_in_at < ($2::date + INTERVAL '1 month')
       GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at');

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
      ? "AND c.checked_in_at >= $2::date AND c.checked_in_at < ($3::date + INTERVAL '1 day')"
      : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `SELECT v.id AS venue_id, v.name AS venue_name,
              v.latitude, v.longitude,
              COUNT(c.id)::int AS checkin_count,
              ARRAY_AGG(DISTINCT DATE(c.checked_in_at AT TIME ZONE 'UTC') ORDER BY DATE(c.checked_in_at AT TIME ZONE 'UTC') DESC) AS dates
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'checked_in_at');

    const result = await query(
      `SELECT EXTRACT(DOW FROM checked_in_at AT TIME ZONE 'UTC')::int AS dow,
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'checked_in_at');

    const result = await query(
      `SELECT
         CASE
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC') BETWEEN 5 AND 11 THEN 'Morning'
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC') BETWEEN 12 AND 16 THEN 'Afternoon'
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC') BETWEEN 17 AND 20 THEN 'Evening'
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'checked_in_at');

    const result = await query(
      `SELECT TO_CHAR(DATE(checked_in_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
              COUNT(*)::int AS count
       FROM checkins
       WHERE user_id = $1
         ${whereClause}
       GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
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

    const { whereClause, params: rangeParams } = buildDateRangeClause(from, to, 'c.checked_in_at');

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

// GET /insights?user_id= - derived insights from check-in patterns
router.get('/insights', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const insights: { title: string; description: string; icon: string }[] = [];

    // Favorite day of week
    const dowResult = await query(
      `SELECT EXTRACT(DOW FROM checked_in_at AT TIME ZONE 'UTC')::int AS dow,
              COUNT(*)::int AS count
       FROM checkins WHERE user_id = $1
       GROUP BY dow ORDER BY count DESC LIMIT 1`,
      [user_id]
    );
    if (dowResult.rows.length > 0) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const favDay = dayNames[dowResult.rows[0].dow];
      insights.push({
        title: `${favDay} Explorer`,
        description: `You check in most on ${favDay}s — ${dowResult.rows[0].count} check-ins and counting!`,
        icon: 'calendar',
      });
    }

    // Favorite time of day
    const todResult = await query(
      `SELECT
         CASE
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC') BETWEEN 5 AND 11 THEN 'Morning'
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC') BETWEEN 12 AND 16 THEN 'Afternoon'
           WHEN EXTRACT(HOUR FROM checked_in_at AT TIME ZONE 'UTC') BETWEEN 17 AND 20 THEN 'Evening'
           ELSE 'Night'
         END AS period,
         COUNT(*)::int AS count
       FROM checkins WHERE user_id = $1
       GROUP BY period ORDER BY count DESC LIMIT 1`,
      [user_id]
    );
    if (todResult.rows.length > 0) {
      const period = todResult.rows[0].period;
      const labels: Record<string, string> = {
        Morning: 'Early Bird — you love mornings!',
        Afternoon: 'Afternoon Adventurer — peak activity after lunch.',
        Evening: 'Evening Explorer — your adventures pick up at sunset.',
        Night: 'Night Owl — the city comes alive for you after dark.',
      };
      insights.push({
        title: labels[period] || `${period} person`,
        description: `${todResult.rows[0].count} of your check-ins happen in the ${period.toLowerCase()}.`,
        icon: 'clock',
      });
    }

    // Loyalty score — how often they return to the same venue
    const loyaltyResult = await query(
      `SELECT v.name AS venue_name, COUNT(c.id)::int AS visits
       FROM checkins c JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
       GROUP BY v.id, v.name ORDER BY visits DESC LIMIT 1`,
      [user_id]
    );
    if (loyaltyResult.rows.length > 0 && loyaltyResult.rows[0].visits >= 3) {
      const v = loyaltyResult.rows[0];
      insights.push({
        title: 'Loyal Regular',
        description: `You've been to ${v.venue_name} ${v.visits} times — it's clearly a favorite!`,
        icon: 'heart',
      });
    }

    // Explorer vs creature-of-habit ratio
    const explorerResult = await query(
      `SELECT COUNT(DISTINCT venue_id)::int AS unique_venues, COUNT(*)::int AS total
       FROM checkins WHERE user_id = $1`,
      [user_id]
    );
    if (explorerResult.rows.length > 0 && explorerResult.rows[0].total > 0) {
      const { unique_venues, total } = explorerResult.rows[0];
      const ratio = unique_venues / total;
      if (ratio > 0.7) {
        insights.push({
          title: 'True Explorer',
          description: `${Math.round(ratio * 100)}% of your check-ins are at unique venues — you rarely visit the same place twice!`,
          icon: 'compass',
        });
      } else if (ratio < 0.3) {
        insights.push({
          title: 'Creature of Habit',
          description: `You love your go-to spots! Only ${Math.round(ratio * 100)}% of check-ins are at new places.`,
          icon: 'home',
        });
      }
    }

    // Weekend vs weekday
    const weekendResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE EXTRACT(DOW FROM checked_in_at AT TIME ZONE 'UTC') IN (0, 6))::int AS weekend,
         COUNT(*) FILTER (WHERE EXTRACT(DOW FROM checked_in_at AT TIME ZONE 'UTC') NOT IN (0, 6))::int AS weekday
       FROM checkins WHERE user_id = $1`,
      [user_id]
    );
    if (weekendResult.rows.length > 0) {
      const { weekend, weekday } = weekendResult.rows[0];
      if (weekend > weekday) {
        insights.push({
          title: 'Weekend Warrior',
          description: `${weekend} weekend check-ins vs ${weekday} weekday — you save the best for Saturday & Sunday.`,
          icon: 'sun',
        });
      } else if (weekday > weekend * 2) {
        insights.push({
          title: 'Weekday Wanderer',
          description: `${weekday} weekday check-ins vs ${weekend} weekend — you keep busy during the work week!`,
          icon: 'briefcase',
        });
      }
    }

    // Average check-ins per active day
    const avgResult = await query(
      `SELECT COUNT(*)::float / GREATEST(COUNT(DISTINCT DATE(checked_in_at AT TIME ZONE 'UTC')), 1) AS avg_per_day
       FROM checkins WHERE user_id = $1`,
      [user_id]
    );
    if (avgResult.rows.length > 0) {
      const avg = parseFloat(avgResult.rows[0].avg_per_day);
      if (avg >= 3) {
        insights.push({
          title: 'Power Checker',
          description: `You average ${avg.toFixed(1)} check-ins per active day — always on the move!`,
          icon: 'zap',
        });
      }
    }

    // Country count
    const countryCountResult = await query(
      `SELECT COUNT(DISTINCT v.country)::int AS countries
       FROM checkins c JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1 AND v.country IS NOT NULL AND TRIM(v.country) != ''`,
      [user_id]
    );
    if (countryCountResult.rows.length > 0 && countryCountResult.rows[0].countries >= 2) {
      const cnt = countryCountResult.rows[0].countries;
      insights.push({
        title: 'Globe Trotter',
        description: `You've checked in across ${cnt} countries — the world is your playground!`,
        icon: 'globe',
      });
    }

    res.json(insights);
  } catch (err) {
    console.error('Error getting insights:', err);
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

// GET /reflections?user_id= - check-ins from this date in past years
router.get('/reflections', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    // Find location and mood check-ins that happened on this month/day in prior years.
    const result = await query(
      `(
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
             EXTRACT(YEAR FROM NOW() AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::int
             - EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::int
           )::int AS years_ago,
           NULL::smallint AS mood,
           NULL::text AS mood_timezone,
           '[]'::json AS activities
         FROM checkins c
         JOIN venues v ON c.venue_id = v.id
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         WHERE c.user_id = $1
           AND TO_CHAR(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR(NOW() AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'), 'MM-DD')
           AND EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))
               < EXTRACT(YEAR FROM NOW() AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))
       )
       UNION ALL
       (
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
             EXTRACT(YEAR FROM NOW() AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::int
             - EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))::int
           )::int AS years_ago,
           mc.mood,
           mc.mood_timezone,
           COALESCE(
             (
               SELECT json_agg(json_build_object(
                 'id', ma.id,
                 'name', ma.name,
                 'group_name', mag.name,
                 'icon', ma.icon
               ) ORDER BY mag.display_order, ma.display_order)
               FROM mood_checkin_activities mca
               JOIN mood_activities ma ON mca.activity_id = ma.id
               JOIN mood_activity_groups mag ON ma.group_id = mag.id
               WHERE mca.mood_checkin_id = mc.id
             ),
             '[]'::json
           ) AS activities
         FROM mood_checkins mc
         WHERE mc.user_id = $1
           AND TO_CHAR(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'), 'MM-DD') = TO_CHAR(NOW() AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'), 'MM-DD')
           AND EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))
               < EXTRACT(YEAR FROM NOW() AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))
       )
       ORDER BY checked_in_at DESC`,
      [user_id]
    );

    // Group by year
    const byYear: Record<number, any[]> = {};
    for (const row of result.rows) {
      const tzResults = row.latitude != null && row.longitude != null
        ? findTimezone(Number(row.latitude), Number(row.longitude))
        : [];
      const venueTimezone = row.venue_timezone || tzResults[0] || null;

      const year = Number(row.reflection_year);
      if (!byYear[year]) byYear[year] = [];
      byYear[year].push({
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
        mood: row.mood,
        mood_timezone: row.mood_timezone,
        years_ago: Number(row.years_ago),
        activities: row.activities || [],
      });
    }

    const reflections = Object.entries(byYear)
      .map(([year, items]) => ({
        year: parseInt(year),
        years_ago: items[0]?.years_ago ?? 0,
        items,
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
      `SELECT DATE(checked_in_at AT TIME ZONE 'UTC') AS d
       FROM checkins WHERE user_id = $1
       ORDER BY checked_in_at`,
      [user_id]
    );
    let longestGap = 0;
    let gapStart = '';
    let gapEnd = '';
    const dates = gapResult.rows.map((r: any) => r.d);
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.floor(
        (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diff > longestGap) {
        longestGap = diff;
        gapStart = new Date(dates[i - 1]).toISOString().slice(0, 10);
        gapEnd = new Date(dates[i]).toISOString().slice(0, 10);
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

// GET /mood-daily?user_id=&from=&to= - avg/min/max mood per day for line/span chart
router.get('/mood-daily', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
    const whereRange = hasRange ? "AND checked_in_at >= $2::date AND checked_in_at < ($3::date + INTERVAL '1 day')" : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `SELECT
         TO_CHAR(DATE(checked_in_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
         ROUND(AVG(mood)::numeric, 2)::float AS avg_mood,
         MIN(mood)::int AS min_mood,
         MAX(mood)::int AS max_mood,
         COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         ${whereRange}
       GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
       ORDER BY date ASC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-daily:', err);
    res.status(500).json({ error: 'Failed to get mood daily stats' });
  }
});

// GET /mood-monthly?user_id=&year= - count of each mood per month
router.get('/mood-monthly', async (req: Request, res: Response) => {
  try {
    const { user_id, year } = req.query;
    if (!user_id || !year) return res.status(400).json({ error: 'user_id and year are required' });

    const yearNum = parseInt(year as string, 10);

    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', checked_in_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
         mood,
         COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         AND EXTRACT(YEAR FROM checked_in_at AT TIME ZONE 'UTC') = $2
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

// GET /mood-by-day-of-week?user_id=&from=&to= - avg mood per day of week
router.get('/mood-by-day-of-week', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
    const whereRange = hasRange ? "AND (checked_in_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date" : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `SELECT
         EXTRACT(DOW FROM checked_in_at AT TIME ZONE 'UTC')::int AS dow,
         ROUND(AVG(mood)::numeric, 2)::float AS avg_mood,
         COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         ${whereRange}
       GROUP BY dow
       ORDER BY dow`,
      params
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

// GET /mood-activity-correlations?user_id=&from=&to= - avg mood and impact per activity (min 2 checkins)
router.get('/mood-activity-correlations', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
    const whereRange = hasRange ? "AND (checked_in_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date" : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `WITH filtered_checkins AS (
         SELECT id, mood
         FROM mood_checkins
         WHERE user_id = $1
           ${whereRange}
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
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-activity-correlations:', err);
    res.status(500).json({ error: 'Failed to get mood activity correlations' });
  }
});

// GET /mood-activity-combinations?user_id=&from=&to= - repeated multi-activity combinations (min 2 checkins)
router.get('/mood-activity-combinations', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
    const whereRange = hasRange ? "AND (checked_in_at AT TIME ZONE 'UTC')::date BETWEEN $2::date AND $3::date" : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `WITH filtered_checkins AS (
         SELECT id, mood
         FROM mood_checkins
         WHERE user_id = $1
           ${whereRange}
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
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-activity-combinations:', err);
    res.status(500).json({ error: 'Failed to get mood activity combinations' });
  }
});

// GET /mood-count-range?user_id=&from=&to= - count of each mood level in date range
router.get('/mood-count-range', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const hasRange = typeof from === 'string' && typeof to === 'string' && from && to;
    const whereRange = hasRange ? "AND checked_in_at >= $2::date AND checked_in_at < ($3::date + INTERVAL '1 day')" : '';
    const params = hasRange ? [user_id, from, to] : [user_id];

    const result = await query(
      `SELECT mood, COUNT(*)::int AS count
       FROM mood_checkins
       WHERE user_id = $1
         ${whereRange}
       GROUP BY mood
       ORDER BY mood ASC`,
      params
    );

    const countMap = new Map(result.rows.map((r: any) => [r.mood, r.count]));
    const data = [1, 2, 3, 4, 5].map((mood) => ({ mood, count: countMap.get(mood) || 0 }));

    res.json(data);
  } catch (err) {
    console.error('Error getting mood-count-range:', err);
    res.status(500).json({ error: 'Failed to get mood count range' });
  }
});

// GET /mood-heatmap?user_id=&year= - avg mood per day for year-in-pixels
router.get('/mood-heatmap', async (req: Request, res: Response) => {
  try {
    const { user_id, year } = req.query;
    if (!user_id || !year) return res.status(400).json({ error: 'user_id and year are required' });

    const yearNum = parseInt(year as string, 10);

    const result = await query(
      `SELECT
         TO_CHAR(DATE(checked_in_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
         ROUND(AVG(mood)::numeric, 1)::float AS avg_mood
       FROM mood_checkins
       WHERE user_id = $1
         AND checked_in_at >= $2::date
         AND checked_in_at < ($2::date + INTERVAL '1 year')
       GROUP BY DATE(checked_in_at AT TIME ZONE 'UTC')
       ORDER BY date ASC`,
      [user_id, `${yearNum}-01-01`]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting mood-heatmap:', err);
    res.status(500).json({ error: 'Failed to get mood heatmap' });
  }
});

export const statsRouter = router;
