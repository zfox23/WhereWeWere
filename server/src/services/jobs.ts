import { query } from '../db';
import { reverseGeocode } from './nominatim';
import { searchNearbyVenues } from './overpass';

// In-memory cancellation signals — checked between batches
const cancelledJobs = new Set<string>();

// Run at startup: any pending/running job in the DB was started by a previous
// process whose in-memory runner no longer exists — mark them failed so they
// don't show as stuck "running" and block new jobs of the same type.
export async function cleanupStaleJobs() {
  try {
    const result = await query(
      `SELECT id, type, status, started_at FROM jobs WHERE status IN ('pending', 'running')`
    );
    if (result.rows.length > 0) {
      console.warn(
        `[jobs] found ${result.rows.length} stale job(s) from a previous server run — marking them failed:`
      );
      for (const row of result.rows) {
        console.warn(
          `[jobs]   stale job ${row.id} type=${row.type} status=${row.status} started_at=${row.started_at}`
        );
        await query(
          `UPDATE jobs SET status = 'failed', completed_at = NOW(),
             error = 'Server restarted while this job was running; the job was interrupted.'
           WHERE id = $1`,
          [row.id]
        );
      }
    } else {
      console.log('[jobs] no stale pending/running jobs found at startup');
    }
  } catch (err) {
    console.warn('[jobs] failed to clean up stale jobs at startup:', err);
  }
}

// Job ids whose runner is alive in THIS process — used to detect stale DB rows
const localRunningJobs = new Set<string>();

export function isJobRunningLocally(jobId: string): boolean {
  return localRunningJobs.has(jobId);
}

export function requestJobCancellation(jobId: string) {
  cancelledJobs.add(jobId);
}

function isJobCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId);
}

function cleanupCancellation(jobId: string) {
  cancelledJobs.delete(jobId);
}

export interface JobProgress {
  phase?: string;
  updated?: number;
  remaining?: number;
  message?: string;
  [key: string]: unknown;
}

async function updateJobProgress(jobId: string, progress: JobProgress) {
  await query(
    `UPDATE jobs SET progress = $1 WHERE id = $2`,
    [JSON.stringify(progress), jobId]
  );
}

async function geocodeBatch(
  jobId: string,
  remainingBefore: number,
  totalUpdatedBefore: number
): Promise<{ updated: number; remaining: number; failed: number; failedIds: string[] }> {
  const result = await query(
    `SELECT id, latitude, longitude FROM venues
     WHERE country IS NULL OR TRIM(country) = ''
     LIMIT 50`
  );

  let updated = 0;
  let failed = 0;
  let processed = 0;
  const failedIds: string[] = [];
  for (const venue of result.rows) {
    if (isJobCancelled(jobId)) throw new Error('cancelled');
    const geo = await reverseGeocode(
      parseFloat(venue.latitude),
      parseFloat(venue.longitude)
    );
    if (!geo.country) {
      failed++;
      failedIds.push(venue.id);
    }
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
    processed++;
    // Per-venue progress so the UI never looks frozen for minutes
    const estRemaining = Math.max(0, remainingBefore - processed);
    await updateJobProgress(jobId, {
      phase: 'geocoding',
      updated: totalUpdatedBefore + updated,
      remaining: estRemaining,
      message: `Geocoding: ${totalUpdatedBefore + updated} updated, ~${estRemaining} remaining (venue ${processed}/${result.rows.length} in batch)`,
    });
  }

  console.log(`[jobs] backfill ${jobId} geocode batch done: updated=${updated} failed=${failed} failedIds=${failedIds.slice(0, 5).join(',') || '(none)'}`);

  const remaining = await query(
    `SELECT COUNT(*)::int AS count FROM venues WHERE country IS NULL OR TRIM(country) = ''`
  );

  return { updated, remaining: remaining.rows[0].count, failed, failedIds };
}

function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function categorizeBatch(
  jobId: string,
  remainingBefore: number,
  totalUpdatedBefore: number
): Promise<{ updated: number; remaining: number }> {
  const result = await query(
    `SELECT id, name, latitude, longitude FROM venues
     WHERE category_id IS NULL
     LIMIT 20`
  );

  let updated = 0;
  let processed = 0;
  for (const venue of result.rows) {
    if (isJobCancelled(jobId)) throw new Error('cancelled');
    try {
      const lat = parseFloat(venue.latitude);
      const lng = parseFloat(venue.longitude);

      // Search without name filter at a small radius to avoid regex injection
      // issues and find all nearby POIs for local matching
      const nearby = await searchNearbyVenues(lat, lng, undefined, 150);

      const venueNorm = normalizeForMatch(venue.name);

      // 1. Exact normalized match
      let match = nearby.find(
        (n) => normalizeForMatch(n.name) === venueNorm
      );

      // 2. Partial match (one contains the other)
      if (!match) {
        match = nearby.find((n) => {
          const nNorm = normalizeForMatch(n.name);
          return venueNorm.includes(nNorm) || nNorm.includes(venueNorm);
        });
      }

      // 3. If only one POI nearby, use it regardless of name
      if (!match && nearby.length === 1) {
        match = nearby[0];
      }

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

      // Small delay between Overpass requests to avoid rate limiting
      await new Promise((r) => setTimeout(r, 1100));
    } catch (venueErr) {
      console.error(`Failed to categorize venue ${venue.id}:`, venueErr);
    }
    processed++;
    // Per-venue progress so the UI never looks frozen for minutes
    const estRemaining = Math.max(0, remainingBefore - processed);
    await updateJobProgress(jobId, {
      phase: 'categorizing',
      updated: totalUpdatedBefore + updated,
      remaining: estRemaining,
      message: `Categorizing: ${totalUpdatedBefore + updated} updated, ~${estRemaining} remaining (venue ${processed}/${result.rows.length} in batch)`,
    });
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
    localRunningJobs.add(jobId);
    console.log(`[jobs] backfill ${jobId} started (local runner live)`);

    // Phase 1: Geocode (progress is written per-venue inside geocodeBatch)
    let totalGeoUpdated = 0;
    const geoRemainingInit = await query(
      `SELECT COUNT(*)::int AS count FROM venues WHERE country IS NULL OR TRIM(country) = ''`
    );
    let geoRemaining = geoRemainingInit.rows[0].count;
    while (geoRemaining > 0) {
      if (isJobCancelled(jobId)) throw new Error('cancelled');
      const batch = await geocodeBatch(jobId, geoRemaining, totalGeoUpdated);
      totalGeoUpdated += batch.updated;
      geoRemaining = batch.remaining;
      if (batch.updated === 0) {
        console.warn(
          `[jobs] backfill ${jobId} geocode batch made NO progress (remaining=${geoRemaining}, failed=${batch.failed}). ` +
          `These venues likely have ungeocodable coordinates or Nominatim is failing; the loop will now exit.`
        );
        break;
      }
    }

    // Phase 2: Categorize (progress is written per-venue inside categorizeBatch)
    let totalCatUpdated = 0;
    const catRemainingInit = await query(
      `SELECT COUNT(*)::int AS count FROM venues WHERE category_id IS NULL`
    );
    let catRemaining = catRemainingInit.rows[0].count;
    while (catRemaining > 0) {
      if (isJobCancelled(jobId)) throw new Error('cancelled');
      const batch = await categorizeBatch(jobId, catRemaining, totalCatUpdated);
      totalCatUpdated += batch.updated;
      catRemaining = batch.remaining;
      if (batch.updated === 0) break;
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
    cleanupCancellation(jobId);
    localRunningJobs.delete(jobId);
    const isCancelled = err.message === 'cancelled';
    console.error(`Job ${jobId} ${isCancelled ? 'cancelled' : 'failed'}:`, isCancelled ? '' : err);
    await query(
      `UPDATE jobs SET status = $1, completed_at = NOW(), error = $2 WHERE id = $3`,
      [isCancelled ? 'cancelled' : 'failed', isCancelled ? 'Job was cancelled by user.' : (err.message || String(err)), jobId]
    );
  }
}
