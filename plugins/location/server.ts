/**
 * Location check-in type — server half.
 *
 * CUSTOM storage: Location keeps its pre-existing tables (`checkins`,
 * `venues`, `venue_categories`). The framework uses this half for the
 * unified timeline, backups, start-over, and mounts the plugin-owned API
 * routers.
 *
 * This plugin owns ALL location + venue-specific API surface:
 *   - /location-checkins            check-in CRUD (moved from routes/checkins.ts)
 *   - /location-checkins/stats/*    location stats (moved from routes/stats.ts)
 *   - /venues                       venue CRUD/search/merge/geocode (routes/venues.ts)
 *   - /search                       unified venue + check-in search (routes/search.ts)
 *   - /import/swarm                 Swarm CSV import (routes/import.ts)
 *
 * ...plus the "Backfill Venues" background job (geocode + categorize), moved
 * from the core jobs service. No location- or venue-specific routes remain
 * in the core platform.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';
import { find as findTimezone } from 'geo-tz';
import { getVenueTimezone, normalizeEtcGmt } from './services/geoTimezone';
import type {
  CheckinTypeServerPlugin,
  PluginJobContext,
  PluginReconciliationSuggestion,
  PluginReconciliationUninferable,
  PluginTimelineContext,
} from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query, pool } from '../../server/src/db';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';
import { reverseGeocode, searchPlacesByName } from './services/nominatim';
import { searchNearbyVenues, findEnclosingVenue } from './services/overpass';
import { findOrReuseVenue } from './services/venueMerge';

// ---------------------------------------------------------------------------
// Shared helpers (moved from routes/checkins.ts / routes/venues.ts)
// ---------------------------------------------------------------------------

function addTimezone(row: any): any {
  if (!row.venue_timezone && row.venue_latitude != null && row.venue_longitude != null) {
    row.venue_timezone = getVenueTimezone(row.venue_latitude, row.venue_longitude);
  } else {
    row.venue_timezone = row.venue_timezone || null;
  }
  return row;
}

type QueryExecutor = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

async function inferVenueTimezone(venueId: string, executor: QueryExecutor = query as unknown as QueryExecutor): Promise<string | null> {
  const venueResult = await executor.query(
    'SELECT latitude, longitude FROM venues WHERE id = $1',
    [venueId]
  );

  if (venueResult.rows.length === 0) return null;

  const venue = venueResult.rows[0];
  return getVenueTimezone(venue.latitude, venue.longitude);
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize a star rating payload to 1-4 or null (unrated). Values outside
 * the 1-4 range (including 0) are treated as unrated, matching the
 * ScorePicker contract where 0 = no rating.
 */
function normalizeRating(value: unknown): number | null {
  const n = toNumberOrNull(value);
  if (n == null) return null;
  return n >= 1 && n <= 4 ? Math.trunc(n) : null;
}

/** Trim, de-duplicate, and drop empty companion names (case-insensitive dedupe). */
function normalizeCompanions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function serializeVenue<T extends { latitude?: unknown; longitude?: unknown }>(venue: T): T {
  return {
    ...venue,
    latitude: toNumberOrNull(venue.latitude),
    longitude: toNumberOrNull(venue.longitude),
  } as T;
}

type GeocodableVenue = {
  id?: string | null;
  latitude?: unknown;
  longitude?: unknown;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

async function geocodeVenueLocationIfMissing<T extends GeocodableVenue>(venue: T): Promise<T> {
  const latitude = toNumberOrNull(venue.latitude);
  const longitude = toNumberOrNull(venue.longitude);
  const venueId = typeof venue.id === 'string' ? venue.id : null;

  if (!venueId || latitude == null || longitude == null) {
    return venue;
  }

  const hasCountry = typeof venue.country === 'string' && venue.country.trim() !== '';
  const hasState = typeof venue.state === 'string' && venue.state.trim() !== '';
  const hasCity = typeof venue.city === 'string' && venue.city.trim() !== '';

  if (hasCountry && hasState && hasCity) {
    return venue;
  }

  const geo = await reverseGeocode(latitude, longitude);
  if (!geo.country && !geo.state && !geo.city) {
    return venue;
  }

  const updated = await query(
    `UPDATE venues
     SET country = COALESCE(NULLIF(TRIM(country), ''), $2),
         state = COALESCE(NULLIF(TRIM(state), ''), $3),
         city = COALESCE(NULLIF(TRIM(city), ''), $4),
         updated_at = NOW()
     WHERE id = $1
     RETURNING city, state, country`,
    [venueId, geo.country || null, geo.state || null, geo.city || null]
  );

  if (updated.rows.length === 0) {
    return venue;
  }

  return {
    ...venue,
    city: updated.rows[0].city,
    state: updated.rows[0].state,
    country: updated.rows[0].country,
  };
}

function haversineMeters(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/location-checkins
// (moved from server/src/routes/checkins.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const router = Router();

// GET / - list check-ins with venue info
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      user_id, venue_id, from, to,
      limit = '50', offset = '0',
    } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`c.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (venue_id) {
      conditions.push(`c.venue_id = $${paramIndex}`);
      params.push(venue_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`c.checked_in_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`c.checked_in_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    if (req.query.category) {
      conditions.push(`vc.name = $${paramIndex}`);
      params.push(req.query.category);
      paramIndex++;
    }

    if (req.query.country) {
      conditions.push(`v.country = $${paramIndex}`);
      params.push(req.query.country);
      paramIndex++;
    }

    if (req.query.q) {
      const searchQuery = req.query.q as string;
      conditions.push(
        `(c.search_vector @@ plainto_tsquery('english', $${paramIndex})
         OR v.search_vector @@ plainto_tsquery('english', $${paramIndex}))`
      );
      params.push(searchQuery);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const sql = `
      SELECT c.id, c.user_id, c.venue_id, c.notes, c.rating,
              c.checked_in_at, c.checkin_timezone AS venue_timezone, c.created_at, c.updated_at,
              v.name AS venue_name, v.latitude AS venue_latitude, v.longitude AS venue_longitude,
              vc.name AS venue_category,
              pv.id AS parent_venue_id, pv.name AS parent_venue_name
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      LEFT JOIN venues pv ON v.parent_venue_id = pv.id
      ${whereClause}
      ORDER BY c.checked_in_at DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query(sql, params);
    res.json(result.rows.map(addTimezone));
  } catch (err) {
    console.error('Error listing check-ins:', err);
    res.status(500).json({ error: 'Failed to list check-ins' });
  }
});

// GET /companion-names?q=&limit= - distinct companion names for autocomplete
// (registered before /:id so "companion-names" isn't treated as a check-in id)
router.get('/companion-names', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const params: unknown[] = [USER_ID];

    let sql = `
      SELECT cc.name
      FROM checkin_companions cc
      JOIN checkins c ON c.id = cc.checkin_id
      WHERE c.user_id = $1`;

    if (q) {
      params.push(`%${q}%`);
      sql += ` AND cc.name ILIKE $2`;
    }

    sql += `
      GROUP BY cc.name
      ORDER BY cc.name
      LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    res.json(result.rows.map((r: any) => r.name));
  } catch (err) {
    console.error('Error listing companion names:', err);
    res.status(500).json({ error: 'Failed to list companion names' });
  }
});

// GET /:id - get single check-in with venue details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const checkinResult = await query(
      `SELECT c.id, c.user_id, c.venue_id, c.notes, c.rating,
              c.checked_in_at, c.checkin_timezone AS venue_timezone, c.created_at, c.updated_at,
              v.name AS venue_name, v.address AS venue_address,
              v.city AS venue_city, v.state AS venue_state,
              v.country AS venue_country, v.latitude AS venue_latitude,
              v.longitude AS venue_longitude,
              vc.name AS venue_category, vc.icon AS venue_category_icon,
              pv.id AS parent_venue_id, pv.name AS parent_venue_name
       FROM checkins c
       JOIN venues v ON c.venue_id = v.id
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       LEFT JOIN venues pv ON v.parent_venue_id = pv.id
       WHERE c.id = $1`,
      [id]
    );

    if (checkinResult.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    const companionResult = await query(
      `SELECT name FROM checkin_companions
       WHERE checkin_id = $1
       ORDER BY name`,
      [id]
    );

    res.json({
      ...addTimezone(checkinResult.rows[0]),
      companions: companionResult.rows.map((r: any) => r.name),
    });
  } catch (err) {
    console.error('Error getting check-in:', err);
    res.status(500).json({ error: 'Failed to get check-in' });
  }
});

// POST / - create check-in
router.post('/', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { user_id, venue_id, notes, checked_in_at, also_checkin_parent, rating } = req.body;
    const companions = normalizeCompanions(req.body.companions);
    const checkinRating = normalizeRating(rating);

    if (!user_id || !venue_id) {
      return res.status(400).json({ error: 'user_id and venue_id are required' });
    }

    const checkinTimezone = await inferVenueTimezone(venue_id, client);

    const result = await client.query(
      `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone, rating)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6)
       RETURNING *`,
      [user_id, venue_id, notes || null, checked_in_at || null, checkinTimezone, checkinRating]
    );

    const checkin = result.rows[0];

    // Companions for the primary check-in
    if (companions.length > 0) {
      await client.query(
        `INSERT INTO checkin_companions (checkin_id, name)
         SELECT $1, unnest($2::text[])
         ON CONFLICT (checkin_id, name) DO NOTHING`,
        [checkin.id, companions]
      );
    }

    // Optionally create a check-in at the parent venue too
    let parent_checkin = null;
    if (also_checkin_parent) {
      const venueResult = await client.query(
        'SELECT parent_venue_id FROM venues WHERE id = $1',
        [venue_id]
      );
      const parentVenueId = venueResult.rows[0]?.parent_venue_id;
      if (parentVenueId) {
        const parentResult = await client.query(
          `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone, rating)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5, $6)
           RETURNING *`,
          [user_id, parentVenueId, notes || null, checked_in_at || null, await inferVenueTimezone(parentVenueId, client), checkinRating]
        );
        parent_checkin = parentResult.rows[0];
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ ...checkin, parent_checkin, companions });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating check-in:', err);
    res.status(500).json({ error: 'Failed to create check-in' });
  } finally {
    client.release();
  }
});

// PUT /:id - update check-in
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { notes, checked_in_at } = req.body;
  const hasRating = 'rating' in req.body;
  const hasCompanions = 'companions' in req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build the SET clause. notes / checked_in_at keep their historical
    // "null means no change" behavior; rating uses explicit key presence so
    // the client can clear it back to unrated (null).
    const setClauses: string[] = [];
    const params: unknown[] = [id];
    let paramIndex = 1;

    if (notes !== undefined) {
      setClauses.push(`notes = COALESCE($${++paramIndex}, notes)`);
      params.push(notes);
    }
    if (checked_in_at !== undefined) {
      setClauses.push(`checked_in_at = COALESCE($${++paramIndex}::timestamptz, checked_in_at)`);
      params.push(checked_in_at);
    }
    if (hasRating) {
      setClauses.push(`rating = $${++paramIndex}`);
      params.push(normalizeRating(req.body.rating));
    }
    setClauses.push('updated_at = NOW()');

    const result = await client.query(
      `UPDATE checkins
       SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Check-in not found' });
    }

    // Companions use full-replacement semantics when the key is present.
    let companions: string[] = [];
    if (hasCompanions) {
      const names = normalizeCompanions(req.body.companions);
      await client.query('DELETE FROM checkin_companions WHERE checkin_id = $1', [id]);
      if (names.length > 0) {
        await client.query(
          `INSERT INTO checkin_companions (checkin_id, name)
           SELECT $1, unnest($2::text[])
           ON CONFLICT (checkin_id, name) DO NOTHING`,
          [id, names]
        );
      }
      companions = names;
    } else {
      const companionResult = await client.query(
        'SELECT name FROM checkin_companions WHERE checkin_id = $1 ORDER BY name',
        [id]
      );
      companions = companionResult.rows.map((r: any) => r.name);
    }

    await client.query('COMMIT');
    res.json({ ...result.rows[0], companions });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error updating check-in:', err);
    res.status(500).json({ error: 'Failed to update check-in' });
  } finally {
    client.release();
  }
});

// DELETE /:id - delete check-in
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM checkins WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Check-in not found' });
    }

    res.json({ message: 'Check-in deleted', id });
  } catch (err) {
    console.error('Error deleting check-in:', err);
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/location-checkins/stats/*
// (location endpoints moved from server/src/routes/stats.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const statsRouter = Router();

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

// GET /stats/summary?user_id= - overall stats summary
statsRouter.get('/summary', async (req: Request, res: Response) => {
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

// GET /stats/top-venues?user_id=&limit=10 - most visited venues
statsRouter.get('/top-venues', async (req: Request, res: Response) => {
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

// GET /stats/category-breakdown?user_id= - check-ins by category
statsRouter.get('/category-breakdown', async (req: Request, res: Response) => {
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

// GET /stats/heatmap?user_id=&year= - check-ins per day for a year
statsRouter.get('/heatmap', async (req: Request, res: Response) => {
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

// GET /stats/monthly?user_id=&year=&month= - check-ins per day for a month
statsRouter.get('/monthly', async (req: Request, res: Response) => {
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

// GET /stats/countries?user_id= - check-ins grouped by country
statsRouter.get('/countries', async (req: Request, res: Response) => {
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

// GET /stats/map-data?user_id=&from=&to= - venue locations with check-in counts for a date range
statsRouter.get('/map-data', async (req: Request, res: Response) => {
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

// GET /stats/day-of-week?user_id= - check-ins by day of week
statsRouter.get('/day-of-week', async (req: Request, res: Response) => {
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
    console.error('Error getting day-of-week:', err);
    res.status(500).json({ error: 'Failed to get day-of-week' });
  }
});

// GET /stats/time-of-day?user_id= - check-ins by time bucket
statsRouter.get('/time-of-day', async (req: Request, res: Response) => {
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
    console.error('Error getting time-of-day:', err);
    res.status(500).json({ error: 'Failed to get time-of-day' });
  }
});

// GET /stats/busiest-days?user_id= - top 10 calendar days by check-in count
statsRouter.get('/busiest-days', async (req: Request, res: Response) => {
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

// GET /stats/top-cities?user_id= - cities ranked by check-in count
statsRouter.get('/top-cities', async (req: Request, res: Response) => {
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

// GET /stats/additional-stats?user_id= - extra fun stats
statsRouter.get('/additional-stats', async (req: Request, res: Response) => {
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

router.use('/stats', statsRouter);

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/venues
// (moved from server/src/routes/venues.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const venuesRouter = Router();

// GET / - list venues with optional search, category filter, pagination
venuesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { search, category, limit = '50', offset = '0' } = req.query;
    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`v.search_vector @@ plainto_tsquery('english', $${paramIndex})`);
      params.push(search);
      paramIndex++;
    }

    if (category) {
      conditions.push(`vc.name = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rankSelect = search
      ? `, ts_rank(v.search_vector, plainto_tsquery('english', $1)) AS rank`
      : '';
    const orderBy = search ? 'ORDER BY rank DESC' : 'ORDER BY v.created_at DESC';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const sql = `
      SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
             v.latitude, v.longitude, v.osm_id, v.rating, v.created_at, v.updated_at,
             vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon
             ${rankSelect}
      FROM venues v
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      ${whereClause}
      ${orderBy}
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `;

    const result = await query(sql, params);
    res.json(result.rows.map((row) => serializeVenue(row)));
  } catch (err) {
    console.error('Error listing venues:', err);
    res.status(500).json({ error: 'Failed to list venues' });
  }
});

// GET /nearby - search nearby venues from DB and optionally OSM
venuesRouter.get('/nearby', async (req: Request, res: Response) => {
  try {
    const { lat, lon, radius = '5000', limit = '20', offset = '0' } = req.query;
    const rawSearch = typeof req.query.search === 'string'
      ? req.query.search
      : typeof req.query.q === 'string'
        ? req.query.q
        : undefined;
    const search = rawSearch?.trim() || undefined;

    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon are required' });
    }

    const latNum = parseFloat(lat as string);
    const lonNum = parseFloat(lon as string);
    const radiusMeters = parseInt(radius as string, 10);
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);

    if (isNaN(latNum) || isNaN(lonNum)) {
      return res.status(400).json({ error: 'lat and lon must be valid numbers' });
    }

    // Search local DB using Haversine distance
    const dbParams: unknown[] = [latNum, lonNum, radiusMeters];
    let searchCondition = '';
    if (search) {
      searchCondition = `AND v.search_vector @@ plainto_tsquery('english', $4)`;
      dbParams.push(search);
    }

    const dbSql = `
      SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
             v.latitude, v.longitude, v.osm_id, v.created_at, v.updated_at,
             vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
             (6371000 * acos(
               cos(radians($1)) * cos(radians(v.latitude)) *
               cos(radians(v.longitude) - radians($2)) +
               sin(radians($1)) * sin(radians(v.latitude))
             )) AS distance,
             'local' AS source
      FROM venues v
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      WHERE (6371000 * acos(
               cos(radians($1)) * cos(radians(v.latitude)) *
               cos(radians(v.longitude) - radians($2)) +
               sin(radians($1)) * sin(radians(v.latitude))
             )) <= $3
      ${searchCondition}
      ORDER BY distance ASC
    `;

    const dbResult = await query(dbSql, dbParams);
    const localVenues = dbResult.rows.map((row) => serializeVenue(row));

    // Also query Overpass API
    let osmVenues: Array<Record<string, unknown>> = [];
    try {
      const osmResults = await searchNearbyVenues(
        latNum,
        lonNum,
        search as string | undefined,
        radiusMeters
      );

      // Filter out OSM results that already exist in local DB by osm_id
      const localOsmIds = new Set(
        localVenues.filter((v: { osm_id: string | null }) => v.osm_id).map((v: { osm_id: string }) => v.osm_id)
      );

      osmVenues = osmResults
        .filter((r) => !localOsmIds.has(r.osm_id))
        .map((r) => ({
          ...r,
          source: 'osm',
        }));
    } catch (osmErr) {
      // If Overpass fails, just return local results
      console.error('Overpass API error (non-fatal):', osmErr);
    }

    const localWithDistance = localVenues
      .map((venue: Record<string, unknown>) => ({
        ...venue,
        distance: typeof venue.distance === 'number' ? venue.distance : Number(venue.distance),
      }))
      .filter((venue) => Number.isFinite(venue.distance))
      .sort((a, b) => a.distance - b.distance);

    const osmWithDistance = osmVenues
      .map((venue) => ({
        ...venue,
        distance: haversineMeters(
          latNum,
          lonNum,
          Number(venue.latitude),
          Number(venue.longitude)
        ),
      }))
      .filter((venue) => Number.isFinite(venue.distance))
      .sort((a, b) => a.distance - b.distance);

    // Keep the first page source-diverse so check-in search doesn't appear "local only"
    // in dense areas where local venues can dominate the nearest-distance ranking.
    let paged: Array<Record<string, unknown>>;
    if (offsetNum === 0 && limitNum > 1 && osmWithDistance.length > 0) {
      const osmQuota = Math.min(Math.floor(limitNum / 2), osmWithDistance.length);
      const localQuota = limitNum - osmQuota;
      paged = [
        ...localWithDistance.slice(0, localQuota),
        ...osmWithDistance.slice(0, osmQuota),
      ]
        .sort((a, b) => Number(a.distance) - Number(b.distance))
        .map(({ distance, ...venue }) => venue);
    } else {
      const combined = [...localWithDistance, ...osmWithDistance]
        .sort((a, b) => a.distance - b.distance);
      paged = combined
        .slice(offsetNum, offsetNum + limitNum)
        .map(({ distance, ...venue }) => venue);
    }

    res.json(paged);
  } catch (err) {
    console.error('Error searching nearby venues:', err);
    res.status(500).json({ error: 'Failed to search nearby venues' });
  }
});

// GET /categories - list all venue categories
venuesRouter.get('/categories', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, icon, parent_id, created_at
       FROM venue_categories
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing categories:', err);
    res.status(500).json({ error: 'Failed to list categories' });
  }
});

// GET /place-search?q= - geocode a city or named place to map coordinates
venuesRouter.get('/place-search', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitNum = Math.min(Math.max(parseInt(String(req.query.limit || '5'), 10) || 5, 1), 10);

    if (!q) {
      return res.status(400).json({ error: 'q is required' });
    }

    const places = await searchPlacesByName(q, limitNum);
    return res.json(places);
  } catch (err) {
    console.error('Error searching places:', err);
    return res.status(500).json({ error: 'Failed to search places' });
  }
});

// ---------------------------------------------------------------------------
// Venue lists (mirrors the media plugin's /lists endpoints). These 1-segment
// routes must be registered before /:id so "lists" isn't treated as a venue id.
// ---------------------------------------------------------------------------

// GET /lists - lists with their venues
venuesRouter.get('/lists', async (_req: Request, res: Response) => {
  try {
    const listsResult = await query(
      'SELECT id, name, created_at FROM venue_lists WHERE user_id = $1 ORDER BY created_at',
      [USER_ID]
    );
    const itemsResult = await query(
      `SELECT l.id AS list_id,
              json_agg(json_build_object(
                'id', v.id, 'name', v.name, 'added_at', vli.added_at
              ) ORDER BY vli.added_at, vli.position) AS items
       FROM venue_lists l
       LEFT JOIN venue_list_items vli ON vli.list_id = l.id
       LEFT JOIN venues v ON vli.venue_id = v.id
       WHERE l.user_id = $1
       GROUP BY l.id`,
      [USER_ID]
    );
    const itemsById = new Map(itemsResult.rows.map((r: any) => [r.list_id as string, r.items]));
    res.json(listsResult.rows.map((l: any) => ({ ...l, items: itemsById.get(l.id) || [] })));
  } catch (err) {
    console.error('Error listing venue lists:', err);
    res.status(500).json({ error: 'Failed to list venue lists' });
  }
});

// POST /lists - create a list
venuesRouter.post('/lists', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await query(
      'INSERT INTO venue_lists (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at',
      [USER_ID, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'A list with that name already exists' });
    }
    console.error('Error creating venue list:', err);
    res.status(500).json({ error: 'Failed to create venue list' });
  }
});

// PUT /lists/:id - rename a list
venuesRouter.put('/lists/:id', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await query(
      'UPDATE venue_lists SET name = $2 WHERE id = $1 AND user_id = $3 RETURNING id, name, created_at',
      [req.params.id, name.trim(), USER_ID]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue list not found' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'A list with that name already exists' });
    }
    console.error('Error renaming venue list:', err);
    res.status(500).json({ error: 'Failed to rename venue list' });
  }
});

// DELETE /lists/:id - delete a list
venuesRouter.delete('/lists/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM venue_lists WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, USER_ID]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue list not found' });
    }
    res.json({ message: 'Venue list deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('Error deleting venue list:', err);
    res.status(500).json({ error: 'Failed to delete venue list' });
  }
});

// POST /lists/:id/items - add a venue to a list (idempotent)
venuesRouter.post('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const { venue_id } = req.body;
    if (!venue_id) return res.status(400).json({ error: 'venue_id is required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const listResult = await client.query(
        'SELECT id FROM venue_lists WHERE id = $1 AND user_id = $2',
        [req.params.id, USER_ID]
      );
      if (listResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Venue list not found' });
      }
      const venueResult = await client.query(
        'SELECT id FROM venues WHERE id = $1',
        [venue_id]
      );
      if (venueResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Venue not found' });
      }
      const maxPos = await client.query(
        'SELECT COALESCE(MAX(position), 0)::int AS pos FROM venue_list_items WHERE list_id = $1',
        [req.params.id]
      );
      await client.query(
        `INSERT INTO venue_list_items (list_id, venue_id, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (list_id, venue_id) DO NOTHING`,
        [req.params.id, venue_id, (maxPos.rows[0]?.pos ?? 0) + 1]
      );
      await client.query('COMMIT');
      res.status(201).json({ message: 'Added to list' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error adding to venue list:', err);
    res.status(500).json({ error: 'Failed to add venue to list' });
  }
});

// DELETE /lists/:id/items/:venueId - remove a venue from a list
venuesRouter.delete('/lists/:id/items/:venueId', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM venue_list_items vli
       USING venue_lists l
       WHERE vli.list_id = l.id AND l.id = $1 AND l.user_id = $2 AND vli.venue_id = $3
       RETURNING vli.list_id`,
      [req.params.id, USER_ID, req.params.venueId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not in list' });
    }
    res.json({ message: 'Removed from list' });
  } catch (err) {
    console.error('Error removing from venue list:', err);
    res.status(500).json({ error: 'Failed to remove venue from list' });
  }
});

// ---------------------------------------------------------------------------
// GET /library?from=&to= - the "All Venues" library view: one row per venue
// with at least one check-in in range (all venues with check-ins when no range),
// including its rating, most recent check-in, check-in count, and list names.
// ---------------------------------------------------------------------------
venuesRouter.get('/library', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const includeUnchecked = !from && !to;

    const params: unknown[] = [USER_ID];
    const dateConditions: string[] = [];
    if (from) {
      dateConditions.push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= $${params.length + 1}::date`);
      params.push(from);
    }
    if (to) {
      dateConditions.push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= $${params.length + 1}::date`);
      params.push(to);
    }
    const join = includeUnchecked
      ? `LEFT JOIN checkins c ON c.venue_id = v.id AND c.user_id = $1`
      : `JOIN checkins c ON c.venue_id = v.id AND c.user_id = $1`;

    const result = await query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.rating,
              vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
              (ARRAY_AGG(c.checked_in_at ORDER BY c.checked_in_at DESC, c.id DESC))[1] AS last_checkin_at,
              (ARRAY_AGG(c.checkin_timezone ORDER BY c.checked_in_at DESC, c.id DESC))[1] AS last_checkin_timezone,
              COUNT(c.id) FILTER (WHERE c.id IS NOT NULL)::int AS checkin_count
       FROM venues v
       ${join}
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       ${dateConditions.length ? `WHERE ${dateConditions.join(' AND ')}` : ''}
       GROUP BY v.id, vc.id, vc.name, vc.icon
       HAVING COUNT(c.id) > 0
       ORDER BY last_checkin_at DESC NULLS LAST`,
      params
    );

    // List names per venue (only for venues returned above).
    const venueIds = result.rows.map((r: any) => r.id);
    const listNamesByVenue = new Map<string, string[]>();
    if (venueIds.length > 0) {
      const listResult = await query(
        `SELECT vli.venue_id, vl.name
         FROM venue_list_items vli
         JOIN venue_lists vl ON vl.id = vli.list_id
         WHERE vl.user_id = $1 AND vli.venue_id = ANY($2::uuid[])
         ORDER BY vl.created_at`,
        [USER_ID, venueIds]
      );
      for (const row of listResult.rows) {
        const arr = listNamesByVenue.get(row.venue_id) || [];
        arr.push(row.name);
        listNamesByVenue.set(row.venue_id, arr);
      }
    }

    res.json(result.rows.map((r: any) => serializeVenue({
      ...r,
      lists: listNamesByVenue.get(r.id) || [],
    })));
  } catch (err) {
    console.error('Error getting venue library:', err);
    res.status(500).json({ error: 'Failed to get venue library' });
  }
});

// GET /:id - get single venue with check-in count
venuesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
              v.latitude, v.longitude, v.osm_id, v.parent_venue_id, v.rating,
              v.created_at, v.updated_at,
              vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
              pv.name AS parent_venue_name,
              COUNT(c.id)::int AS checkin_count
       FROM venues v
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       LEFT JOIN venues pv ON v.parent_venue_id = pv.id
       LEFT JOIN checkins c ON c.venue_id = v.id
       WHERE v.id = $1
       GROUP BY v.id, vc.id, pv.name`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    const venue = result.rows[0];

    // Fetch child venues (e.g. terminals inside an airport)
    const childrenResult = await query(
      `SELECT id, name FROM venues WHERE parent_venue_id = $1 ORDER BY name`,
      [id]
    );
    venue.child_venues = childrenResult.rows;

    res.json(serializeVenue(venue));
  } catch (err) {
    console.error('Error getting venue:', err);
    res.status(500).json({ error: 'Failed to get venue' });
  }
});

// POST / - create venue
venuesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name, category_id, address, city, state, country,
      postal_code, latitude, longitude, osm_id, rating,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    const venue = await findOrReuseVenue({
      name,
      category_id: category_id || null,
      address: address || null,
      city: city || null,
      state: state || null,
      country: country || null,
      postal_code: postal_code || null,
      latitude: parseFloat(String(latitude)),
      longitude: parseFloat(String(longitude)),
      osm_id: osm_id || null,
    });

    const geocodedVenue = await geocodeVenueLocationIfMissing(venue);

    // Rating is set after find/reuse so a reused venue keeps its existing
    // rating unless the caller explicitly provides one.
    const venueRating = normalizeRating(rating);
    if (venueRating != null) {
      await query(
        'UPDATE venues SET rating = $2, updated_at = NOW() WHERE id = $1',
        [venue.id, venueRating]
      );
    }

    // Re-fetch to return a canonical row that includes the rating column.
    const finalResult = await query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
              v.latitude, v.longitude, v.osm_id, v.rating, v.created_at, v.updated_at,
              vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon
       FROM venues v
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       WHERE v.id = $1`,
      [venue.id]
    );
    const finalVenue = finalResult.rows.length > 0
      ? finalResult.rows[0]
      : { ...geocodedVenue, rating: venueRating };

    res.status(201).json(serializeVenue(finalVenue));
  } catch (err) {
    console.error('Error creating venue:', err);
    res.status(500).json({ error: 'Failed to create venue' });
  }
});

// PUT /:id - update venue metadata
venuesRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body;
    const hasRating = 'rating' in body;

    // Partial-update semantics: only keys present in the body are updated.
    // This lets callers (e.g. a rating-only save) change a single field.
    if (body.name !== undefined && !body.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const hasLat = body.latitude !== undefined;
    const hasLng = body.longitude !== undefined;
    if (hasLat !== hasLng) {
      return res.status(400).json({ error: 'latitude and longitude must be provided together' });
    }

    const setClauses: string[] = [];
    const params: unknown[] = [id];
    const push = (clause: string, value?: unknown) => {
      params.push(value);
      setClauses.push(clause.replace('$n', `$${params.length}`));
    };

    if (body.name !== undefined) push('name = $n', body.name);
    for (const field of ['category_id', 'address', 'city', 'state', 'country', 'postal_code'] as const) {
      if (body[field] !== undefined) push(`${field} = $n`, body[field] || null);
    }
    if (hasLat) {
      push('latitude = $n', parseFloat(String(body.latitude)));
      push('longitude = $n', parseFloat(String(body.longitude)));
    }
    if (body.osm_id !== undefined) push('osm_id = COALESCE($n, osm_id)', body.osm_id || null);
    // Rating uses explicit key presence so the client can clear it to unrated.
    if (hasRating) push('rating = $n', normalizeRating(body.rating));
    setClauses.push('updated_at = NOW()');

    const result = await query(
      `UPDATE venues
       SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    res.json(serializeVenue(result.rows[0]));
  } catch (err) {
    console.error('Error updating venue:', err);
    res.status(500).json({ error: 'Failed to update venue' });
  }
});

// DELETE /:id - delete venue when it has no check-ins
venuesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const venueResult = await query(
      `SELECT v.id,
              COUNT(c.id)::int AS checkin_count,
              COUNT(child.id)::int AS child_count
       FROM venues v
       LEFT JOIN checkins c ON c.venue_id = v.id
       LEFT JOIN venues child ON child.parent_venue_id = v.id
       WHERE v.id = $1
       GROUP BY v.id`,
      [id]
    );

    if (venueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    const venue = venueResult.rows[0];
    const checkinCount = Number(venue.checkin_count) || 0;
    const childCount = Number(venue.child_count) || 0;

    if (checkinCount > 0) {
      return res.status(409).json({ error: 'Cannot delete a venue with check-ins' });
    }

    if (childCount > 0) {
      return res.status(409).json({ error: 'Cannot delete a venue that has child venues' });
    }

    await query('DELETE FROM venues WHERE id = $1', [id]);

    return res.json({ message: 'Venue deleted', id });
  } catch (err) {
    console.error('Error deleting venue:', err);
    return res.status(500).json({ error: 'Failed to delete venue' });
  }
});

// POST /:id/merge-into - merge this venue into another, moving all check-ins to the target
venuesRouter.post('/:id/merge-into', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { target_id } = req.body as { target_id?: string };

    if (!target_id) return res.status(400).json({ error: 'target_id is required' });
    if (id === target_id) return res.status(400).json({ error: 'Cannot merge a venue into itself' });

    const [srcCheck, tgtCheck] = await Promise.all([
      query('SELECT id, name FROM venues WHERE id = $1', [id]),
      query('SELECT id, name FROM venues WHERE id = $1', [target_id]),
    ]);
    if (!srcCheck.rows.length) return res.status(404).json({ error: 'Source venue not found' });
    if (!tgtCheck.rows.length) return res.status(404).json({ error: 'Target venue not found' });

    // Move all check-ins from the source venue to the target
    await query('UPDATE checkins SET venue_id = $1 WHERE venue_id = $2', [target_id, id]);

    // Re-parent any child venues that pointed to the source
    await query('UPDATE venues SET parent_venue_id = $1 WHERE parent_venue_id = $2', [target_id, id]);

    // Delete the source venue
    await query('DELETE FROM venues WHERE id = $1', [id]);

    // Return the updated target venue
    const result = await query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
              v.latitude, v.longitude, v.osm_id, v.parent_venue_id,
              v.created_at, v.updated_at,
              vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
              pv.name AS parent_venue_name,
              COUNT(c.id)::int AS checkin_count
       FROM venues v
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       LEFT JOIN venues pv ON v.parent_venue_id = pv.id
       LEFT JOIN checkins c ON c.venue_id = v.id
       WHERE v.id = $1
       GROUP BY v.id, vc.id, pv.name`,
      [target_id]
    );

    res.json(serializeVenue(result.rows[0]));
  } catch (err) {
    console.error('Error merging venue:', err);
    res.status(500).json({ error: 'Failed to merge venue' });
  }
});

// POST /import-osm - import a venue from OSM data
venuesRouter.post('/import-osm', async (req: Request, res: Response) => {
  try {
    const { name, category, latitude, longitude, address, osm_id } = req.body;

    if (!name || !osm_id) {
      return res.status(400).json({ error: 'name and osm_id are required' });
    }

    // Try to find a matching category
    let categoryId: string | null = null;
    if (category) {
      const catResult = await query(
        'SELECT id FROM venue_categories WHERE name = $1',
        [category]
      );
      if (catResult.rows.length > 0) {
        categoryId = catResult.rows[0].id;
      }
    }

    // Parse address string into components if it's a comma-separated string
    let city: string | null = null;
    let state: string | null = null;
    let addressLine: string | null = address || null;

    if (address && typeof address === 'string') {
      const parts = address.split(',').map((p: string) => p.trim());
      if (parts.length >= 3) {
        addressLine = parts[0];
        city = parts[1];
        state = parts[2];
      } else if (parts.length === 2) {
        addressLine = parts[0];
        city = parts[1];
      }
    }

    const childVenue = await findOrReuseVenue({
      name,
      category_id: categoryId,
      address: addressLine,
      city,
      state,
      latitude: parseFloat(String(latitude)),
      longitude: parseFloat(String(longitude)),
      osm_id,
    });

    const geocodedChildVenue = await geocodeVenueLocationIfMissing(childVenue) as typeof childVenue & {
      parent_venue_id?: string | null;
      parent_venue_name?: string | null;
    };

    // Try to find an enclosing parent venue (e.g. the airport containing a terminal)
    if (latitude && longitude) {
      try {
        const latNum = parseFloat(String(latitude));
        const lngNum = parseFloat(String(longitude));
        const enclosing = await findEnclosingVenue(
          latNum, lngNum, osm_id
        );
        if (enclosing) {
          // Upsert the parent venue
          let parentVenue;
          const existingParent = await query(
            'SELECT id, name FROM venues WHERE osm_id = $1',
            [enclosing.osm_id]
          );
          if (existingParent.rows.length > 0) {
            parentVenue = existingParent.rows[0];
          } else {
            let parentCategoryId: string | null = null;
            if (enclosing.category) {
              const catRes = await query(
                'SELECT id FROM venue_categories WHERE name = $1',
                [enclosing.category]
              );
              if (catRes.rows.length > 0) parentCategoryId = catRes.rows[0].id;
            }
            const parentInsert = await query(
              `INSERT INTO venues (name, category_id, address, latitude, longitude, osm_id)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id, name`,
              [enclosing.name, parentCategoryId, enclosing.address,
               enclosing.latitude, enclosing.longitude, enclosing.osm_id]
            );
            parentVenue = parentInsert.rows[0];
          }

          // Link child to parent
          await query(
            'UPDATE venues SET parent_venue_id = $1 WHERE id = $2 AND parent_venue_id IS NULL',
            [parentVenue.id, geocodedChildVenue.id]
          );
          geocodedChildVenue.parent_venue_id = parentVenue.id;
          geocodedChildVenue.parent_venue_name = parentVenue.name;
        }
      } catch (parentErr) {
        // Non-fatal — venue was created, just no parent link
        console.error('Parent venue lookup failed (non-fatal):', parentErr);
      }
    }

    res.status(201).json(serializeVenue(geocodedChildVenue));
  } catch (err) {
    console.error('Error importing OSM venue:', err);
    res.status(500).json({ error: 'Failed to import OSM venue' });
  }
});

// POST /geocode - reverse geocode venues missing country data
venuesRouter.post('/geocode', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, latitude, longitude FROM venues
       WHERE country IS NULL OR TRIM(country) = ''
       LIMIT 50`
    );

    let updated = 0;
    for (const venue of result.rows) {
      const geo = await reverseGeocode(
        parseFloat(venue.latitude),
        parseFloat(venue.longitude)
      );
      if (geo.country) {
        await query(
          `UPDATE venues SET
           country = $1,
           state = COALESCE(NULLIF(TRIM(state), ''), $2),
           city = COALESCE(NULLIF(TRIM(city), ''), $3)
          WHERE id = $4`,
          [geo.country, geo.state || null, geo.city || null, venue.id]
        );
        updated++;
      }
    }

    const remaining = await query(
      `SELECT COUNT(*)::int AS count FROM venues WHERE country IS NULL OR TRIM(country) = ''`
    );

    res.json({ updated, remaining: remaining.rows[0].count });
  } catch (err) {
    console.error('Error geocoding venues:', err);
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// POST /categorize - categorize uncategorized venues using Overpass
venuesRouter.post('/categorize', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, latitude, longitude FROM venues
       WHERE category_id IS NULL
       LIMIT 20`
    );

    let updated = 0;
    for (const venue of result.rows) {
      try {
        const lat = parseFloat(venue.latitude);
        const lng = parseFloat(venue.longitude);
        const nearby = await searchNearbyVenues(lat, lng, venue.name, 200);

        // Find the best match by name similarity
        const nameLower = venue.name.toLowerCase();
        const match = nearby.find(
          (n) => n.name.toLowerCase() === nameLower
        ) || nearby.find(
          (n) => nameLower.includes(n.name.toLowerCase()) || n.name.toLowerCase().includes(nameLower)
        );

        if (match && match.category) {
          // Find or create the category
          let catResult = await query(
            'SELECT id FROM venue_categories WHERE name = $1',
            [match.category]
          );
          if (catResult.rows.length === 0) {
            catResult = await query(
              'INSERT INTO venue_categories (name) VALUES ($1) RETURNING id',
              [match.category]
            );
          }
          await query(
            'UPDATE venues SET category_id = $1 WHERE id = $2',
            [catResult.rows[0].id, venue.id]
          );
          updated++;
        }
      } catch (venueErr) {
        // Skip individual venue errors (e.g. Overpass timeout)
        console.error(`Failed to categorize venue ${venue.id}:`, venueErr);
      }
    }

    const remaining = await query(
      'SELECT COUNT(*)::int AS count FROM venues WHERE category_id IS NULL'
    );

    res.json({ updated, remaining: remaining.rows[0].count });
  } catch (err) {
    console.error('Error categorizing venues:', err);
    res.status(500).json({ error: 'Categorization failed' });
  }
});

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/search
// (moved from server/src/routes/search.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const searchRouter = Router();

// GET /?q=&type=&limit=&offset= - unified search
searchRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { q, type = 'all', limit = '20', offset = '0' } = req.query;

    if (!q || (typeof q === 'string' && q.trim().length === 0)) {
      return res.status(400).json({ error: 'q (search query) is required' });
    }

    const searchQuery = q as string;
    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    const searchType = type as string;

    if (!['all', 'venues', 'checkins'].includes(searchType)) {
      return res.status(400).json({ error: 'type must be "all", "venues", or "checkins"' });
    }

    const result: { venues?: unknown[]; checkins?: unknown[] } = {};

    if (searchType === 'venues' || searchType === 'all') {
      const venuesResult = await query(
        `SELECT v.id, v.name, v.address, v.city, v.state, v.country,
                v.latitude, v.longitude, v.osm_id, v.created_at,
                vc.name AS category_name, vc.icon AS category_icon,
                ts_rank(v.search_vector, plainto_tsquery('english', $1)) AS rank
         FROM venues v
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         WHERE v.search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [searchQuery, limitNum, offsetNum]
      );
      result.venues = venuesResult.rows;
    }

    if (searchType === 'checkins' || searchType === 'all') {
      const checkinsResult = await query(
        `SELECT c.id, c.user_id, c.notes, c.checked_in_at, c.created_at,
                v.id AS venue_id, v.name AS venue_name,
                vc.name AS venue_category,
                pv.id AS parent_venue_id, pv.name AS parent_venue_name,
                ts_rank(
                  c.search_vector || COALESCE(v.search_vector, ''::tsvector) || COALESCE(pv.search_vector, ''::tsvector),
                  plainto_tsquery('english', $1)
                ) AS rank
         FROM checkins c
         JOIN venues v ON c.venue_id = v.id
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         LEFT JOIN venues pv ON v.parent_venue_id = pv.id
         WHERE c.search_vector @@ plainto_tsquery('english', $1)
            OR v.search_vector @@ plainto_tsquery('english', $1)
            OR pv.search_vector @@ plainto_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $2 OFFSET $3`,
        [searchQuery, limitNum, offsetNum]
      );
      result.checkins = checkinsResult.rows;
    }

    // If searching a specific type, return the array directly
    if (searchType === 'venues') {
      return res.json(result.venues);
    }

    if (searchType === 'checkins') {
      return res.json(result.checkins);
    }

    // type=all returns both
    res.json(result);
  } catch (err) {
    console.error('Error searching:', err);
    res.status(500).json({ error: 'Failed to search' });
  }
});

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/import/swarm
// (moved from server/src/routes/import.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const swarmImportRouter = Router();

const csvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-import');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});

const csvUpload = multer({
  storage: csvStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Find or create a venue from Swarm CSV data
async function findOrCreateVenue(
  venueName: string,
  lat: number,
  lng: number,
  swarmVenueId: string | null
): Promise<string> {
  const venue = await findOrReuseVenue({
    name: venueName,
    latitude: lat,
    longitude: lng,
    swarm_venue_id: swarmVenueId,
  });

  return venue.id;
}

// POST / - import Swarm CSV files
swarmImportRouter.post('/', csvUpload.array('files', 100), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No CSV files provided' });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    for (const file of files) {
      const content = fs.readFileSync(file.path, 'utf-8');

      // The Swarm CSV export has repeated header rows between records.
      // Split by lines, find all header rows, and parse each block.
      const lines = content.split('\n');
      let currentHeaders: string[] = [];
      const records: Record<string, string>[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Parse the line as CSV
        let parsed: string[][];
        try {
          parsed = parse(trimmed, { relax_column_count: true, trim: true });
        } catch {
          continue;
        }

        if (parsed.length === 0 || parsed[0].length === 0) continue;
        const row = parsed[0];

        // Detect header row: starts with "id" as first field
        if (row[0] === 'id') {
          currentHeaders = row;
          continue;
        }

        // Data row — map to object using current headers
        if (currentHeaders.length > 0) {
          const record: Record<string, string> = {};
          for (let i = 0; i < currentHeaders.length && i < row.length; i++) {
            record[currentHeaders[i]] = row[i];
          }
          records.push(record);
        }
      }

      for (const row of records) {
        try {
          const swarmId = row['id'];
          const venueName = row['venue.name'];
          const lat = parseFloat(row['lat']);
          const lng = parseFloat(row['lng']);
          const createdAt = row['createdAt'];
          const shout = row['shout'] || null;
          const swarmVenueId = row['venue.id'] || null;

          if (!swarmId || !venueName || isNaN(lat) || isNaN(lng) || !createdAt) {
            skipped++;
            continue;
          }

          // Check for duplicate by swarm_id
          const existing = await query(
            'SELECT id FROM checkins WHERE swarm_id = $1',
            [swarmId]
          );
          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          const venueId = await findOrCreateVenue(venueName, lat, lng, swarmVenueId);

          await query(
            `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, swarm_id)
             VALUES ($1, $2, $3, $4::timestamptz, $5)`,
            [USER_ID, venueId, shout, createdAt, swarmId]
          );

          imported++;
        } catch (rowErr: any) {
          errors.push(`Row error (id=${row['id']}): ${rowErr.message || rowErr}`);
          skipped++;
        }
      }

      // Clean up temp file
      try {
        fs.unlinkSync(file.path);
      } catch { /* ignore */ }
    }

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err: any) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message || String(err) });
  }
});

// ---------------------------------------------------------------------------
// Venue backfill job (geocode + categorize)
// (moved from the core jobs service; behavior unchanged)
// ---------------------------------------------------------------------------

async function geocodeBatch(jobId: string, remainingBefore: number, totalUpdatedBefore: number) {
  const result = await query(
    `SELECT id, latitude, longitude FROM venues
     WHERE country IS NULL OR TRIM(country) = ''
     LIMIT 100`
  );
  const total = result.rows.length;

  let updated = 0;
  let failed = 0;
  const failedIds: string[] = [];
  for (const venue of result.rows) {
    const geo = await reverseGeocode(
      parseFloat(venue.latitude),
      parseFloat(venue.longitude)
    );
    if (!geo.country) {
      failed++;
      failedIds.push(venue.id);
      continue;
    }
    await query(
      `UPDATE venues SET
        country = $1,
        state = COALESCE(NULLIF(TRIM(state), ''), $2),
        city = COALESCE(NULLIF(TRIM(city), ''), $3)
       WHERE id = $4`,
      [geo.country, geo.state || null, geo.city || null, venue.id]
    );
    updated++;
    const processed = updated + failedIds.length;
    const remaining = Math.max(0, total - processed);
    console.log(`[jobs] geocode ${jobId} venue ${processed}/${total}`);
  }

  const remaining = await query(
    `SELECT COUNT(*)::int AS count FROM venues WHERE country IS NULL OR TRIM(country) = ''`
  );

  return { updated, failed: failedIds.length, remaining: remaining.rows[0].count };
}

async function categorizeBatch(jobId: string, remainingBefore: number, totalUpdatedBefore: number) {
  const result = await query(
    `SELECT id, name, latitude, longitude FROM venues
     WHERE category_id IS NULL
     LIMIT 20`
  );

  let updated = 0;
  for (const venue of result.rows) {
    try {
      const lat = parseFloat(venue.latitude);
      const lng = parseFloat(venue.longitude);

      const nearby = await searchNearbyVenues(lat, lng, venue.name, 200);

      const nameLower = venue.name.toLowerCase();
      const match = nearby.find(
        (n) => n.name.toLowerCase() === nameLower
      ) || nearby.find(
        (n) => nameLower.includes(n.name.toLowerCase()) || n.name.toLowerCase().includes(nameLower)
      );

      if (match && match.category) {
        let catResult = await query(
          'SELECT id FROM venue_categories WHERE name = $1',
          [match.category]
        );
        if (catResult.rows.length === 0) {
          catResult = await query(
            'INSERT INTO venue_categories (name) VALUES ($1) RETURNING id',
            [match.category]
          );
        }
        await query(
          'UPDATE venues SET category_id = $1 WHERE id = $2',
          [catResult.rows[0].id, venue.id]
        );
        updated++;
      }

      await new Promise((r) => setTimeout(r, 1100));
    } catch (venueErr) {
      console.error(`Failed to categorize venue ${venue.id}:`, venueErr);
    }
  }

  const remaining = await query(
    'SELECT COUNT(*)::int AS count FROM venues WHERE category_id IS NULL'
  );

  return { updated, remaining: remaining.rows[0].count };
}

/**
 * The "Backfill Venues" job: reverse-geocode venues missing country data,
 * then categorize uncategorized venues using Overpass. Runs in the
 * background; cancellation is observed between batches.
 */
async function venueBackfillHandler(ctx: PluginJobContext): Promise<void> {
  await ctx.updateProgress({ phase: 'geocode', message: 'Starting venue geocoding...' });

  // Phase 1: Geocode (batched until no venues remain without a country)
  let totalGeoUpdated = 0;
  const geoRemainingInit = await query(
    `SELECT COUNT(*)::int AS count FROM venues WHERE country IS NULL OR TRIM(country) = ''`
  );
  let geoRemaining = geoRemainingInit.rows[0].count;
  while (geoRemaining > 0) {
    if (ctx.isCancelled()) throw new Error('cancelled');
    const batch = await geocodeBatch(ctx.jobId, geoRemaining, totalGeoUpdated);
    totalGeoUpdated += batch.updated;
    geoRemaining = batch.remaining;
    await ctx.updateProgress({
      phase: 'geocode',
      message: `Geocoded ${totalGeoUpdated} venues...`,
      updated: totalGeoUpdated,
      remaining: geoRemaining,
    });
    if (batch.updated === 0) {
      console.warn(
        `[jobs] backfill geocode batch made NO progress (remaining=${geoRemaining}, failed=${batch.failed}). ` +
        `These venues likely have ungeocodable coordinates or Nominatim is failing; the loop will now exit.`
      );
      break;
    }
  }

  await ctx.updateProgress({
    phase: 'categorize',
    message: `Geocoding done (${totalGeoUpdated} venues). Starting categorization...`,
    updated: totalGeoUpdated,
  });

  // Phase 2: Categorize (batched until no uncategorized venues remain)
  let totalCatUpdated = 0;
  const catRemainingInit = await query(
    `SELECT COUNT(*)::int AS count FROM venues WHERE category_id IS NULL`
  );
  let catRemaining = catRemainingInit.rows[0].count;
  while (catRemaining > 0) {
    if (ctx.isCancelled()) throw new Error('cancelled');
    const batch = await categorizeBatch(ctx.jobId, catRemaining, totalCatUpdated);
    totalCatUpdated += batch.updated;
    catRemaining = batch.remaining;
    await ctx.updateProgress({
      phase: 'categorize',
      message: `Categorized ${totalCatUpdated} venues...`,
      updated: totalCatUpdated,
      remaining: catRemaining,
    });
    if (batch.updated === 0) break;
  }

  await ctx.updateProgress({
    phase: 'done',
    message: `Complete. Geocoded ${totalGeoUpdated} venues, categorized ${totalCatUpdated} venues.`,
    geocoded: totalGeoUpdated,
    categorized: totalCatUpdated,
  });
}

// ---------------------------------------------------------------------------
// Plugin server half
// ---------------------------------------------------------------------------

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: [
    { mount: '/location-checkins', router },
    { mount: '/venues', router: venuesRouter },
    { mount: '/search', router: searchRouter },
    { mount: '/import/swarm', router: swarmImportRouter },
  ],

  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'location'`,
        id: 'c.id',
        user_id: 'c.user_id',
        venue_id: 'c.venue_id',
        notes: 'c.notes',
        checked_in_at: 'c.checked_in_at',
        created_at: 'c.created_at',
        venue_name: 'v.name',
        venue_latitude: 'v.latitude',
        venue_longitude: 'v.longitude',
        venue_timezone: 'c.checkin_timezone',
        venue_category: 'vc.name',
        parent_venue_id: 'pv.id',
        parent_venue_name: 'pv.name',
        data: `json_build_object(
          'venue_id', c.venue_id,
          'notes', c.notes,
          'rating', c.rating,
          'companions', (
            SELECT COALESCE(json_agg(cc.name ORDER BY cc.name), '[]'::json)
            FROM checkin_companions cc
            WHERE cc.checkin_id = c.id
          )
        )::jsonb`,
        timezone: 'c.checkin_timezone',
      })}
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      LEFT JOIN venues pv ON v.parent_venue_id = pv.id
    `,
    // Legacy rows may lack checkin_timezone; fill it from the venue
    // coordinates (the pre-plugin core did this in JS after the query).
    postProcess: (rows: unknown[]) => {
      for (const row of rows as any[]) {
        if (!row.venue_timezone && row.venue_latitude != null && row.venue_longitude != null) {
          row.venue_timezone = getVenueTimezone(row.venue_latitude, row.venue_longitude);
        } else {
          row.venue_timezone = row.venue_timezone || null;
        }
      }
      return rows;
    },
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'c',
      timestampColumn: 'checked_in_at',
      timezoneColumn: 'checkin_timezone',
      search: (c, q) => c.push(
        `(c.search_vector @@ plainto_tsquery('english', ?) OR v.search_vector @@ plainto_tsquery('english', ?))`,
        q,
        q,
      ),
    });
    if (ctx.filterParams.venue_id) conds.push('c.venue_id = ?', ctx.filterParams.venue_id);
    if (ctx.filterParams.category) conds.push('vc.name = ?', ctx.filterParams.category);
    if (ctx.filterParams.country) conds.push('v.country = ?', ctx.filterParams.country);
    return conds.build();
  },

  // ------------------------------------------------------------------
  // Backup / restore / start-over
  // ------------------------------------------------------------------

  // Old backups stored location data under the top-level checkins / venues /
  // venueCategories keys; new backups carry a plugins.location payload.
  legacyBackupKeys: ['checkins', 'venues', 'venueCategories'],

  /**
   * Serialize this user's location data for backup. The payload carries
   * check-ins plus the venue + category tables they depend on (with the
   * parent FKs handled on import).
   */
  backupExport: async ({ user_id }) => {
    const [checkinsResult, venuesResult, categoriesResult,
          companionsResult, venueListsResult, venueListItemsResult] = await Promise.all([
      query(
        `SELECT id, venue_id, notes, rating,
                checked_in_at, checkin_timezone, created_at, updated_at, swarm_id
         FROM checkins
         WHERE user_id = $1
         ORDER BY checked_in_at ASC`,
        [user_id],
      ),
      query(
        `SELECT DISTINCT v.id, v.name, v.category_id, v.rating,
                v.address, v.city, v.state, v.country, v.postal_code,
                v.latitude, v.longitude,
                v.osm_id, v.swarm_venue_id,
                v.parent_venue_id, v.created_by,
                v.created_at, v.updated_at
         FROM venues v
         ORDER BY v.created_at ASC`,
        [],
      ),
      query(
        `SELECT DISTINCT vc.id, vc.name, vc.icon, vc.parent_id, vc.created_at
         FROM venue_categories vc
         JOIN venues v ON v.category_id = vc.id
         ORDER BY vc.name ASC`,
        [],
      ),
      query(
        `SELECT cc.checkin_id, cc.name
         FROM checkin_companions cc
         JOIN checkins c ON c.id = cc.checkin_id
         WHERE c.user_id = $1
         ORDER BY cc.checkin_id, cc.name`,
        [user_id],
      ),
      query(
        `SELECT id, name, created_at, updated_at
         FROM venue_lists WHERE user_id = $1 ORDER BY created_at`,
        [user_id],
      ),
      query(
        `SELECT vli.list_id, vli.venue_id, vli.position, vli.added_at
         FROM venue_list_items vli
         JOIN venue_lists vl ON vl.id = vli.list_id
         WHERE vl.user_id = $1
         ORDER BY vl.created_at, vli.position`,
        [user_id],
      ),
    ]);
    return {
      checkins: checkinsResult.rows,
      venues: venuesResult.rows,
      venueCategories: categoriesResult.rows,
      checkinCompanions: companionsResult.rows,
      venueLists: venueListsResult.rows,
      venueListItems: venueListItemsResult.rows,
    };
  },

  /**
   * Restore location data from backupExport (or restoreLegacyBackup's
   * normalized shape). FK order: categories (parent later) -> venues
   * (parent later) -> check-ins.
   */
  backupImport: async ({ user_id, client: txClient }, payload) => {
    const data = (payload ?? {}) as {
      checkins?: Record<string, unknown>[];
      venues?: Record<string, unknown>[];
      venueCategories?: Record<string, unknown>[];
      checkinCompanions?: Record<string, unknown>[];
      venueLists?: Record<string, unknown>[];
      venueListItems?: Record<string, unknown>[];
    };
    const categories = Array.isArray(data.venueCategories) ? data.venueCategories : [];
    const venues = Array.isArray(data.venues) ? data.venues : [];
    const checkins = Array.isArray(data.checkins) ? data.checkins : [];
    const checkinCompanions = Array.isArray(data.checkinCompanions) ? data.checkinCompanions : [];
    const venueLists = Array.isArray(data.venueLists) ? data.venueLists : [];
    const venueListItems = Array.isArray(data.venueListItems) ? data.venueListItems : [];

    // Use the framework's transaction client when provided so restore stays
    // atomic; open our own connection only when running standalone.
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    try {
      // 1. Categories (parent_id deferred; ON CONFLICT (name) keeps a stable
      //    id map so venue category_id references can be remapped).
      const categoryIdMap = new Map<string, string>();
      for (const category of categories) {
        if (!category?.name) continue;
        const result = await client.query(
          `INSERT INTO venue_categories (id, name, icon, parent_id, created_at)
           VALUES ($1, $2, $3, NULL, COALESCE($4::timestamptz, NOW()))
           ON CONFLICT (name) DO UPDATE SET
             icon = COALESCE(EXCLUDED.icon, venue_categories.icon)
           RETURNING id`,
          [category.id, category.name, category.icon || null, category.created_at || null]
        );
        categoryIdMap.set(String(category.id), result.rows[0].id);
      }
      for (const category of categories) {
        const localCategoryId = categoryIdMap.get(String(category.id));
        const localParentId = category.parent_id ? categoryIdMap.get(String(category.parent_id)) : null;
        if (!localCategoryId || !localParentId || localCategoryId === localParentId) continue;
        await client.query(
          `UPDATE venue_categories SET parent_id = $2 WHERE id = $1`,
          [localCategoryId, localParentId]
        );
      }

      // 2. Venues (category_id remapped, parent_venue_id deferred).
      for (const venue of venues) {
        if (!venue?.id || !venue.name) continue;
        await client.query(
          `INSERT INTO venues (
             id, name, category_id, rating,
             address, city, state, country, postal_code,
             latitude, longitude,
             osm_id, swarm_venue_id,
             parent_venue_id, created_by,
             created_at, updated_at
           )
           VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8, $9,
             $10, $11,
             $12, $13,
             NULL, $14,
             COALESCE($15::timestamptz, NOW()), COALESCE($16::timestamptz, NOW())
           )
           ON CONFLICT (id) DO NOTHING`,
          [
            venue.id,
            venue.name,
            venue.category_id ? (categoryIdMap.get(String(venue.category_id)) ?? null) : null,
            normalizeRating(venue.rating),
            venue.address || null,
            venue.city || null,
            venue.state || null,
            venue.country || null,
            venue.postal_code || null,
            Number(venue.latitude ?? 0),
            Number(venue.longitude ?? 0),
            venue.osm_id || null,
            venue.swarm_venue_id || null,
            user_id,
            venue.created_at || null,
            venue.updated_at || null,
          ]
        );
      }
      for (const venue of venues) {
        if (!venue.parent_venue_id) continue;
        await client.query(
          `UPDATE venues SET parent_venue_id = $2 WHERE id = $1`,
          [venue.id, venue.parent_venue_id]
        );
      }

      // 3. Check-ins.
      let inserted = 0;
      for (const row of checkins) {
        if (!row?.id || !row.venue_id) continue;
        const result = await client.query(
          `INSERT INTO checkins (
             id, user_id, venue_id,
             notes, rating,
             checked_in_at, checkin_timezone, created_at, updated_at,
             swarm_id
           )
           VALUES (
             $1, $2, $3,
             $4, $5,
             COALESCE($6::timestamptz, NOW()), $7,
             COALESCE($8::timestamptz, NOW()),
             COALESCE($9::timestamptz, NOW()),
             $10
           )
           ON CONFLICT (id) DO NOTHING`,
          [
            row.id,
            user_id,
            row.venue_id,
            row.notes || null,
            normalizeRating(row.rating),
            row.checked_in_at || null,
            row.checkin_timezone || null,
            row.created_at || null,
            row.updated_at || null,
            row.swarm_id || null,
          ]
        );
        if ((result.rowCount ?? 0) > 0) inserted++;
      }

      // 4. Companions (referencing the user's check-ins; skip missing ones).
      const checkinIds = new Set(checkins.map((r) => String(r?.id)).filter(Boolean));
      for (const cc of checkinCompanions) {
        if (!cc?.checkin_id || !cc?.name) continue;
        if (!checkinIds.has(String(cc.checkin_id))) continue;
        await client.query(
          `INSERT INTO checkin_companions (checkin_id, name)
           VALUES ($1, $2)
           ON CONFLICT (checkin_id, name) DO NOTHING`,
          [cc.checkin_id, String(cc.name)]
        );
      }

      // 5. Venue lists (payload ids are preserved by the insert, so list-item
      //    references use them directly).
      for (const list of venueLists) {
        if (!list?.id || !list?.name) continue;
        await client.query(
          `INSERT INTO venue_lists (id, user_id, name, created_at, updated_at)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
           ON CONFLICT (id) DO NOTHING`,
          [list.id, user_id, list.name, list.created_at || null, list.updated_at || null]
        );
      }
      for (const li of venueListItems) {
        if (!li?.list_id || !li?.venue_id) continue;
        await client.query(
          `INSERT INTO venue_list_items (list_id, venue_id, position, added_at)
           VALUES ($1, $2, COALESCE($3::int, 0), COALESCE($4::timestamptz, NOW()))
           ON CONFLICT (list_id, venue_id) DO NOTHING`,
          [li.list_id, li.venue_id, li.position ?? 0, li.added_at || null]
        );
      }

      return inserted;
    } finally {
      if (ownsClient) client.release();
    }
  },

  /**
   * Legacy backup restore (backups without a `plugins.location` payload keep
   * location rows under the top-level checkins / venues / venueCategories
   * keys). Normalizes the raw rows into the backupImport shape and reuses it.
   */
  restoreLegacyBackup: async (ctx, data) => {
    const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    const payload = {
      checkins: asArray<Record<string, unknown>>(data.checkins),
      venues: asArray<Record<string, unknown>>(data.venues),
      venueCategories: asArray<Record<string, unknown>>(data.venueCategories),
      checkinCompanions: asArray<Record<string, unknown>>(data.checkinCompanions),
      venueLists: asArray<Record<string, unknown>>(data.venueLists),
      venueListItems: asArray<Record<string, unknown>>(data.venueListItems),
    };

    // backupImport handles the full FK-ordered insert and returns the number
    // of check-ins inserted; legacy counts are reported per top-level key.
    const insertedCheckins = await server.backupImport!(ctx, payload);

    const categoryCount = asArray<Record<string, unknown>>(data.venueCategories).length;
    const venueCount = asArray<Record<string, unknown>>(data.venues).length;
    const checkinCount = asArray<Record<string, unknown>>(data.checkins).length;

    return {
      venueCategories: { inserted: categoryCount, skipped: 0 },
      venues: { inserted: venueCount, skipped: 0 },
      checkins: { inserted: insertedCheckins, skipped: Math.max(0, checkinCount - insertedCheckins) },
    };
  },

  /**
   * Start-over: delete the user's location check-ins. Scrobbles attached to
   * those check-ins go first (they reference checkins); venues and
   * venue_categories are shared reference data and are kept.
   */
  deleteUserData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);

    // Detach scrobbles (core-owned table) that point at this user's check-ins.
    await run(
      `DELETE FROM checkin_scrobbles
       WHERE checkin_id IN (SELECT id FROM checkins WHERE user_id = $1)`,
      [user_id]
    );

    // Companions cascade on check-in delete; removed explicitly for clarity.
    await run(
      `DELETE FROM checkin_companions
       WHERE checkin_id IN (SELECT id FROM checkins WHERE user_id = $1)`,
      [user_id]
    );

    const result = await run(
      'DELETE FROM checkins WHERE user_id = $1 RETURNING id',
      [user_id]
    );

    // The user's venue lists (memberships cascade). Venues themselves are
    // shared reference data and are kept.
    await run('DELETE FROM venue_lists WHERE user_id = $1', [user_id]);

    return result.rowCount ?? 0;
  },

  /**
   * Start-over: delete the entire venues catalog. The start-over route only
   * invokes this after the user's location check-ins have been deleted (the
   * all-data option always implies the check-in deletion), so no check-in
   * FKs remain. venue_list_items cascade from their lists/venues; the user's
   * own lists are already gone via deleteUserData, but any other
   * memberships are cleaned up explicitly.
   */
  deleteAllData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);

    let deleted = 0;
    for (const sql of [
      'DELETE FROM venue_list_items WHERE list_id IN (SELECT id FROM venue_lists WHERE user_id = $1)',
      'DELETE FROM venue_lists WHERE user_id = $1',
    ]) {
      const result = await run(sql, [user_id]);
      deleted += result.rowCount ?? 0;
    }

    for (const sql of [
      'DELETE FROM venue_merge_suggestions',
      'DELETE FROM venues',
      'DELETE FROM venue_categories',
    ]) {
      const result = await run(sql, []);
      deleted += result.rowCount ?? 0;
    }

    return deleted;
  },

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo/scrobble anchor timestamps for Immich and Maloja enrichment.
  resolveTimestamps: () => ({
    sql: 'SELECT id, checked_in_at FROM checkins WHERE id = ANY($1::uuid[])',
  }),

  // Timezone inference for integrations (Plex webhook): the timezone of the
  // most recent location check-in at or before the reference time.
  latestTimezoneAsOf: () => ({
    sql: `SELECT checkin_timezone AS timezone
         FROM checkins
         WHERE user_id = $2
           AND checkin_timezone IS NOT NULL
           AND checked_in_at <= $1
         ORDER BY checked_in_at DESC
         LIMIT 1`,
  }),

  // "This day in previous years" reflection branch.
  reflectionBranch: () => ({
    sql: `
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
        json_build_object(
          'venue_id', c.venue_id,
          'notes', c.notes
        )::jsonb AS data
      FROM checkins c
      JOIN venues v ON c.venue_id = v.id
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      WHERE c.user_id = $1
        AND TO_CHAR(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // Earliest check-in date for the "all time" period selector.
  earliestDate: () => ({
    sql: `SELECT MIN(DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')))::text AS date
          FROM checkins WHERE user_id = $1`,
  }),

  // LLM life summary contribution.
  llm: {
    label: 'location check-ins',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT c.checked_in_at, c.checkin_timezone AS timezone,
                json_build_object(
                  'venue_name', v.name,
                  'venue_category', vc.name,
                  'city', v.city,
                  'country', v.country,
                  'note', c.notes
                )::jsonb AS data
         FROM checkins c
         JOIN venues v ON c.venue_id = v.id
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         WHERE c.user_id = $1
           AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= $2::date
           AND (c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= $3::date
         ORDER BY c.checked_in_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row) => {
      const d = row.data as {
        venue_name: string | null;
        venue_category: string | null;
        city: string | null;
        country: string | null;
        note: string | null;
      };
      const where = [d.venue_name, d.venue_category, [d.city, d.country].filter(Boolean).join(', ')]
        .filter(Boolean)
        .join(' / ');
      const note = d.note ? ` — note: "${d.note}"` : '';

      const formatWhen = (iso: string | Date, timezone: string | null): string => {
        const opts: Intl.DateTimeFormatOptions = {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        };
        return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
      };

      return [`- ${formatWhen(row.checked_in_at, row.timezone)} — location check-in at ${where}${note}`];
    },
  },

  // Timestamp reconciliation participation.
  //
  // Location check-ins are timezone-inferable from their venue's coordinates,
  // so they generate their OWN suggestions via `suggest` (resolving lat/lng
  // to an IANA zone) instead of using the framework's anchor-based pass.
  // Their geo-resolved timezone is also exposed via `anchorTimezone` so other
  // check-in types can anchor to a location row's *true* timezone (not the
  // possibly-wrong stored label).
  reconcile: {
    anchorLabel: 'location check-in',
    scanAll: true,
    detailPath: (id) => `/location-checkins/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT c.id, c.checked_in_at, c.checkin_timezone AS original_timezone,
                v.latitude, v.longitude
         FROM checkins c
         JOIN venues v ON v.id = c.venue_id
         WHERE c.user_id = $1
         ORDER BY c.checked_in_at ASC`,
        [user_id],
      );
      return result.rows;
    },
    anchorTimezone: (row) => getVenueTimezone(row.latitude ?? null, row.longitude ?? null),
    suggest: async (_user_id, rows) => {
      const suggestions: PluginReconciliationSuggestion[] = [];
      const uninferable: PluginReconciliationUninferable[] = [];
      for (const row of rows) {
        const suggestedTimezone = getVenueTimezone(row.latitude ?? null, row.longitude ?? null);
        if (!suggestedTimezone) {
          uninferable.push({
            id: row.id,
            reason: 'The check-in has no venue coordinates to resolve a timezone from.',
          });
          continue;
        }
        if (suggestedTimezone === normalizeEtcGmt(row.original_timezone || '')) {
          continue;
        }
        suggestions.push({
          id: row.id,
          suggested_timezone: suggestedTimezone,
          reason: row.original_timezone
            ? `Check-in location resolves to ${suggestedTimezone}, not ${row.original_timezone}.`
            : `Check-in location resolves to ${suggestedTimezone}.`,
        });
      }
      return { suggestions, uninferable };
    },
    apply: async (id, suggested_timezone) => {
      if (!isValidTimeZone(suggested_timezone)) return false;
      const result = await query(
        `UPDATE checkins
         SET checkin_timezone = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, suggested_timezone],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },

  // Background jobs: the "Backfill Venues" job (geocode + categorize). The
  // jobType string is stable — the client calls jobs.start('backfill').
  jobs: [
    {
      jobType: 'backfill',
      handler: async (ctx) => {
        await venueBackfillHandler(ctx);
      },
    },
  ],
};
