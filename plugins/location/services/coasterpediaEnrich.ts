// ============================================================================
// Look up a venue on Coasterpedia and store the outcome in venue_coasterpedia.
// Intended to run fire-and-forget after a venue save, from a manual refresh,
// and from the backfill job: it never throws, failures are stored on the row.
// ============================================================================

import { query } from '../../../server/src/db';
import {
  CoasterpediaError,
  RequestOptions,
  getAttraction,
  pickMatch,
  searchAttractions,
} from './coasterpedia';

export const AMUSEMENT_RIDE_CATEGORY = 'amusement ride';

export function isAmusementRideCategory(name: string | null | undefined): boolean {
  return (name ?? '').trim().toLowerCase() === AMUSEMENT_RIDE_CATEGORY;
}

/** The Coasterpedia key from plugin_settings (jsonb string); null when unset. */
export async function getCoasterpediaApiKey(userId: string): Promise<string | null> {
  const result = await query(
    `SELECT value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'location' AND key = 'coasterpedia_api_key'`,
    [userId],
  );
  const v = result.rows[0]?.value;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

interface VenueRow {
  id: string;
  name: string;
  parent_venue_id: string | null;
  parent_name: string | null;
  country: string | null;
  category_name: string | null;
}

async function loadVenue(venueId: string): Promise<VenueRow | null> {
  const result = await query(
    `SELECT v.id, v.name, v.parent_venue_id, pv.name AS parent_name, v.country,
            vc.name AS category_name
       FROM venues v
       LEFT JOIN venue_categories vc ON vc.id = v.category_id
       LEFT JOIN venues pv ON pv.id = v.parent_venue_id
      WHERE v.id = $1`,
    [venueId],
  );
  return result.rows[0] ?? null;
}

async function saveRow(
  venue: VenueRow,
  userId: string,
  row: {
    status: 'matched' | 'ambiguous' | 'no_match' | 'error';
    attractionId?: number | null;
    data?: unknown;
    candidates?: unknown;
    error?: string | null;
  },
): Promise<void> {
  await query(
    `INSERT INTO venue_coasterpedia
       (venue_id, user_id, status, attraction_id, data, candidates, error,
        looked_up_name, looked_up_parent, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (venue_id) DO UPDATE SET
       status = EXCLUDED.status, error = EXCLUDED.error,
       -- a failed refresh keeps the last good record instead of wiping it
       attraction_id = CASE WHEN EXCLUDED.status = 'error' THEN venue_coasterpedia.attraction_id ELSE EXCLUDED.attraction_id END,
       data = CASE WHEN EXCLUDED.status = 'error' THEN venue_coasterpedia.data ELSE EXCLUDED.data END,
       candidates = CASE WHEN EXCLUDED.status = 'error' THEN venue_coasterpedia.candidates ELSE EXCLUDED.candidates END,
       looked_up_name = EXCLUDED.looked_up_name, looked_up_parent = EXCLUDED.looked_up_parent,
       fetched_at = NOW()`,
    [
      venue.id,
      userId,
      row.status,
      row.attractionId ?? null,
      row.data == null ? null : JSON.stringify(row.data),
      row.candidates == null ? null : JSON.stringify(row.candidates),
      row.error ?? null,
      venue.name,
      venue.parent_venue_id,
    ],
  );
}

/**
 * True when a save should (re-)run the lookup: the venue is an amusement
 * ride and either has no stored row, or its name or parent changed since the
 * last lookup. Without an API key there is nothing to do.
 */
export async function needsLookup(venueId: string, userId: string): Promise<boolean> {
  const venue = await loadVenue(venueId);
  if (!venue || !isAmusementRideCategory(venue.category_name)) return false;
  if (!(await getCoasterpediaApiKey(userId))) return false;
  const existing = await query(
    `SELECT looked_up_name, looked_up_parent FROM venue_coasterpedia WHERE venue_id = $1`,
    [venueId],
  );
  const row = existing.rows[0];
  if (!row) return true;
  return row.looked_up_name !== venue.name || (row.looked_up_parent ?? null) !== (venue.parent_venue_id ?? null);
}

export interface EnrichResult {
  /** Why the lookup could not run for any venue (bad or revoked key). */
  fatal?: string;
}

/**
 * Run the lookup. With `attractionId` the user has chosen the record, so the
 * search is skipped. `patient` is for batch work and waits out rate limits.
 * Never throws.
 *
 * Coasterpedia's terms make us responsible for dropping records it deletes.
 * When the stored record itself is gone (404 not-found on its own ID), the
 * stored data is cleared; a bad ID the user just typed leaves the old match.
 */
export async function enrichVenueCoasterpedia(
  venueId: string,
  userId: string,
  opts: { attractionId?: number } & RequestOptions = {},
): Promise<EnrichResult> {
  try {
    const venue = await loadVenue(venueId);
    if (!venue) return {};
    const apiKey = await getCoasterpediaApiKey(userId);
    if (!apiKey) return {};
    const request: RequestOptions = { patient: opts.patient };

    try {
      let attractionId = opts.attractionId;
      if (attractionId == null) {
        const outcome = pickMatch(await searchAttractions(venue.name, apiKey, request), {
          name: venue.name,
          parentName: venue.parent_name,
          country: venue.country,
        });
        if (outcome.status === 'no_match') {
          await saveRow(venue, userId, { status: 'no_match' });
          return {};
        }
        if (outcome.status === 'ambiguous') {
          await saveRow(venue, userId, { status: 'ambiguous', candidates: outcome.candidates });
          return {};
        }
        attractionId = outcome.attractionId;
      }
      const attraction = await getAttraction(attractionId, apiKey, request);
      await saveRow(venue, userId, { status: 'matched', attractionId: attraction.id, data: attraction });
      return {};
    } catch (err) {
      const failure = err instanceof CoasterpediaError ? err : null;
      const message = err instanceof Error ? err.message : 'Lookup failed';

      if (failure?.isNotFound && opts.attractionId != null) {
        const stored = await query('SELECT attraction_id FROM venue_coasterpedia WHERE venue_id = $1', [venueId]);
        if (stored.rows[0]?.attraction_id === opts.attractionId) {
          await saveRow(venue, userId, {
            status: 'no_match',
            error: 'This record was removed from Coasterpedia. Enter another ID or URL.',
          });
          return {};
        }
      }

      console.error(`Coasterpedia lookup failed for venue ${venueId} (non-fatal):`, err);
      await saveRow(venue, userId, { status: 'error', error: message });
      return failure?.isAuthFailure ? { fatal: message } : {};
    }
  } catch (err) {
    console.error('Coasterpedia enrichment failed (non-fatal):', err);
    return {};
  }
}

/**
 * Two requests per ride (search, then fetch) against a 60-requests-a-minute
 * limit shared by the whole account, so leave about a second per request.
 */
export const BACKFILL_DELAY_MS = 2_200;

/** Rides that were never looked up, or whose last lookup failed. */
export async function pendingBackfillVenueIds(): Promise<string[]> {
  const pending = await query(
    `SELECT v.id FROM venues v
       JOIN venue_categories vc ON vc.id = v.category_id
       LEFT JOIN venue_coasterpedia cp ON cp.venue_id = v.id
      WHERE LOWER(TRIM(vc.name)) = $1 AND (cp.venue_id IS NULL OR cp.status = 'error')
      ORDER BY v.name`,
    [AMUSEMENT_RIDE_CATEGORY],
  );
  return pending.rows.map((r: { id: string }) => r.id);
}

/**
 * Look the venues up one at a time, paced to the API limit. Stops on a bad or
 * revoked key, since every remaining venue would fail the same way.
 */
export async function runCoasterpediaBackfill(
  venueIds: string[],
  userId: string,
  hooks: {
    delayMs?: number;
    isCancelled?: () => boolean;
    onProgress?: (done: number, total: number) => Promise<void> | void;
  } = {},
): Promise<void> {
  const delayMs = hooks.delayMs ?? BACKFILL_DELAY_MS;
  for (let i = 0; i < venueIds.length; i++) {
    if (hooks.isCancelled?.()) throw new Error('cancelled');
    const started = Date.now();
    const result = await enrichVenueCoasterpedia(venueIds[i], userId, { patient: true });
    if (result.fatal) throw new Error(result.fatal);
    await hooks.onProgress?.(i + 1, venueIds.length);
    const wait = delayMs - (Date.now() - started);
    if (i < venueIds.length - 1 && wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}
