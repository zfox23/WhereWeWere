import { query } from '../db';
import { DEFAULT_USER_ID } from '../constants';

/**
 * Core check-in access for plugins and webhook integrations.
 *
 * Plugins (custom storage) and webhooks sometimes need the user's local
 * timezone at a point in time — e.g. to label an incoming event before the
 * user has chosen one. They must not query core tables directly: this
 * module is the single place that knows the `checkins` schema, so a
 * column/table rename only touches the platform, not every plugin.
 */

/**
 * The timezone of the most recent location check-in at or before
 * `referenceTime`, or null when the user has none.
 */
export async function latestCheckinTimezoneAsOf(
  referenceTime: Date,
  user_id: string = DEFAULT_USER_ID,
): Promise<string | null> {
  const result = await query(
    `SELECT checkin_timezone
     FROM checkins
     WHERE user_id = $1
       AND checkin_timezone IS NOT NULL
       AND checked_in_at <= $2
     ORDER BY checked_in_at DESC
     LIMIT 1`,
    [user_id, referenceTime.toISOString()],
  );
  return result.rows[0]?.checkin_timezone ?? null;
}
