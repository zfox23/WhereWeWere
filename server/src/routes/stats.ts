import { Router, Request, Response } from 'express';
import { earliestDateSources, pluginReflectionBranches } from '../plugins/registry';
import { find as findTimezone } from 'geo-tz';
import { query } from '../db';
import { currentUserId } from '../auth/context';

const router = Router();

// Location stats endpoints (summary, top-venues, category-breakdown, heatmap,
// monthly, countries, map-data, day-of-week, time-of-day, busiest-days,
// top-cities, additional-stats) now live in the location plugin at
// /api/v1/location-checkins/stats/*.

// GET /reflections?target_date= - the signed-in user's check-ins from this
// date in past years
router.get('/reflections', async (req: Request, res: Response) => {
  try {
    const { target_date } = req.query;
    const userId = currentUserId();

    const targetDate = typeof target_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(target_date)
      ? target_date
      : new Date().toISOString().slice(0, 10);

    // Every check-in type contributes a reflection branch via its
    // reflectionBranch hook (location, mood, sleep, tracks, ...).
    // Plugin-specific payloads live in `data`.
    const branches = pluginReflectionBranches();
    if (branches.length === 0) {
      return res.json([]);
    }
    const result = await query(
      `${branches.join('\n        UNION ALL\n        ')}
        ORDER BY checked_in_at DESC`,
      [userId, targetDate]
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

// GET /earliest-dates - the signed-in user's earliest entry date for each
// data type
router.get('/earliest-dates', async (_req: Request, res: Response) => {
  try {
    const userId = currentUserId();

    // Every data type contributes its earliestDate hook (keyed by plugin id).
    const earliestResults = await Promise.all(
      earliestDateSources().map(({ key, sql }) =>
        query(sql, [userId])
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
