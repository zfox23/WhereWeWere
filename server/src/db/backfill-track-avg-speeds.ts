import { pool } from './index';
import { computeTrackSegmentTotals, type GpxPoint } from '../services/gpx';

/**
 * One-off backfill: recompute tracks.distance_m, tracks.moving_time_s, and
 * tracks.avg_speed_mps with the plausibility filter added to
 * computeTrackSegmentTotals in services/gpx.ts. (Elevation gain is unaffected
 * by the filter, so it is left as-is.)
 *
 * Older tracks accumulated raw per-segment distances, so GPS lock jumps
 * (the position teleporting hundreds of meters after the receiver loses
 * signal) inflated distanceM. That made the stored average speed
 * (distance / moving time) exceed the windowed max speed, which is
 * impossible. The stored path geometry and per-point timestamps are used to
 * recompute, mirroring backfill-track-max-speeds.ts.
 */

type TrackRow = {
  id: string;
  distance_m: string | number;
  moving_time_s: string | number;
  elapsed_time_s: string | number;
  avg_speed_mps: string | number;
  geojson: string | { type: string; coordinates: [number, number][] };
  points: { t: number | null }[] | null;
};

async function backfillTrackAvgSpeeds() {
  const client = await pool.connect();

  try {
    const { rows: tracks } = await client.query<TrackRow>(
      `SELECT id, distance_m, moving_time_s, elapsed_time_s,
              avg_speed_mps, ST_AsGeoJSON(path) AS geojson, points
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
      const points: GpxPoint[] = [];
      for (let i = 0; i < coords.length; i++) {
        const t = track.points[i]?.t;
        if (t == null || !Number.isFinite(t)) continue;
        const [lon, lat] = coords[i];
        points.push({
          lat,
          lon,
          ele: null,
          hr: null,
          time: new Date(t),
        });
      }

      if (points.length < 2) {
        skippedTracks++;
        continue;
      }

      // Recompute with the same rounding/clamping as computeTrackStats
      const { distanceM, movingTimeS: rawMovingTimeS } =
        computeTrackSegmentTotals(points);
      const elapsedS = Number(track.elapsed_time_s);
      let movingTimeS = rawMovingTimeS;
      if (movingTimeS > elapsedS) movingTimeS = elapsedS;
      movingTimeS = Math.round(movingTimeS);
      const newDistanceM = Math.round(distanceM);
      const newAvgSpeedMps =
        Math.round((movingTimeS > 0 ? distanceM / movingTimeS : 0) * 100) / 100;

      const oldDistanceM = Number(track.distance_m);
      const oldMovingS = Number(track.moving_time_s);
      const oldAvgSpeedMps = Number(track.avg_speed_mps);

      const changed =
        Math.abs(newDistanceM - oldDistanceM) >= 1 ||
        Math.abs(movingTimeS - oldMovingS) >= 1 ||
        Math.abs(newAvgSpeedMps - oldAvgSpeedMps) >= 0.005;

      if (!changed) continue;

      const result = await client.query(
        `UPDATE tracks
         SET distance_m = $1, moving_time_s = $2, avg_speed_mps = $3
         WHERE id = $4`,
        [newDistanceM, movingTimeS, newAvgSpeedMps, track.id]
      );
      updatedRows += result.rowCount || 0;
      if (updatedRows <= 10) {
        console.log(
          `  ${track.id}: avg ${oldAvgSpeedMps.toFixed(1)} -> ${newAvgSpeedMps.toFixed(1)} m/s, ` +
            `dist ${oldDistanceM.toFixed(0)} -> ${newDistanceM.toFixed(0)} m, ` +
            `moving ${oldMovingS.toFixed(0)} -> ${movingTimeS.toFixed(0)} s`
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

backfillTrackAvgSpeeds().catch((err) => {
  console.error('Track avg-speed backfill failed:', err);
  process.exit(1);
});
