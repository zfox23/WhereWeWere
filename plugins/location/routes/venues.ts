/** /venues — the shared venue catalog: search, nearby, library, CRUD, merge, Coasterpedia. */

import { Router, Request, Response } from 'express';
import { parseAttractionId } from '../services/coasterpedia';
import { enrichVenueCoasterpedia, getCoasterpediaApiKey, isAmusementRideCategory, needsLookup } from '../services/coasterpediaEnrich';
import { query, pool } from '../../../server/src/db';
import { isUuid } from '../../../server/src/services/batching';
import { likeText, orderBy, pageResult, parseLibraryParams } from '../../../server/src/services/libraryQuery';
import { currentUserId } from '../../../server/src/auth/context';
import { searchPlacesByName } from '../services/nominatim';
import { searchNearbyVenues } from '../services/photonVenues';
import { findOrReuseVenue } from '../services/venueMerge';
import { haversineMeters } from '../services/distance';
import { geocodeVenueLocationIfMissing, normalizeRating, serializeVenue, setVenueRating } from './helpers';
import { venueListsRouter } from './venueLists';
import { venueImportRouter } from './venueImport';

export const venuesRouter = Router();

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

    // Clamp: NaN/negative values would 500 in Postgres, and no cap loads everything.
    params.push(Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 500));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(Math.max(parseInt(offset as string, 10) || 0, 0));
    const offsetParam = `$${paramIndex}`;
    paramIndex++;

    // The rating is the caller's own (venue_ratings), not a venue attribute.
    params.push(currentUserId());
    const userParam = `$${paramIndex}`;

    const sql = `
      SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
             v.latitude, v.longitude, v.osm_id, vr.rating, v.created_at, v.updated_at,
             vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon
             ${rankSelect}
      FROM venues v
      LEFT JOIN venue_categories vc ON v.category_id = vc.id
      LEFT JOIN venue_ratings vr ON vr.venue_id = v.id AND vr.user_id = ${userParam}
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
    const parsedRadius = parseInt(radius as string, 10);
    // Non-numeric or non-positive radii fall back to the default; cap the top end
    // so a huge value can't scan everything or be forwarded to Overpass as-is.
    const radiusMeters = Number.isFinite(parsedRadius) && parsedRadius > 0
      ? Math.min(parsedRadius, 50000)
      : 5000;
    const limitNum = Math.min(Math.max(parseInt(limit as string, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset as string, 10) || 0, 0);
    const rawSource = typeof req.query.source === 'string' ? req.query.source : undefined;
    const source: 'local' | 'osm' | 'mixed' =
      rawSource === 'local' || rawSource === 'osm' ? rawSource : 'mixed';

    if (isNaN(latNum) || isNaN(lonNum)) {
      return res.status(400).json({ error: 'lat and lon must be valid numbers' });
    }

    // Search local DB using Haversine distance
    // The acos argument can land a hair above 1 for identical points (float
    // error), which Postgres rejects as out of range: clamp it.
    const haversineExpr = `(6371000 * acos(LEAST(1.0, GREATEST(-1.0,
               cos(radians($1)) * cos(radians(v.latitude)) *
               cos(radians(v.longitude) - radians($2)) +
               sin(radians($1)) * sin(radians(v.latitude))
             ))))`;
    // Bounding-box prefilter so the trig runs only on nearby rows and the
    // lat/lng index is usable. Longitude is skipped near the poles/antimeridian.
    const latDelta = radiusMeters / 111320;
    const cosLat = Math.cos((latNum * Math.PI) / 180);
    const lonDelta = cosLat > 0.01 ? radiusMeters / (111320 * cosLat) : 180;
    let bboxCondition = `AND v.latitude BETWEEN ${latNum - latDelta} AND ${latNum + latDelta}`;
    if (lonNum - lonDelta >= -180 && lonNum + lonDelta <= 180) {
      bboxCondition += ` AND v.longitude BETWEEN ${lonNum - lonDelta} AND ${lonNum + lonDelta}`;
    }
    const dbParams: unknown[] = [latNum, lonNum, radiusMeters];
    let searchCondition = '';
    if (search) {
      searchCondition = `AND v.search_vector @@ plainto_tsquery('english', $4)`;
      dbParams.push(search);
    }

    let localVenues: any[] = [];
    let localOsmIds = new Set<string>();

    if (source === 'osm') {
      // OSM-only: skip the full local query, but fetch local osm_ids so we can
      // still dedupe OSM results against venues already imported locally.
      const idSql = `
        SELECT DISTINCT v.osm_id
        FROM venues v
        WHERE v.osm_id IS NOT NULL
          ${bboxCondition}
          AND ${haversineExpr} <= $3
          ${searchCondition}
      `;
      const idResult = await query(idSql, dbParams);
      localOsmIds = new Set(idResult.rows.map((row: { osm_id: string }) => row.osm_id));
    } else {
      let dbSql = `
        SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
               v.latitude, v.longitude, v.osm_id, v.created_at, v.updated_at,
               vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
               ${haversineExpr} AS distance,
               'local' AS source
        FROM venues v
        LEFT JOIN venue_categories vc ON v.category_id = vc.id
        WHERE ${haversineExpr} <= $3
        ${bboxCondition}
        ${searchCondition}
        ORDER BY distance ASC
      `;
      if (source === 'local') {
        dbSql += ` LIMIT $${dbParams.length + 1} OFFSET $${dbParams.length + 2}`;
        dbParams.push(limitNum, offsetNum);
      }
      const dbResult = await query(dbSql, dbParams);
      localVenues = dbResult.rows.map((row) => serializeVenue(row));
      localOsmIds = new Set(
        localVenues.filter((v: { osm_id: string | null }) => v.osm_id).map((v: { osm_id: string }) => v.osm_id)
      );
    }

    // Also search OSM via Photon (skipped for source=local so that request stays fast)
    let osmVenues: Array<Record<string, unknown>> = [];
    if (source !== 'local') {
      try {
      const osmResults = await searchNearbyVenues(
        latNum,
        lonNum,
        search as string | undefined,
        radiusMeters
      );

      // Filter out OSM results that already exist in local DB by osm_id
      // (uses the outer localOsmIds, which is also populated for source=osm).
      osmVenues = osmResults
        .filter((r) => !localOsmIds.has(r.osm_id))
        .map((r) => ({
          ...r,
          source: 'osm',
        }));
      } catch (osmErr) {
        console.error('OSM venue search failed:', osmErr instanceof Error ? osmErr.message : osmErr);
        // An OSM-only request has nothing else to show: report the failure so
        // the client can say "OSM search unavailable" instead of "no venues".
        // Mixed requests still return their local results.
        if (source === 'osm') {
          return res.status(502).json({ error: 'OSM venue search is unavailable right now' });
        }
      }
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

    // Single-source pagination (source=local / source=osm)
    if (source !== 'mixed') {
      const list = (source === 'local' ? localWithDistance : osmWithDistance.slice(offsetNum, offsetNum + limitNum))
        .map(({ distance, ...venue }) => venue);
      return res.json(list);
    }

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

// The 1-segment /lists routes must be registered before /:id.
venuesRouter.use(venueListsRouter);

// ---------------------------------------------------------------------------
// GET /library?from=&to= - the "All Venues" library view: one row per venue
// with at least one check-in in range (all venues with check-ins when no range),
// including its rating, most recent check-in, check-in count, and list names.
// ---------------------------------------------------------------------------
const VENUE_LIBRARY_SORTS: Record<string, string> = {
  name: 'lower(g.name)',
  category: 'lower(g.category_name)',
  rating: 'g.rating',
  checkin_count: 'g.checkin_count',
  last_checkin: 'g.last_checkin_at',
};

// Also: q (name contains), category (category name contains), list (a venue list id),
// sort (name|category|rating|checkin_count|last_checkin), dir, limit (1-500, default 100)
// and offset. Responds { rows, total }, where total counts every match, not just this page.
venuesRouter.get('/library', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const includeUnchecked = !from && !to;
    const p = parseLibraryParams(req.query, { sorts: Object.keys(VENUE_LIBRARY_SORTS), defaultSort: 'last_checkin' });
    const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 200) : '';
    const listId = typeof req.query.list === 'string' && isUuid(req.query.list) ? req.query.list : null;

    const params: unknown[] = [currentUserId()];
    const conditions: string[] = [];
    if (from) {
      conditions.push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date >= $${params.length + 1}::date`);
      params.push(from);
    }
    if (to) {
      conditions.push(`(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))::date <= $${params.length + 1}::date`);
      params.push(to);
    }
    if (p.q) {
      params.push(likeText(p.q));
      conditions.push(`lower(v.name) LIKE '%' || $${params.length} || '%' ESCAPE '\\'`);
    }
    if (category) {
      params.push(likeText(category));
      conditions.push(`lower(vc.name) LIKE '%' || $${params.length} || '%' ESCAPE '\\'`);
    }
    if (listId) {
      params.push(listId);
      conditions.push(
        `EXISTS (SELECT 1 FROM venue_list_items vli JOIN venue_lists vl ON vl.id = vli.list_id
                 WHERE vli.venue_id = v.id AND vli.list_id = $${params.length} AND vl.user_id = $1)`
      );
    }
    const join = includeUnchecked
      ? `LEFT JOIN checkins c ON c.venue_id = v.id AND c.user_id = $1`
      : `JOIN checkins c ON c.venue_id = v.id AND c.user_id = $1`;

    const paged = pageResult((await query(
      `SELECT g.*, COUNT(*) OVER()::int AS total
       FROM (
         SELECT v.id, v.name, v.address, v.city, v.state, v.country, vr.rating,
                vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
                (ARRAY_AGG(c.checked_in_at ORDER BY c.checked_in_at DESC, c.id DESC))[1] AS last_checkin_at,
                (ARRAY_AGG(c.checkin_timezone ORDER BY c.checked_in_at DESC, c.id DESC))[1] AS last_checkin_timezone,
                COUNT(c.id) FILTER (WHERE c.id IS NOT NULL)::int AS checkin_count
         FROM venues v
         ${join}
         LEFT JOIN venue_categories vc ON v.category_id = vc.id
         LEFT JOIN venue_ratings vr ON vr.venue_id = v.id AND vr.user_id = $1
         ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
         GROUP BY v.id, vc.id, vc.name, vc.icon, vr.rating
         HAVING COUNT(c.id) > 0
       ) g
       ORDER BY ${orderBy(VENUE_LIBRARY_SORTS, p.sort, p.dir, 'g.last_checkin_at DESC NULLS LAST, lower(g.name)')}
       LIMIT ${p.limit} OFFSET ${p.offset}`,
      params
    )).rows);
    const result = { rows: paged.rows };

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
        [currentUserId(), venueIds]
      );
      for (const row of listResult.rows) {
        const arr = listNamesByVenue.get(row.venue_id) || [];
        arr.push(row.name);
        listNamesByVenue.set(row.venue_id, arr);
      }
    }

    res.json({
      rows: result.rows.map((r: any) => serializeVenue({
        ...r,
        lists: listNamesByVenue.get(r.id) || [],
      })),
      total: paged.total,
    });
  } catch (err) {
    console.error('Error getting venue library:', err);
    res.status(500).json({ error: 'Failed to get venue library' });
  }
});

// GET /:id - get single venue with the caller's check-in count. The venue is
// shared catalog data; the count and Coasterpedia record are the caller's own.
venuesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = currentUserId();

    const result = await query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
              v.latitude, v.longitude, v.osm_id, v.parent_venue_id,
              (SELECT vr.rating FROM venue_ratings vr WHERE vr.venue_id = v.id AND vr.user_id = $2) AS rating,
              v.created_at, v.updated_at,
              vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon,
              pv.name AS parent_venue_name,
              COUNT(c.id)::int AS checkin_count
       FROM venues v
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       LEFT JOIN venues pv ON v.parent_venue_id = pv.id
       LEFT JOIN checkins c ON c.venue_id = v.id AND c.user_id = $2
       WHERE v.id = $1
       GROUP BY v.id, vc.id, pv.name`,
      [id, userId]
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

    // Coasterpedia data only applies to amusement rides.
    if (isAmusementRideCategory(venue.category_name)) {
      const cp = await query(
        `SELECT status, attraction_id, data, candidates, error, fetched_at
           FROM venue_coasterpedia WHERE venue_id = $1 AND user_id = $2`,
        [id, userId]
      );
      venue.coasterpedia = {
        has_key: (await getCoasterpediaApiKey(userId)) != null,
        ...(cp.rows[0] ?? { status: null }),
      };
    }

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

    // The rating is the caller's own, set after find/reuse so a reused venue
    // keeps the caller's existing rating unless they explicitly provide one.
    const userId = currentUserId();
    const venueRating = normalizeRating(rating);
    if (venueRating != null) {
      await setVenueRating(userId, venue.id, venueRating);
    }

    // Re-fetch to return a canonical row that includes the caller's rating.
    const finalResult = await query(
      `SELECT v.id, v.name, v.address, v.city, v.state, v.country, v.postal_code,
              v.latitude, v.longitude, v.osm_id, vr.rating, v.created_at, v.updated_at,
              vc.id AS category_id, vc.name AS category_name, vc.icon AS category_icon
       FROM venues v
       LEFT JOIN venue_categories vc ON v.category_id = vc.id
       LEFT JOIN venue_ratings vr ON vr.venue_id = v.id AND vr.user_id = $2
       WHERE v.id = $1`,
      [venue.id, userId]
    );
    const finalVenue = finalResult.rows.length > 0
      ? finalResult.rows[0]
      : { ...geocodedVenue, rating: venueRating };

    res.status(201).json(serializeVenue(finalVenue));

    // After the response: look the ride up on Coasterpedia (non-fatal).
    needsLookup(venue.id, userId)
      .then((due) => (due ? enrichVenueCoasterpedia(venue.id, userId) : undefined))
      .catch((err) => console.error('Coasterpedia lookup scheduling failed (non-fatal):', err));
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
    if (body.osm_id !== undefined) push('osm_id = $n', body.osm_id || null);

    // Explicit columns: created_by (who added the shared venue) stays private.
    // A rating-only save leaves the shared venue row untouched.
    const columns = `id, name, category_id, address, city, state, country, postal_code,
                 latitude, longitude, osm_id, swarm_venue_id, parent_venue_id,
                 created_at, updated_at`;
    const result = setClauses.length > 0
      ? await query(
          `UPDATE venues
           SET ${[...setClauses, 'updated_at = NOW()'].join(', ')}
           WHERE id = $1
           RETURNING ${columns}`,
          params
        )
      : await query(`SELECT ${columns} FROM venues WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    // The rating is the caller's own. Explicit key presence lets the client
    // clear it to unrated.
    const venueId = String(id);
    const userId = currentUserId();
    if (hasRating) {
      await setVenueRating(userId, venueId, normalizeRating(body.rating));
    }
    const ratingResult = await query(
      'SELECT rating FROM venue_ratings WHERE user_id = $1 AND venue_id = $2',
      [userId, venueId]
    );

    res.json(serializeVenue({ ...result.rows[0], rating: ratingResult.rows[0]?.rating ?? null }));

    // After the response: (re-)run the Coasterpedia lookup when due (non-fatal).
    needsLookup(venueId, userId)
      .then((due) => (due ? enrichVenueCoasterpedia(venueId, userId) : undefined))
      .catch((err) => console.error('Coasterpedia lookup scheduling failed (non-fatal):', err));
  } catch (err) {
    console.error('Error updating venue:', err);
    res.status(500).json({ error: 'Failed to update venue' });
  }
});

// POST /:id/coasterpedia/refresh - re-run the Coasterpedia lookup for a ride venue
venuesRouter.post('/:id/coasterpedia/refresh', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const venue = await query(
      `SELECT vc.name AS category_name FROM venues v
         LEFT JOIN venue_categories vc ON vc.id = v.category_id WHERE v.id = $1`,
      [id]
    );
    if (venue.rows.length === 0) return res.status(404).json({ error: 'Venue not found' });
    if (!isAmusementRideCategory(venue.rows[0].category_name)) {
      return res.status(400).json({ error: 'Venue is not an amusement ride' });
    }
    const userId = currentUserId();
    if (!(await getCoasterpediaApiKey(userId))) {
      return res.status(400).json({ error: 'Add a Coasterpedia API key in Settings > Location first' });
    }
    // Keep the matched record on refresh; otherwise search again.
    const current = await query(
      'SELECT attraction_id FROM venue_coasterpedia WHERE venue_id = $1 AND user_id = $2',
      [id, userId]
    );
    await enrichVenueCoasterpedia(String(id), userId, { attractionId: current.rows[0]?.attraction_id ?? undefined });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error refreshing Coasterpedia data:', err);
    res.status(500).json({ error: 'Failed to refresh Coasterpedia data' });
  }
});

// POST /:id/coasterpedia/select - pick a candidate, or enter a Coasterpedia ID/URL
venuesRouter.post('/:id/coasterpedia/select', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const raw = req.body?.attractionId ?? req.body?.url;
    const attractionId = parseAttractionId(String(raw ?? ''));
    if (attractionId == null) {
      return res.status(400).json({ error: 'Provide a Coasterpedia attraction ID or URL' });
    }
    const venue = await query(
      `SELECT vc.name AS category_name FROM venues v
         LEFT JOIN venue_categories vc ON vc.id = v.category_id WHERE v.id = $1`,
      [id]
    );
    if (venue.rows.length === 0) return res.status(404).json({ error: 'Venue not found' });
    if (!isAmusementRideCategory(venue.rows[0].category_name)) {
      return res.status(400).json({ error: 'Venue is not an amusement ride' });
    }
    const userId = currentUserId();
    if (!(await getCoasterpediaApiKey(userId))) {
      return res.status(400).json({ error: 'Add a Coasterpedia API key in Settings > Location first' });
    }
    await enrichVenueCoasterpedia(String(id), userId, { attractionId });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error selecting Coasterpedia attraction:', err);
    res.status(500).json({ error: 'Failed to select Coasterpedia attraction' });
  }
});

// DELETE /:id - delete a venue nobody uses. Venues are a shared catalog, so
// the check is across ALL users: a check-in or list entry of anyone's keeps
// it (the delete would cascade their list items away). The 409 for someone
// else's references doesn't say what they are.
venuesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const venueResult = await query(
      `SELECT v.id,
              (SELECT COUNT(*) FROM checkins c WHERE c.venue_id = v.id AND c.user_id = $2)::int AS own_checkin_count,
              (SELECT COUNT(*) FROM checkins c WHERE c.venue_id = v.id)::int AS checkin_count,
              (SELECT COUNT(*) FROM venue_list_items vli WHERE vli.venue_id = v.id)::int AS list_item_count,
              (SELECT COUNT(*) FROM venues child WHERE child.parent_venue_id = v.id)::int AS child_count
       FROM venues v
       WHERE v.id = $1`,
      [id, currentUserId()]
    );

    if (venueResult.rows.length === 0) {
      return res.status(404).json({ error: 'Venue not found' });
    }

    const venue = venueResult.rows[0];

    if (Number(venue.own_checkin_count) > 0) {
      return res.status(409).json({ error: 'Cannot delete a venue with check-ins' });
    }

    if (Number(venue.checkin_count) > 0 || Number(venue.list_item_count) > 0) {
      return res.status(409).json({ error: 'Cannot delete a venue that is in use' });
    }

    if (Number(venue.child_count) > 0) {
      return res.status(409).json({ error: 'Cannot delete a venue that has child venues' });
    }

    // The NOT EXISTS guards close the race with a check-in or list entry
    // added since the check above.
    const deleted = await query(
      `DELETE FROM venues v WHERE v.id = $1
         AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.venue_id = v.id)
         AND NOT EXISTS (SELECT 1 FROM venue_list_items vli WHERE vli.venue_id = v.id)
       RETURNING v.id`,
      [id]
    );
    if (deleted.rows.length === 0) {
      return res.status(409).json({ error: 'Cannot delete a venue that is in use' });
    }

    return res.json({ message: 'Venue deleted', id });
  } catch (err) {
    console.error('Error deleting venue:', err);
    return res.status(500).json({ error: 'Failed to delete venue' });
  }
});

// POST /:id/merge-into - merge this venue into another, moving all check-ins to the target.
// Venues are a shared catalog, so EVERY user's check-ins and list memberships
// move (none may be orphaned or cascade-deleted); the response's check-in
// count is the caller's own.
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

    // All-or-nothing: a failure midway must not leave check-ins moved but the
    // source half-deleted (or the hierarchy rewritten).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Move all check-ins from the source venue to the target
      await client.query('UPDATE checkins SET venue_id = $1 WHERE venue_id = $2', [target_id, id]);

      // Carry list memberships over (cascade-delete would silently drop them).
      // Rows are moved, not copied, so rank/position survive without tripping
      // the per-list unique rank index; lists that already hold the target
      // keep its row and the source's row cascades away with the venue.
      await client.query(
        `UPDATE venue_list_items
         SET venue_id = $1
         WHERE venue_id = $2
           AND list_id NOT IN (SELECT list_id FROM venue_list_items WHERE venue_id = $1)`,
        [target_id, id]
      );

      // Per user, carry the source's rating and Coasterpedia record over when
      // that user has none for the target (they'd cascade away with the
      // source otherwise); a user's existing target values win.
      await client.query(
        `UPDATE venue_ratings s SET venue_id = $1, updated_at = NOW()
         WHERE s.venue_id = $2
           AND NOT EXISTS (SELECT 1 FROM venue_ratings t WHERE t.venue_id = $1 AND t.user_id = s.user_id)`,
        [target_id, id]
      );
      await client.query(
        `UPDATE venue_coasterpedia s SET venue_id = $1
         WHERE s.venue_id = $2
           AND NOT EXISTS (SELECT 1 FROM venue_coasterpedia t WHERE t.venue_id = $1 AND t.user_id = s.user_id)`,
        [target_id, id]
      );

      // If the target was a child of the source, hoist it to the source's
      // parent first so re-parenting below can't make it its own parent.
      await client.query(
        `UPDATE venues
         SET parent_venue_id = (SELECT parent_venue_id FROM venues WHERE id = $2)
         WHERE id = $1 AND parent_venue_id = $2`,
        [target_id, id]
      );

      // Re-parent any child venues that pointed to the source
      await client.query(
        'UPDATE venues SET parent_venue_id = $1 WHERE parent_venue_id = $2 AND id <> $1',
        [target_id, id]
      );

      // Delete the source venue
      await client.query('DELETE FROM venues WHERE id = $1', [id]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

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
       LEFT JOIN checkins c ON c.venue_id = v.id AND c.user_id = $2
       WHERE v.id = $1
       GROUP BY v.id, vc.id, pv.name`,
      [target_id, currentUserId()]
    );

    res.json(serializeVenue(result.rows[0]));
  } catch (err) {
    console.error('Error merging venue:', err);
    res.status(500).json({ error: 'Failed to merge venue' });
  }
});

venuesRouter.use(venueImportRouter);
