import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import {
  computeTrackStats,
  parseTrackFile,
  type GpxPoint,
} from '../services/gpx';
import { getVenueTimezone } from '../services/timestampReconciliation';
import {
  buildGpx,
  deleteStoredTrack,
  deriveActivityTypeFromFilename,
  gpxDownloadFilename,
  storeUploadedTrack,
} from '../services/trackFiles';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

const trackStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-tracks');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, _file, cb) => {
    const ext =
      (path.extname(_file.originalname).toLowerCase() === '.tcx' && '.tcx') || '.gpx';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const trackUpload = multer({
  storage: trackStorage,
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase();
    if (
      file.mimetype === 'application/gpx+xml' ||
      file.mimetype === 'text/xml' ||
      file.mimetype === 'application/xml' ||
      lower.endsWith('.gpx') ||
      lower.endsWith('.tcx')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .gpx and .tcx files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

function sanitizeTimezone(value: unknown): string {
  const tz = String(value || '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Derive a human-friendly track name from the uploaded file name.
 * Garmin-style TCX exports are named `YYYY-MM-DD_ActivityName_Activity.tcx`
 * (e.g. `2013-05-31_Night Ride with Paul_Cycling.tcx` -> `Night Ride with Paul`).
 */
function deriveFallbackName(originalname: string): string {
  const base = originalname.replace(/\.(gpx|tcx)$/i, '');
  const garmin = base.match(/^(\d{4}-\d{2}-\d{2})_(.+?)_([^_]+)$/);
  if (garmin && garmin[2].trim()) {
    return garmin[2].trim();
  }
  return base.replace(/[_-]+/g, ' ').trim() || 'Track';
}

function trackRowToApi(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    activity_type: row.activity_type ?? null,
    timezone: row.timezone,
    started_at: row.started_at,
    ended_at: row.ended_at,
    distance_m: Number(row.distance_m),
    elapsed_time_s: Number(row.elapsed_time_s),
    moving_time_s: Number(row.moving_time_s),
    elevation_gain_m: Number(row.elevation_gain_m),
    avg_speed_mps: Number(row.avg_speed_mps),
    max_speed_mps: Number(row.max_speed_mps),
    avg_hr: row.avg_hr == null ? null : Number(row.avg_hr),
    max_hr: row.max_hr == null ? null : Number(row.max_hr),
    point_count: Number(row.point_count),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const TRACK_LIST_FIELDS = `
  SELECT t.id, t.user_id, t.name, t.activity_type, t.timezone,
         t.started_at, t.ended_at,
         t.distance_m, t.elapsed_time_s, t.moving_time_s,
         t.elevation_gain_m, t.avg_speed_mps, t.max_speed_mps,
         t.avg_hr, t.max_hr, t.point_count,
         t.created_at, t.updated_at
  FROM tracks t`;

// GET / - list tracks
router.get('/', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to, limit = '50', offset = '0' } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`t.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date >= $${paramIndex}::date`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date <= $${paramIndex}::date`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit as string, 10));
    const limitParam = `$${paramIndex}`;
    paramIndex++;

    params.push(parseInt(offset as string, 10));
    const offsetParam = `$${paramIndex}`;

    const result = await query(
      `${TRACK_LIST_FIELDS}
       ${whereClause}
       ORDER BY t.started_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    res.json(result.rows.map(trackRowToApi));
  } catch (err) {
    console.error('Error listing tracks:', err);
    res.status(500).json({ error: 'Failed to list tracks' });
  }
});

// GET /map-data - lightweight track list with geometry for map views
router.get('/map-data', async (req: Request, res: Response) => {
  try {
    const { user_id, from, to } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`t.user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date >= $${paramIndex}::date`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date <= $${paramIndex}::date`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT t.id, t.name, t.activity_type, t.timezone, t.started_at,
              t.distance_m, t.elapsed_time_s, t.moving_time_s, t.elevation_gain_m,
              t.avg_speed_mps, t.max_speed_mps,
              ST_XMin(t.path) AS min_lng, ST_YMin(t.path) AS min_lat,
              ST_XMax(t.path) AS max_lng, ST_YMax(t.path) AS max_lat,
              ST_AsGeoJSON(t.path) AS geojson
       FROM tracks t
       ${whereClause}
       ORDER BY t.started_at ASC`,
      params
    );

    const data = result.rows.map((row: any) => {
      let coordinates: [number, number][] = [];
      try {
        const gj = typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson;
        if (gj?.type === 'LineString' && Array.isArray(gj.coordinates)) {
          coordinates = gj.coordinates;
        }
      } catch {
        // leave empty
      }

      return {
        id: row.id,
        name: row.name,
        activity_type: row.activity_type ?? null,
        timezone: row.timezone,
        started_at: row.started_at,
        distance_m: Number(row.distance_m),
        elapsed_time_s: Number(row.elapsed_time_s),
        moving_time_s: Number(row.moving_time_s),
        elevation_gain_m: Number(row.elevation_gain_m),
        avg_speed_mps: Number(row.avg_speed_mps),
        max_speed_mps: Number(row.max_speed_mps),
        coordinates,
        bounds:
          coordinates.length > 0
            ? {
                minLng: Number(row.min_lng),
                minLat: Number(row.min_lat),
                maxLng: Number(row.max_lng),
                maxLat: Number(row.max_lat),
              }
            : null,
      };
    });

    res.json(data);
  } catch (err) {
    console.error('Error getting track map data:', err);
    res.status(500).json({ error: 'Failed to get track map data' });
  }
});

// GET /activity-types - distinct activity types used across tracks, for autocomplete
router.get('/activity-types', async (req: Request, res: Response) => {
  try {
    const { user_id } = req.query;

    const params: unknown[] = [];
    const conditions: string[] = ['activity_type IS NOT NULL'];
    let paramIndex = 1;

    if (user_id) {
      conditions.push(`user_id = $${paramIndex}`);
      params.push(user_id);
      paramIndex++;
    }

    const result = await query(
      `SELECT activity_type FROM tracks
       WHERE ${conditions.join(' AND ')}
       GROUP BY activity_type
       ORDER BY LOWER(activity_type)`,
      params
    );

    res.json(result.rows.map((r: any) => r.activity_type));
  } catch (err) {
    console.error('Error listing activity types:', err);
    res.status(500).json({ error: 'Failed to list activity types' });
  }
});

/**
 * Fetch a track including its geometry and per-point series, shaped like the
 * GET /:id response. Returns null when the track doesn't exist.
 */
async function fetchTrackFull(id: string | string[]): Promise<any | null> {
  const result = await query(
    `SELECT t.id, t.user_id, t.name, t.activity_type, t.timezone,
            t.started_at, t.ended_at,
            t.distance_m, t.elapsed_time_s, t.moving_time_s,
            t.elevation_gain_m, t.avg_speed_mps, t.max_speed_mps,
            t.avg_hr, t.max_hr, t.point_count,
            t.created_at, t.updated_at,
            t.points,
            ST_AsGeoJSON(t.path) AS geojson
     FROM tracks t
     WHERE t.id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const api: any = trackRowToApi(row);
  let coordinates: [number, number][] = [];
  try {
    const gj = typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson;
    if (gj?.type === 'LineString' && Array.isArray(gj.coordinates)) {
      coordinates = gj.coordinates;
    }
  } catch {
    // leave empty
  }
  api.geometry = coordinates;
  api.points =
    typeof row.points === 'string' ? JSON.parse(row.points) : row.points ?? null;
  return api;
}

// GET /:id - get single track with geometry (GeoJSON coordinates)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const track = await fetchTrackFull(id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }
    res.json(track);
  } catch (err) {
    console.error('Error getting track:', err);
    res.status(500).json({ error: 'Failed to get track' });
  }
});

// POST / - upload a .gpx or .tcx file and create a track
router.post('/', trackUpload.single('file'), async (req: Request, res: Response) => {
  const filePath = (req.file as any)?.path;
  let tempFilePath: string | undefined = filePath;
  let fileHash = '';
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'A .gpx or .tcx file is required' });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const xml = fileBuffer.toString('utf-8');
    const originalName = (req.file as any).originalname;
    const ext = path.extname(originalName).toLowerCase() === '.tcx' ? '.tcx' : '.gpx';
    const fallbackName = deriveFallbackName(originalName);

    const stats = parseTrackFile(xml, ext, fallbackName);

    // Fall back to the filename when the file itself has no activity type
    // (or only a generic one). Garmin exports name files
    // YYYY-MM-DD_HH-MM-SS_<name>_<Sport>.<ext>.
    const parsedType = stats.activityType?.trim() ?? '';
    const isGenericType =
      parsedType.length === 0 ||
      parsedType.toLowerCase() === 'other' ||
      parsedType.toLowerCase() === 'unknown';
    if (isGenericType) {
      const fromFilename = deriveActivityTypeFromFilename(originalName);
      if (fromFilename) {
        stats.activityType = fromFilename;
      }
    }

    // Derive the display/bucketing timezone from the track's start
    // coordinates instead of the uploader's browser timezone. Falls back
    // to the client-supplied value (or UTC) when geo lookup fails.
    const firstCoord = stats.coordinates[0];
    const geoTimezone = firstCoord
      ? getVenueTimezone(firstCoord[1], firstCoord[0])
      : null;
    const trackTimezone = geoTimezone ?? sanitizeTimezone(req.body?.timezone);

    // Reject duplicate uploads without touching the database
    const existing = await query(
      'SELECT id, name FROM tracks WHERE user_id = $1 AND file_hash = $2 LIMIT 1',
      [USER_ID, fileHash]
    );

    if (existing.rows.length > 0) {
      const dup = existing.rows[0];
      return res.status(409).json({
        error: 'This track is a duplicate',
        duplicate: { id: dup.id, name: dup.name },
      });
    }

    const result = await query(
      `INSERT INTO tracks (
         user_id, name, activity_type, timezone, started_at, ended_at,
         distance_m, elapsed_time_s, moving_time_s,
         elevation_gain_m, avg_speed_mps, max_speed_mps,
         avg_hr, max_hr, point_count, file_hash, path, points
       )
       VALUES (
         $1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
         $7, $8, $9,
         $10, $11, $12,
         $13, $14, $15, $16,
         ST_SetSRID(ST_GeomFromText($17), 4326),
         $18::jsonb
       )
       RETURNING *`,
      [
        USER_ID,
        stats.name,
        stats.activityType,
        trackTimezone,
        stats.startedAt.toISOString(),
        stats.endedAt.toISOString(),
        stats.distanceM,
        stats.elapsedTimeS,
        stats.movingTimeS,
        stats.elevationGainM,
        stats.avgSpeedMps,
        stats.maxSpeedMps,
        stats.avgHr,
        stats.maxHr,
        stats.pointCount,
        fileHash,
        stats.wktLineString,
        JSON.stringify(stats.points),
      ]
    );

    // Keep a copy of the original uploaded file for the user
    storeUploadedTrack(USER_ID, tempFilePath!, result.rows[0].id, ext);
    tempFilePath = undefined;

    res.status(201).json(trackRowToApi(result.rows[0]));
  } catch (err: any) {
    if (err instanceof Error && /Invalid (GPX|TCX)|could not parse/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    // Race: the unique (user_id, file_hash) index caught a concurrent duplicate
    if (err?.code === '23505') {
      const existing = await query(
        'SELECT id, name FROM tracks WHERE user_id = $1 AND file_hash = $2 LIMIT 1',
        [USER_ID, fileHash]
      );
      const dup = existing.rows[0];
      return res.status(409).json({
        error: 'This track is a duplicate',
        duplicate: dup ? { id: dup.id, name: dup.name } : undefined,
      });
    }
    console.error('Error creating track:', err);
    res.status(500).json({ error: 'Failed to create track' });
  } finally {
    if (tempFilePath) {
      fs.unlink(tempFilePath, () => {});
    }
  }
});

// PUT /:id - update editable track fields (name, activity_type)
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, activity_type } = req.body ?? {};

    const sets: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      if (trimmed.length > 200) {
        return res.status(400).json({ error: 'Name is too long (max 200 characters)' });
      }
      sets.push(`name = $${paramIndex}`);
      params.push(trimmed);
      paramIndex++;
    }

    if (activity_type !== undefined) {
      const trimmed = String(activity_type ?? '').trim();
      if (trimmed.length > 100) {
        return res.status(400).json({ error: 'Activity type is too long (max 100 characters)' });
      }
      sets.push(`activity_type = $${paramIndex}`);
      params.push(trimmed || null);
      paramIndex++;
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    const result = await query(
      `UPDATE tracks SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING id`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Re-fetch with geometry/points so the response matches the GET /:id
    // shape (trackRowToApi alone omits them, which would blank out the map
    // and graph on the client after an edit).
    res.json(await fetchTrackFull(id));
  } catch (err) {
    console.error('Error updating track:', err);
    res.status(500).json({ error: 'Failed to update track' });
  }
});

// POST /:id/trim - remove points from the start and/or end of the track and
// recompute all derived stats from the remaining points. `start_index` and
// `end_index` are inclusive, 0-based indices into the track's point array.
router.post('/:id/trim', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const startIndex = Number(req.body?.start_index);
    const endIndex = Number(req.body?.end_index);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
      return res.status(400).json({
        error: 'start_index and end_index must be integers',
      });
    }

    const track = await fetchTrackFull(id);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const coordinates: [number, number][] = track.geometry ?? [];
    const points: { t: number | null; ele: number | null; hr: number | null }[] | null =
      track.points;
    if (!points || points.length !== coordinates.length || coordinates.length < 2) {
      return res.status(409).json({
        error:
          'This track has no per-point data, so it can\u2019t be trimmed. Re-upload the GPX file to enable trimming.',
      });
    }

    const n = coordinates.length;
    if (startIndex < 0 || endIndex >= n || startIndex > endIndex) {
      return res.status(400).json({
        error: `Invalid range: indices must satisfy 0 <= start_index <= end_index < ${n}`,
      });
    }
    if (endIndex - startIndex + 1 < 2) {
      return res.status(400).json({ error: 'A track must keep at least 2 points' });
    }

    const gpxPoints: GpxPoint[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const [lon, lat] = coordinates[i];
      const p = points[i];
      gpxPoints.push({
        lat,
        lon,
        ele: p.ele,
        time: p.t != null ? new Date(p.t) : null,
        hr: p.hr,
      });
    }

    let stats;
    try {
      stats = computeTrackStats(gpxPoints, track.name, track.activity_type);
    } catch (err: any) {
      return res.status(400).json({
        error: err?.message || 'Could not recompute track stats',
      });
    }

    await query(
      `UPDATE tracks SET
         started_at = $1::timestamptz, ended_at = $2::timestamptz,
         distance_m = $3, elapsed_time_s = $4, moving_time_s = $5,
         elevation_gain_m = $6, avg_speed_mps = $7, max_speed_mps = $8,
         avg_hr = $9, max_hr = $10, point_count = $11,
         path = ST_SetSRID(ST_GeomFromText($12), 4326),
         points = $13::jsonb,
         updated_at = NOW()
       WHERE id = $14`,
      [
        stats.startedAt.toISOString(),
        stats.endedAt.toISOString(),
        stats.distanceM,
        stats.elapsedTimeS,
        stats.movingTimeS,
        stats.elevationGainM,
        stats.avgSpeedMps,
        stats.maxSpeedMps,
        stats.avgHr,
        stats.maxHr,
        stats.pointCount,
        stats.wktLineString,
        JSON.stringify(stats.points),
        id,
      ]
    );

    res.json(await fetchTrackFull(id));
  } catch (err) {
    console.error('Error trimming track:', err);
    res.status(500).json({ error: 'Failed to trim track' });
  }
});

// GET /:id/download - download the track as GPX, generated from the current
// database state so it reflects any modifications to the track or details
router.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT t.name, t.activity_type, t.point_count,
              ST_AsGeoJSON(t.path) AS geojson,
              t.points
       FROM tracks t
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const row = result.rows[0];
    let coordinates: [number, number][] = [];
    try {
      const gj = typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson;
      if (gj?.type === 'LineString' && Array.isArray(gj.coordinates)) {
        coordinates = gj.coordinates;
      }
    } catch {
      // leave empty
    }

    if (coordinates.length < 2) {
      return res.status(400).json({ error: 'Track has no geometry to export' });
    }

    const points =
      typeof row.points === 'string' ? JSON.parse(row.points) : row.points ?? null;

    const exportTrack = {
      id: row.id,
      name: row.name,
      activityType: row.activity_type ?? null,
      coordinates,
      points: Array.isArray(points) ? points : null,
    };

    const filename = gpxDownloadFilename(exportTrack);
    res.setHeader('Content-Type', 'application/gpx+xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buildGpx(exportTrack));
  } catch (err) {
    console.error('Error downloading track:', err);
    res.status(500).json({ error: 'Failed to download track' });
  }
});

// DELETE /:id - delete track
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM tracks WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }

    deleteStoredTrack(USER_ID, String(id));

    res.json({ message: 'Track deleted', id });
  } catch (err) {
    console.error('Error deleting track:', err);
    res.status(500).json({ error: 'Failed to delete track' });
  }
});

export const tracksRouter = router;
