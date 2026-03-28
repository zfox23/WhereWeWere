import { query } from '../db';
import { reverseGeocode } from './nominatim';
import { searchNearbyVenues } from './overpass';

export interface JobProgress {
  phase?: string;
  updated?: number;
  remaining?: number;
  message?: string;
}

async function updateJobProgress(jobId: string, progress: JobProgress) {
  await query(
    `UPDATE jobs SET progress = $1 WHERE id = $2`,
    [JSON.stringify(progress), jobId]
  );
}

async function geocodeBatch(): Promise<{ updated: number; remaining: number }> {
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

  return { updated, remaining: remaining.rows[0].count };
}

async function categorizeBatch(): Promise<{ updated: number; remaining: number }> {
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
    } catch (venueErr) {
      console.error(`Failed to categorize venue ${venue.id}:`, venueErr);
    }
  }

  const remaining = await query(
    'SELECT COUNT(*)::int AS count FROM venues WHERE category_id IS NULL'
  );

  return { updated, remaining: remaining.rows[0].count };
}

export async function runBackfillJob(jobId: string): Promise<void> {
  try {
    await query(
      `UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );

    // Phase 1: Geocode
    let totalGeoUpdated = 0;
    let geoRemaining = Infinity;
    while (geoRemaining > 0) {
      const batch = await geocodeBatch();
      totalGeoUpdated += batch.updated;
      geoRemaining = batch.remaining;
      if (batch.updated === 0) break;
      await updateJobProgress(jobId, {
        phase: 'geocoding',
        updated: totalGeoUpdated,
        remaining: geoRemaining,
        message: `Geocoding: ${totalGeoUpdated} updated, ${geoRemaining} remaining`,
      });
    }

    // Phase 2: Categorize
    let totalCatUpdated = 0;
    let catRemaining = Infinity;
    while (catRemaining > 0) {
      const batch = await categorizeBatch();
      totalCatUpdated += batch.updated;
      catRemaining = batch.remaining;
      if (batch.updated === 0) break;
      await updateJobProgress(jobId, {
        phase: 'categorizing',
        updated: totalCatUpdated,
        remaining: catRemaining,
        message: `Categorizing: ${totalCatUpdated} updated, ${catRemaining} remaining`,
      });
    }

    await query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(), progress = $1 WHERE id = $2`,
      [JSON.stringify({
        phase: 'done',
        message: `Complete. Geocoded ${totalGeoUpdated} venues, categorized ${totalCatUpdated} venues.`,
        geocoded: totalGeoUpdated,
        categorized: totalCatUpdated,
      }), jobId]
    );
  } catch (err: any) {
    console.error(`Job ${jobId} failed:`, err);
    await query(
      `UPDATE jobs SET status = 'failed', completed_at = NOW(), error = $1 WHERE id = $2`,
      [err.message || String(err), jobId]
    );
  }
}
