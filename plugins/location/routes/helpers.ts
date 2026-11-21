/** Helpers shared by the location plugin's routes, jobs and backup hooks. */

import { getVenueTimezone } from '../services/geoTimezone';
import { query } from '../../../server/src/db';
import type { Db } from '../../../server/src/services/lists';
import { reverseGeocode } from '../services/nominatim';

export function addTimezone(row: any): any {
  if (!row.venue_timezone && row.venue_latitude != null && row.venue_longitude != null) {
    row.venue_timezone = getVenueTimezone(row.venue_latitude, row.venue_longitude);
  } else {
    row.venue_timezone = row.venue_timezone || null;
  }
  return row;
}

export async function inferVenueTimezone(venueId: string, executor: Db = { query }): Promise<string | null> {
  const venueResult = await executor.query(
    'SELECT latitude, longitude FROM venues WHERE id = $1',
    [venueId]
  );

  if (venueResult.rows.length === 0) return null;

  const venue = venueResult.rows[0];
  return getVenueTimezone(venue.latitude, venue.longitude);
}

export function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize a star rating payload to 1-4 or null (unrated). Values outside
 * the 1-4 range (including 0) are treated as unrated, matching the
 * ScorePicker contract where 0 = no rating.
 */
export function normalizeRating(value: unknown): number | null {
  const n = toNumberOrNull(value);
  if (n == null) return null;
  return n >= 1 && n <= 4 ? Math.trunc(n) : null;
}

/**
 * Set (1-4) or clear (null) a user's own star rating for a shared venue.
 * Ratings live in venue_ratings; venues.rating is no longer read or written.
 */
export async function setVenueRating(
  userId: string,
  venueId: string,
  rating: number | null,
  executor: Db = { query },
): Promise<void> {
  if (rating == null) {
    await executor.query('DELETE FROM venue_ratings WHERE user_id = $1 AND venue_id = $2', [userId, venueId]);
    return;
  }
  await executor.query(
    `INSERT INTO venue_ratings (user_id, venue_id, rating)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, venue_id) DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
    [userId, venueId, rating]
  );
}

export function serializeVenue<T extends { latitude?: unknown; longitude?: unknown }>(venue: T): T {
  return {
    ...venue,
    latitude: toNumberOrNull(venue.latitude),
    longitude: toNumberOrNull(venue.longitude),
  } as T;
}

export type GeocodableVenue = {
  id?: string | null;
  latitude?: unknown;
  longitude?: unknown;
  city?: string | null;
  state?: string | null;
  country?: string | null;
};

export async function geocodeVenueLocationIfMissing<T extends GeocodableVenue>(venue: T): Promise<T> {
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
