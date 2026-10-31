// Fill in checkin_timezone for one user's check-ins that have none, from
// their venue's coordinates.
//
// Usage (from server/): npm run backfill:checkin-timezone -- --user <username>

import { find as findTimezone } from 'geo-tz';
import { pool } from '../../../server/src/db';
import { currentUserId, runAsUser } from '../../../server/src/auth/context';
import { requireScriptUser } from '../../../server/src/scripts/scriptUser';

type VenueRow = {
  venue_id: string;
  latitude: string | number;
  longitude: string | number;
};

async function backfillCheckinTimezone() {
  const userId = currentUserId();
  const client = await pool.connect();

  try {
    const { rows: venues } = await client.query<VenueRow>(
      `SELECT DISTINCT c.venue_id, v.latitude, v.longitude
       FROM checkins c
       JOIN venues v ON v.id = c.venue_id
       WHERE c.user_id = $1
         AND c.checkin_timezone IS NULL
         AND v.latitude IS NOT NULL
         AND v.longitude IS NOT NULL`,
      [userId]
    );

    if (venues.length === 0) {
      console.log('No historical checkins need timezone backfill.');
      return;
    }

    let updatedRows = 0;
    let skippedVenues = 0;

    for (const venue of venues) {
      const lat = Number(venue.latitude);
      const lon = Number(venue.longitude);

      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        skippedVenues++;
        continue;
      }

      const tzResults = findTimezone(lat, lon);
      const timezone = tzResults[0] || null;

      if (!timezone) {
        skippedVenues++;
        continue;
      }

      const result = await client.query(
        `UPDATE checkins
         SET checkin_timezone = $1
         WHERE venue_id = $2
           AND user_id = $3
           AND checkin_timezone IS NULL`,
        [timezone, venue.venue_id, userId]
      );

      updatedRows += result.rowCount || 0;
    }

    console.log(`Backfill complete. Updated ${updatedRows} checkins across ${venues.length - skippedVenues} venues.`);
    if (skippedVenues > 0) {
      console.log(`Skipped ${skippedVenues} venues due to invalid coordinates or missing timezone.`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  const { user } = await requireScriptUser(
    process.argv.slice(2),
    'Usage: backfill-checkin-timezone --user <username>'
  );
  try {
    await runAsUser(user.id, backfillCheckinTimezone);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Timezone backfill failed:', err);
  process.exit(1);
});
