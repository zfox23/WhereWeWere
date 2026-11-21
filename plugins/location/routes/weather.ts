/** /weather — daily weather summaries for the timeline (Open-Meteo). */

import { Router, Request, Response } from 'express';
import { isWeatherEnabled } from '../services/weatherEnrich';
import { query } from '../../../server/src/db';
import { currentUserId } from '../../../server/src/auth/context';

export const weatherRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /weather?dates=YYYY-MM-DD,... - weather summaries for the given days
// (hourly data left out); `enabled` tells the timeline whether to show any.
weatherRouter.get('/', async (req: Request, res: Response) => {
  try {
    const enabled = await isWeatherEnabled(currentUserId());
    if (!enabled) return res.json({ enabled, days: {} });
    const dates = String(req.query.dates ?? '')
      .split(',')
      .filter((d) => DATE_RE.test(d))
      .slice(0, 200);
    const days: Record<string, unknown> = {};
    if (dates.length > 0) {
      const result = await query(
        `SELECT TO_CHAR(local_date, 'YYYY-MM-DD') AS date, data - 'hourly' AS data
           FROM daily_weather
          WHERE user_id = $1 AND status = 'ok' AND local_date = ANY($2::date[])`,
        [currentUserId(), dates],
      );
      for (const row of result.rows) days[row.date] = row.data;
    }
    res.json({ enabled, days });
  } catch (err) {
    console.error('Error getting weather:', err);
    res.status(500).json({ error: 'Failed to get weather' });
  }
});

// GET /weather/:date - full weather record for one day, for the details modal
weatherRouter.get('/:date', async (req: Request, res: Response) => {
  try {
    const date = String(req.params.date);
    if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const result = await query(
      `SELECT latitude, longitude, timezone, data FROM daily_weather
        WHERE user_id = $1 AND local_date = $2::date AND status = 'ok'`,
      [currentUserId(), date],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No weather for that day' });
    const row = result.rows[0];
    // The row stores the venue's coordinates. Look up the venue with a small
    // delta tolerance to account for floating-point / numeric representation differences.
    const venue = await query(
      `SELECT name, city, state, country FROM venues
        WHERE abs(latitude - $1) < 0.0001 AND abs(longitude - $2) < 0.0001
        ORDER BY (abs(latitude - $1) + abs(longitude - $2)) ASC, created_at ASC LIMIT 1`,
      [Number(row.latitude), Number(row.longitude)],
    );
    const place = venue.rows[0]
      ? { name: venue.rows[0].name, city: venue.rows[0].city, state: venue.rows[0].state, country: venue.rows[0].country }
      : null;
    res.json({ date, latitude: Number(row.latitude), longitude: Number(row.longitude), timezone: row.timezone, place, ...row.data });
  } catch (err) {
    console.error('Error getting weather day:', err);
    res.status(500).json({ error: 'Failed to get weather' });
  }
});
