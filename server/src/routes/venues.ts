import { Router, Request, Response } from 'express';
import { query } from '../db';
import { searchNearbyVenues, findEnclosingVenue } from '../services/overpass';
import { reverseGeocode } from '../services/nominatim';
import { findOrReuseVenue } from '../services/venueMerge';

const router = Router();

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serializeVenue<T extends Record<string, unknown>>(venue: T): T {
  return {
    ...venue,
    latitude: toNumberOrNull(venue.latitude),
    longitude: toNumberOrNull(venue.longitude),
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

// GET / - list venues with optional search, category filter, pagination
router.get('/', async (req: Request, res: Response) => {
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
             v.latitude, v.longitude, v.osm_id, v.created_at, v.updated_at,
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
router.get('/nearby', async (req: Request, res: Response) => {
  try {
    const { lat, lon, radius = '2000', limit = '20', offset = '0' } = req.query;
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
router.get('/categories', async (_req: Request, res: Response) => {
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

// GET /:id - get single venue with check-in count
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

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
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name, category_id, address, city, state, country,
      postal_code, latitude, longitude, osm_id,
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

    res.status(201).json(venue);
  } catch (err) {
    console.error('Error creating venue:', err);
    res.status(500).json({ error: 'Failed to create venue' });
  }
});

// PUT /:id - update venue metadata
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name, category_id, address, city, state, country,
      postal_code, latitude, longitude, osm_id,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    const result = await query(
      `UPDATE venues
       SET name         = $2,
           category_id  = $3,
           address      = $4,
           city         = $5,
           state        = $6,
           country      = $7,
           postal_code  = $8,
           latitude     = $9,
           longitude    = $10,
           osm_id       = COALESCE($11, osm_id),
           updated_at   = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, name, category_id || null, address || null, city || null, state || null,
       country || null, postal_code || null,
       parseFloat(String(latitude)), parseFloat(String(longitude)), osm_id || null]
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

// POST /:id/merge-into - merge this venue into another, moving all check-ins to the target
router.post('/:id/merge-into', async (req: Request, res: Response) => {
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
router.post('/import-osm', async (req: Request, res: Response) => {
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
    }) as any;

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
            [parentVenue.id, childVenue.id]
          );
          childVenue.parent_venue_id = parentVenue.id;
          childVenue.parent_venue_name = parentVenue.name;
        }
      } catch (parentErr) {
        // Non-fatal — venue was created, just no parent link
        console.error('Parent venue lookup failed (non-fatal):', parentErr);
      }
    }

    res.status(201).json(childVenue);
  } catch (err) {
    console.error('Error importing OSM venue:', err);
    res.status(500).json({ error: 'Failed to import OSM venue' });
  }
});

// POST /geocode - reverse geocode venues missing country data
router.post('/geocode', async (_req: Request, res: Response) => {
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
router.post('/categorize', async (_req: Request, res: Response) => {
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

export const venuesRouter = router;
