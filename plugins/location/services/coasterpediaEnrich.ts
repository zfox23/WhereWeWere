// ============================================================================
// Look up a venue on Coasterpedia and store the outcome in venue_coasterpedia.
// Intended to run fire-and-forget after a venue save, from a manual refresh,
// and from the backfill job: it never throws, failures are stored on the row.
// ============================================================================

import { query } from '../../../server/src/db';
import {
  CoasterpediaError,
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

/**
 * Run the lookup. With `attractionId` the user has chosen the record, so the
 * search is skipped. Never throws.
 */
export async function enrichVenueCoasterpedia(
  venueId: string,
  userId: string,
  opts: { attractionId?: number } = {},
): Promise<void> {
  try {
    const venue = await loadVenue(venueId);
    if (!venue) return;
    const apiKey = await getCoasterpediaApiKey(userId);
    if (!apiKey) return;

    try {
      let attractionId = opts.attractionId;
      if (attractionId == null) {
        const outcome = pickMatch(await searchAttractions(venue.name, apiKey), {
          name: venue.name,
          parentName: venue.parent_name,
          country: venue.country,
        });
        if (outcome.status === 'no_match') return await saveRow(venue, userId, { status: 'no_match' });
        if (outcome.status === 'ambiguous') {
          return await saveRow(venue, userId, { status: 'ambiguous', candidates: outcome.candidates });
        }
        attractionId = outcome.attractionId;
      }
      const attraction = await getAttraction(attractionId, apiKey);
      await saveRow(venue, userId, { status: 'matched', attractionId: attraction.id, data: attraction });
    } catch (err) {
      const message = err instanceof CoasterpediaError || err instanceof Error ? err.message : 'Lookup failed';
      console.error(`Coasterpedia lookup failed for venue ${venueId} (non-fatal):`, err);
      await saveRow(venue, userId, { status: 'error', error: message });
    }
  } catch (err) {
    console.error('Coasterpedia enrichment failed (non-fatal):', err);
  }
}
