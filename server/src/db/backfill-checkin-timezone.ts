import { find as findTimezone } from 'geo-tz';
import { pool } from './index';

type VenueRow = {
  venue_id: string;
  latitude: string | number;
  longitude: string | number;
};

async function backfillCheckinTimezone() {
  const client = await pool.connect();

  try {
    const { rows: venues } = await client.query<VenueRow>(
      `SELECT DISTINCT c.venue_id, v.latitude, v.longitude
       FROM checkins c
       JOIN venues v ON v.id = c.venue_id
       WHERE c.checkin_timezone IS NULL
         AND v.latitude IS NOT NULL
         AND v.longitude IS NOT NULL`
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
           AND checkin_timezone IS NULL`,
        [timezone, venue.venue_id]
      );

      updatedRows += result.rowCount || 0;
    }

    console.log(`Backfill complete. Updated ${updatedRows} checkins across ${venues.length - skippedVenues} venues.`);
    if (skippedVenues > 0) {
      console.log(`Skipped ${skippedVenues} venues due to invalid coordinates or missing timezone.`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

backfillCheckinTimezone().catch((err) => {
  console.error('Timezone backfill failed:', err);
  process.exit(1);
});
