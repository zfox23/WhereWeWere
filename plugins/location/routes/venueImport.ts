/**
 * /venues maintenance routes: OSM import (with background enrichment) and the
 * synchronous bulk geocode / categorize actions. Mounted by the venues router.
 */

import { Router, Request, Response } from 'express';
import { query } from '../../../server/src/db';
import { reverseGeocode } from '../services/nominatim';
import { findEnclosingVenue } from '../services/overpass';
import { searchNearbyVenues } from '../services/photonVenues';
import { findOrReuseVenue } from '../services/venueMerge';
import { geocodeVenueLocationIfMissing, serializeVenue, toNumberOrNull, type GeocodableVenue } from './helpers';

export const venueImportRouter = Router();

/**
 * Background enrichment for an imported OSM venue: reverse-geocode to fill in
 * missing country/state/city, and link the venue to an enclosing parent venue
 * (e.g. the airport that contains a terminal).
 *
 * Both steps hit slow external services (Nominatim and Overpass) that can each
 * take tens of seconds when a mirror is loaded or hung. They are purely
 * cosmetic for the check-in flow, so we run them after the response is sent
 * rather than blocking the client on them. The caller is expected to invoke
 * this fire-and-forget; failures are logged and never surface to the user.
 */
async function enrichImportedVenue(
  venue: GeocodableVenue & { id: string },
  osmId: string,
): Promise<void> {
  const latNum = toNumberOrNull(venue.latitude);
  const lngNum = toNumberOrNull(venue.longitude);

  // Reverse-geocode to fill in any missing country/state/city.
  await geocodeVenueLocationIfMissing(venue).catch((err) => {
    console.error('Background geocode failed (non-fatal):', err);
  });

  // Link to an enclosing parent venue (e.g. the airport containing a terminal).
  if (latNum != null && lngNum != null) {
    try {
      const enclosing = await findEnclosingVenue(latNum, lngNum, osmId);
      if (!enclosing) return;

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

      await query(
        'UPDATE venues SET parent_venue_id = $1 WHERE id = $2 AND parent_venue_id IS NULL',
        [parentVenue.id, venue.id]
      );
    } catch (parentErr) {
      // Non-fatal — venue was created, just no parent link
      console.error('Parent venue lookup failed (non-fatal):', parentErr);
    }
  }
}

// POST /import-osm - import a venue from OSM data
venueImportRouter.post('/import-osm', async (req: Request, res: Response) => {
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

    // The venue is now safely in the local DB. Respond immediately so the
    // client can proceed to the check-in form, and kick off the slow external
    // enrichment (reverse geocoding + enclosing-venue parent link) in the
    // background. These can each take tens of seconds on a loaded/hung
    // Overpass or Nominatim mirror; blocking the response on them is what made
    // the check-in row spin forever and eventually surface a "NetworkError".
    void enrichImportedVenue(childVenue, osm_id);

    res.status(201).json(serializeVenue(childVenue));
  } catch (err) {
    console.error('Error importing OSM venue:', err);
    res.status(500).json({ error: 'Failed to import OSM venue' });
  }
});

// POST /geocode - reverse geocode venues missing country data
venueImportRouter.post('/geocode', async (_req: Request, res: Response) => {
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

// POST /categorize - categorize uncategorized venues using OSM data (Photon)
venueImportRouter.post('/categorize', async (_req: Request, res: Response) => {
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
