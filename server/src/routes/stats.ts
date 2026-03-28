import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

// GET /summary?user_id= - overall stats summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await query(
      `SELECT
         COUNT(c.id)::int AS total_checkins,
         COUNT(DISTINCT c.venue_id)::int AS unique_venues,
         (SELECT COUNT(*)::int FROM checkin_photos cp
          JOIN checkins c2 ON cp.checkin_id = c2.id
          WHERE c2.user_id = $1) AS total_photos,
         COUNT(DISTINCT DATE(c.checked_in_at AT TIME ZONE 'UTC'))::int AS days_with_checkins,
         u.created_at AS member_since
       FROM checkins c
       JOIN users u ON u.id = $1
       WHERE c.user_id = $1
       GROUP BY u.created_at`,
      [user_id]
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
        total_photos: 0,
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

    // Calculate longest streak
    let longestStreak = 1;
    let tempStreak = 1;
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
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    res.json({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_checkin_date: lastCheckinDate,
    });
  } catch (err) {
    console.error('Error getting streaks:', err);
    res.status(500).json({ error: 'Failed to get streaks' });
  }
});

// GET /top-venues?user_id=&limit=10 - most visited venues
router.get('/top-venues', async (req: Request, res: Response) => {
  try {
    const { user_id, limit = '10' } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await query(
      `SELECT v.id AS venue_id, v.name AS venue_name, v.address, v.city, v.state,
              vc.name AS category_name, vc.icon AS category_icon,
              COUNT(c.id)::int AS checkin_count,
              MAX(c.checked_in_at) AS last_checkin
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
       GROUP BY v.id, vc.name, vc.icon
       ORDER BY checkin_count DESC
       LIMIT $2`,
      [user_id, parseInt(limit as string, 10)]
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
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await query(
      `SELECT COALESCE(vc.name, 'Uncategorized') AS category_name,
              vc.icon AS category_icon,
              COUNT(c.id)::int AS checkin_count
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE c.user_id = $1
       GROUP BY vc.name, vc.icon
       ORDER BY checkin_count DESC`,
      [user_id]
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
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await query(
      `SELECT COALESCE(v.country, 'Unknown') AS country,
              COUNT(c.id)::int AS checkin_count,
              COUNT(DISTINCT c.venue_id)::int AS unique_venues
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
       GROUP BY v.country
       ORDER BY checkin_count DESC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting countries:', err);
    res.status(500).json({ error: 'Failed to get countries' });
  }
});

// GET /map-data?user_id= - all venue locations with checkin counts for heatmap map
router.get('/map-data', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await query(
      `SELECT v.id AS venue_id, v.name AS venue_name,
              v.latitude, v.longitude,
              COUNT(c.id)::int AS checkin_count,
              ARRAY_AGG(DISTINCT DATE(c.checked_in_at AT TIME ZONE 'UTC') ORDER BY DATE(c.checked_in_at AT TIME ZONE 'UTC') DESC) AS dates
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       WHERE c.user_id = $1
       GROUP BY v.id
       ORDER BY checkin_count DESC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting map data:', err);
    res.status(500).json({ error: 'Failed to get map data' });
  }
});

export const statsRouter = router;
