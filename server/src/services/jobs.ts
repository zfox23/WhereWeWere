import { query } from '../db';
import { reverseGeocode } from './nominatim';
import { searchNearbyVenues } from './overpass';
import {
  countPendingVenueMergeSuggestions,
  findVenueMergeProposals,
  invalidateStaleVenueMergeSuggestions,
  storeVenueMergeProposal,
} from './venueMerge';

const USER_ID = '00000000-0000-0000-0000-000000000001';

// In-memory cancellation signals — checked between batches
const cancelledJobs = new Set<string>();

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

async function geocodeBatch(jobId: string): Promise<{ updated: number; remaining: number }> {
  const result = await query(
    `SELECT id, latitude, longitude FROM venues
     WHERE country IS NULL OR TRIM(country) = ''
     LIMIT 50`
  );

  let updated = 0;
  for (const venue of result.rows) {
    if (isJobCancelled(jobId)) throw new Error('cancelled');
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

function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function categorizeBatch(jobId: string): Promise<{ updated: number; remaining: number }> {
  const result = await query(
    `SELECT id, name, latitude, longitude FROM venues
     WHERE category_id IS NULL
     LIMIT 20`
  );

  let updated = 0;
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
  }

  const remaining = await query(
    'SELECT COUNT(*)::int AS count FROM venues WHERE category_id IS NULL'
  );

  return { updated, remaining: remaining.rows[0].count };
}

async function scanVenueMergeSuggestions(jobId: string): Promise<{
  scanned: number;
  proposalsFound: number;
  pendingSuggestions: number;
}> {
  const { scanned, proposals } = await findVenueMergeProposals();

  for (let index = 0; index < proposals.length; index += 1) {
    if (isJobCancelled(jobId)) {
      throw new Error('cancelled');
    }

    await storeVenueMergeProposal(jobId, proposals[index]);

    if ((index + 1) % 25 === 0 || index === proposals.length - 1) {
      await updateJobProgress(jobId, {
        phase: 'scanning',
        scanned,
        proposals_found: index + 1,
        remaining: Math.max(proposals.length - index - 1, 0),
        message: `Scanned ${scanned} venues and recorded ${index + 1} merge proposals`,
      });
    }
  }

  await invalidateStaleVenueMergeSuggestions(jobId);

  return {
    scanned,
    proposalsFound: proposals.length,
    pendingSuggestions: await countPendingVenueMergeSuggestions(),
  };
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
      if (isJobCancelled(jobId)) throw new Error('cancelled');
      const batch = await geocodeBatch(jobId);
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
      if (isJobCancelled(jobId)) throw new Error('cancelled');
      const batch = await categorizeBatch(jobId);
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
    cleanupCancellation(jobId);
    const isCancelled = err.message === 'cancelled';
    console.error(`Job ${jobId} ${isCancelled ? 'cancelled' : 'failed'}:`, isCancelled ? '' : err);
    await query(
      `UPDATE jobs SET status = $1, completed_at = NOW(), error = $2 WHERE id = $3`,
      [isCancelled ? 'cancelled' : 'failed', isCancelled ? 'Job was cancelled by user.' : (err.message || String(err)), jobId]
    );
  }
}

export async function runVenueMergeJob(jobId: string): Promise<void> {
  try {
    await query(
      `UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );

    const result = await scanVenueMergeSuggestions(jobId);

    await query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(), progress = $1 WHERE id = $2`,
      [JSON.stringify({
        phase: 'done',
        scanned: result.scanned,
        proposals_found: result.proposalsFound,
        pending_suggestions: result.pendingSuggestions,
        message: `Complete. Found ${result.proposalsFound} merge proposals. ${result.pendingSuggestions} pending review.`,
      }), jobId]
    );
  } catch (err: any) {
    cleanupCancellation(jobId);
    const isCancelled = err.message === 'cancelled';
    console.error(`Venue merge job ${jobId} ${isCancelled ? 'cancelled' : 'failed'}:`, isCancelled ? '' : err);
    await query(
      `UPDATE jobs SET status = $1, completed_at = NOW(), error = $2 WHERE id = $3`,
      [isCancelled ? 'cancelled' : 'failed', isCancelled ? 'Job was cancelled by user.' : (err.message || String(err)), jobId]
    );
  }
}

async function getDawarichSettings(): Promise<{ url: string; apiKey: string } | null> {
  const result = await query(
    `SELECT dawarich_url, dawarich_api_key FROM user_settings WHERE user_id = $1`,
    [USER_ID]
  );
  if (result.rows.length === 0) return null;
  const { dawarich_url, dawarich_api_key } = result.rows[0];
  if (!dawarich_url || !dawarich_api_key) return null;
  return { url: dawarich_url.replace(/\/+$/, ''), apiKey: dawarich_api_key };
}

export async function runDawarichExportJob(jobId: string): Promise<void> {
  try {
    await query(
      `UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1`,
      [jobId]
    );

    const settings = await getDawarichSettings();
    if (!settings) {
      throw new Error('Dawarich URL and API key are not configured. Update them in Settings > Integrations.');
    }

    // Fetch all venues with coordinates
    const venuesResult = await query(
      `SELECT name, latitude, longitude FROM venues
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY name`
    );
    const allVenues = venuesResult.rows;

    // Fetch existing places from Dawarich to avoid duplicates
    const existingRes = await fetch(`${settings.url}/api/v1/places?api_key=${settings.apiKey}`, {
      headers: { Accept: 'application/json' },
    });
    if (!existingRes.ok) {
      throw new Error(`Failed to fetch existing Dawarich places: ${existingRes.status} ${existingRes.statusText}`);
    }
    const existingPlaces = (await existingRes.json()) as Array<{ name: string }>;
    const existingNames = new Set(existingPlaces.map((p) => p.name.toLowerCase()));

    const toExport = allVenues.filter((v: any) => !existingNames.has(v.name.toLowerCase()));

    await updateJobProgress(jobId, {
      phase: 'exporting',
      message: `Found ${allVenues.length} venues, ${toExport.length} new to export (${existingNames.size} already exist in Dawarich).`,
    });

    let exported = 0;
    let skipped = 0;
    let failed = 0;

    for (const venue of toExport) {
      if (isJobCancelled(jobId)) throw new Error('cancelled');
      try {
        const res = await fetch(`${settings.url}/api/v1/places?api_key=${settings.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            name: venue.name,
            latitude: parseFloat(venue.latitude),
            longitude: parseFloat(venue.longitude),
          }),
        });

        if (res.ok) {
          exported++;
        } else {
          const errText = await res.text().catch(() => '');
          console.error(`Dawarich export failed for "${venue.name}": ${res.status} ${errText.slice(0, 100)}`);
          failed++;
        }
      } catch (venueErr) {
        console.error(`Dawarich export error for "${venue.name}":`, venueErr);
        failed++;
      }

      if ((exported + failed) % 10 === 0) {
        await updateJobProgress(jobId, {
          phase: 'exporting',
          message: `Exporting: ${exported} created, ${failed} failed, ${toExport.length - exported - failed} remaining`,
          exported,
          failed,
        });
      }
    }

    await query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(), progress = $1 WHERE id = $2`,
      [JSON.stringify({
        phase: 'done',
        message: `Complete. Exported ${exported} places to Dawarich. ${skipped} skipped, ${failed} failed.`,
        exported,
        skipped: existingNames.size,
        failed,
      }), jobId]
    );
  } catch (err: any) {
    cleanupCancellation(jobId);
    const isCancelled = err.message === 'cancelled';
    console.error(`Dawarich export job ${jobId} ${isCancelled ? 'cancelled' : 'failed'}:`, isCancelled ? '' : err);
    await query(
      `UPDATE jobs SET status = $1, completed_at = NOW(), error = $2 WHERE id = $3`,
      [isCancelled ? 'cancelled' : 'failed', isCancelled ? 'Job was cancelled by user.' : (err.message || String(err)), jobId]
    );
  }
}
