/**
 * Location background jobs: venue backfill (geocode + categorize), venue
 * recategorize, Coasterpedia backfill and weather backfill.
 */

import { getCoasterpediaApiKey, pendingBackfillVenueIds, runCoasterpediaBackfill } from './services/coasterpediaEnrich';
import { isWeatherEnabled, pendingWeatherDates, runWeatherBackfill } from './services/weatherEnrich';
import type { PluginJobContext, PluginJobDefinition } from 'wwp-shared';
import { query } from '../../server/src/db';
import { currentUserId } from '../../server/src/auth/context';
import { reverseGeocode } from './services/nominatim';
import { searchNearbyVenues } from './services/photonVenues';

// Venues the job has already tried this run are excluded from later batches;
// otherwise unresolvable ones are re-selected forever and starve the rest.
async function geocodeBatch(jobId: string, attempted: string[]) {
  const result = await query(
    `SELECT id, latitude, longitude FROM venues
     WHERE (country IS NULL OR TRIM(country) = '')
       AND id <> ALL($1::uuid[])
     LIMIT 100`,
    [attempted]
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
    console.log(`[jobs] geocode ${jobId} venue ${processed}/${total}`);
  }

  const attemptedNow = [...attempted, ...result.rows.map((r: { id: string }) => r.id)];
  const remaining = await query(
    `SELECT COUNT(*)::int AS count FROM venues
     WHERE (country IS NULL OR TRIM(country) = '') AND id <> ALL($1::uuid[])`,
    [attemptedNow]
  );

  return {
    updated,
    failed: failedIds.length,
    attemptedIds: result.rows.map((r: { id: string }) => r.id),
    remaining: remaining.rows[0].count as number,
  };
}

// Venues in this category are never recategorized: the Coasterpedia lookup
// keys off it, and OSM would relabel rides as e.g. "Attraction".
const PROTECTED_CATEGORY = 'Amusement Ride';

// Which venues a categorize pass looks at. The default only fills in missing
// categories; overwrite also replaces existing ones, except protected ones.
function categorizeCandidateCondition(overwrite: boolean): string {
  return overwrite
    ? `(v.category_id IS NULL OR v.category_id NOT IN
         (SELECT id FROM venue_categories WHERE name = '${PROTECTED_CATEGORY}'))`
    : 'v.category_id IS NULL';
}

async function categorizeBatch(jobId: string, attempted: string[], overwrite = false) {
  const condition = categorizeCandidateCondition(overwrite);
  const result = await query(
    `SELECT v.id, v.name, v.latitude, v.longitude, v.category_id FROM venues v
     WHERE ${condition}
       AND v.id <> ALL($1::uuid[])
     ORDER BY v.id
     LIMIT 20`,
    [attempted]
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
        // No match leaves the existing category alone (overwrite never clears).
        if (catResult.rows[0].id !== venue.category_id) {
          await query(
            'UPDATE venues SET category_id = $1 WHERE id = $2',
            [catResult.rows[0].id, venue.id]
          );
          updated++;
        }
      }

      // Lookups go to Photon (PHOTON_URL), usually our own instance; a short
      // pause keeps a full-library run from hammering it. (This was 1.1 s
      // when categorization used the rate-limited public Overpass API.)
      await new Promise((r) => setTimeout(r, 100));
    } catch (venueErr) {
      console.error(`Failed to categorize venue ${venue.id}:`, venueErr);
    }
  }

  const attemptedNow = [...attempted, ...result.rows.map((r: { id: string }) => r.id)];
  const remaining = await query(
    `SELECT COUNT(*)::int AS count FROM venues v WHERE ${condition} AND v.id <> ALL($1::uuid[])`,
    [attemptedNow]
  );

  return {
    updated,
    attemptedIds: result.rows.map((r: { id: string }) => r.id),
    remaining: remaining.rows[0].count as number,
  };
}

/**
 * Look up every Amusement Ride venue that has no Coasterpedia result yet, or
 * whose last lookup failed. Paced to the API's per-account rate limit.
 */
async function coasterpediaBackfillHandler(ctx: PluginJobContext): Promise<void> {
  // Jobs start from the user's request and run in its user context.
  const userId = currentUserId();
  if (!(await getCoasterpediaApiKey(userId))) {
    throw new Error('Add a Coasterpedia API key in Settings > Location first');
  }
  const ids = await pendingBackfillVenueIds(userId);
  await ctx.updateProgress({ phase: 'coasterpedia', message: `Looking up ${ids.length} rides...`, updated: 0 });
  await runCoasterpediaBackfill(ids, userId, {
    isCancelled: () => ctx.isCancelled(),
    onProgress: (done, total) =>
      ctx.updateProgress({
        phase: 'coasterpedia',
        message: `Looked up ${done} of ${total} rides...`,
        updated: done,
        remaining: total - done,
      }),
  });
}

/**
 * Fetch weather for every day with a check-in that has none yet (or a failed
 * or still-provisional one). Newest days first, paced under Open-Meteo's limit.
 */
async function weatherBackfillHandler(ctx: PluginJobContext): Promise<void> {
  const userId = currentUserId();
  if (!(await isWeatherEnabled(userId))) {
    throw new Error('Turn on weather in Settings > Location first');
  }
  const dates = await pendingWeatherDates(userId);
  await ctx.updateProgress({ phase: 'weather', message: `Fetching weather for ${dates.length} days...`, updated: 0 });
  await runWeatherBackfill(dates, userId, {
    isCancelled: () => ctx.isCancelled(),
    onProgress: (done, total) =>
      ctx.updateProgress({
        phase: 'weather',
        message: `Fetched weather for ${done} of ${total} days...`,
        updated: done,
        remaining: total - done,
      }),
  });
}

/**
 * Categorize venues in batches until every candidate has been tried once.
 * Returns how many venues got a new category.
 */
async function runCategorizePhase(ctx: PluginJobContext, overwrite: boolean): Promise<number> {
  let totalUpdated = 0;
  const remainingInit = await query(
    `SELECT COUNT(*)::int AS count FROM venues v WHERE ${categorizeCandidateCondition(overwrite)}`
  );
  let remaining = remainingInit.rows[0].count;
  const attempted: string[] = [];
  while (remaining > 0) {
    if (ctx.isCancelled()) throw new Error('cancelled');
    const batch = await categorizeBatch(ctx.jobId, attempted, overwrite);
    attempted.push(...batch.attemptedIds);
    totalUpdated += batch.updated;
    remaining = batch.remaining;
    await ctx.updateProgress({
      phase: 'categorize',
      message: `${overwrite ? 'Recategorized' : 'Categorized'} ${totalUpdated} venues (${attempted.length} checked)...`,
      updated: totalUpdated,
      remaining,
    });
    if (batch.attemptedIds.length === 0) break;
  }
  return totalUpdated;
}

/**
 * The "Recategorize Venues" job: look every venue up in OSM (via Photon) and
 * replace its category with the OSM one. Venues with no OSM match keep their
 * category, and "Amusement Ride" venues are never touched.
 */
async function venueRecategorizeHandler(ctx: PluginJobContext): Promise<void> {
  await ctx.updateProgress({ phase: 'categorize', message: 'Starting venue recategorization...' });
  const updated = await runCategorizePhase(ctx, true);
  await ctx.updateProgress({
    phase: 'done',
    message: `Complete. Recategorized ${updated} venues.`,
    categorized: updated,
  });
}

/**
 * The "Backfill Venues" job: reverse-geocode venues missing country data,
 * then categorize uncategorized venues using OSM data (Photon). Runs in the
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
  const geoAttempted: string[] = [];
  while (geoRemaining > 0) {
    if (ctx.isCancelled()) throw new Error('cancelled');
    const batch = await geocodeBatch(ctx.jobId, geoAttempted);
    geoAttempted.push(...batch.attemptedIds);
    totalGeoUpdated += batch.updated;
    geoRemaining = batch.remaining;
    await ctx.updateProgress({
      phase: 'geocode',
      message: `Geocoded ${totalGeoUpdated} venues...`,
      updated: totalGeoUpdated,
      remaining: geoRemaining,
    });
    if (batch.failed > 0) {
      console.warn(
        `[jobs] backfill geocode batch could not resolve ${batch.failed} venues (skipped for the rest of this run). ` +
        `They likely have ungeocodable coordinates or Nominatim is failing.`
      );
    }
    if (batch.attemptedIds.length === 0) break;
  }

  await ctx.updateProgress({
    phase: 'categorize',
    message: `Geocoding done (${totalGeoUpdated} venues). Starting categorization...`,
    updated: totalGeoUpdated,
  });

  // Phase 2: Categorize (batched until no uncategorized venues remain)
  const totalCatUpdated = await runCategorizePhase(ctx, false);

  await ctx.updateProgress({
    phase: 'done',
    message: `Complete. Geocoded ${totalGeoUpdated} venues, categorized ${totalCatUpdated} venues.`,
    geocoded: totalGeoUpdated,
    categorized: totalCatUpdated,
  });
}

// The jobType strings are stable — the client calls e.g. jobs.start('backfill').
export const jobs: PluginJobDefinition[] = [
  { jobType: 'backfill', handler: venueBackfillHandler },
  { jobType: 'recategorize', handler: venueRecategorizeHandler },
  { jobType: 'coasterpedia-backfill', handler: coasterpediaBackfillHandler },
  { jobType: 'weather-backfill', handler: weatherBackfillHandler },
];
