import { pool } from './index';
import { computeMaxSpeedMps } from '../services/gpx';

/**
 * One-off backfill: recompute tracks.max_speed_mps with the jitter-resistant
 * windowed algorithm (see computeMaxSpeedMps in services/gpx.ts).
 *
 * Older tracks were stored with the max of raw per-segment speeds, which GPS
 * position jitter inflated to implausible values (e.g. 400+ m/s on walks).
 * The stored path geometry and per-point timestamps are used to recompute.
 */

type TrackRow = {
  id: string;
  max_speed_mps: string | number;
  geojson: string | { type: string; coordinates: [number, number][] };
  points: { t: number | null }[] | null;
};

async function backfillTrackMaxSpeeds() {
  const client = await pool.connect();

  try {
    const { rows: tracks } = await client.query<TrackRow>(
      `SELECT id, max_speed_mps, ST_AsGeoJSON(path) AS geojson, points
       FROM tracks`
    );

    if (tracks.length === 0) {
      console.log('No tracks to update.');
      return;
    }

    let updatedRows = 0;
    let skippedTracks = 0;

    for (const track of tracks) {
      const gj =
        typeof track.geojson === 'string' ? JSON.parse(track.geojson) : track.geojson;
      const coords: [number, number][] | undefined =
        gj?.type === 'LineString' && Array.isArray(gj.coordinates) ? gj.coordinates : undefined;

      if (!coords || coords.length < 2 || !Array.isArray(track.points)) {
        skippedTracks++;
        continue;
      }

      // Reconstruct timestamped points from the stored geometry + point series
      const timed = [];
      for (let i = 0; i < coords.length; i++) {
        const t = track.points[i]?.t;
        if (t == null || !Number.isFinite(t)) continue;
        const [lon, lat] = coords[i];
        timed.push({
          lat,
          lon,
          ele: null,
          hr: null,
          time: new Date(t),
        });
      }

      if (timed.length < 2) {
        skippedTracks++;
        continue;
      }

      const newMaxSpeedMps = computeMaxSpeedMps(timed);
      const oldMaxSpeedMps = Number(track.max_speed_mps);

      if (Math.abs(newMaxSpeedMps - oldMaxSpeedMps) < 0.005) continue;

      const result = await client.query(
        'UPDATE tracks SET max_speed_mps = $1 WHERE id = $2',
        [newMaxSpeedMps, track.id]
      );
      updatedRows += result.rowCount || 0;
      if (updatedRows <= 10) {
        console.log(
          `  ${track.id}: ${oldMaxSpeedMps.toFixed(1)} -> ${newMaxSpeedMps.toFixed(1)} m/s`
        );
      }
    }

    console.log(
      `Backfill complete. Updated ${updatedRows} of ${tracks.length} tracks.`
    );
    if (skippedTracks > 0) {
      console.log(`Skipped ${skippedTracks} tracks (missing geometry or timestamps).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

backfillTrackMaxSpeeds().catch((err) => {
  console.error('Track max-speed backfill failed:', err);
  process.exit(1);
});
