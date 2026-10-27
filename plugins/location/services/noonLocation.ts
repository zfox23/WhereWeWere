// ============================================================================
// Where was the user at local noon on a given day? The latest check-in at or
// before noon, carried forward from earlier days; when nothing precedes that
// noon, the first check-in after it. Check-in times compare as local
// wall-clock times in each check-in's own timezone, matching how the
// timeline assigns check-ins to days.
// ============================================================================

import { query } from '../../../server/src/db';
import { getVenueTimezone } from './geoTimezone';

export interface NoonLocation {
  latitude: number;
  longitude: number;
  /** IANA timezone of the place, used to define the weather day. */
  timezone: string;
}

const LOCAL_TS = `(c.checked_in_at AT TIME ZONE COALESCE(c.checkin_timezone, 'UTC'))`;

export async function resolveNoonLocation(userId: string, localDate: string): Promise<NoonLocation | null> {
  const result = await query(
    `SELECT v.latitude, v.longitude, c.checkin_timezone
       FROM checkins c
       JOIN venues v ON v.id = c.venue_id
      WHERE c.user_id = $1
      ORDER BY CASE WHEN ${LOCAL_TS} <= ($2::date + TIME '12:00') THEN 0 ELSE 1 END,
               CASE WHEN ${LOCAL_TS} <= ($2::date + TIME '12:00') THEN ${LOCAL_TS} END DESC,
               ${LOCAL_TS} ASC
      LIMIT 1`,
    [userId, localDate],
  );
  const row = result.rows[0];
  if (!row) return null;
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const timezone = getVenueTimezone(latitude, longitude) ?? row.checkin_timezone ?? 'UTC';
  return { latitude, longitude, timezone };
}
