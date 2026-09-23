/**
 * Tracks check-in type — server half.
 *
 * CUSTOM storage: Tracks keeps its pre-existing `tracks` table (PostGIS
 * LINESTRING geometry plus a per-point JSONB series) and the on-disk
 * originals under `<dataDir>/<userId>/uploads/gps_tracks/`. The framework
 * uses this half for the unified timeline, backups, start-over, and mounts
 * the plugin-owned API router at /api/v1/tracks (unchanged URL).
 *
 * This plugin owns ALL track-specific API surface (upload, list, map data,
 * detail, edit, trim, GPX download, delete) — no track-specific routes or
 * services live in the core platform. Track parsing math (GPX/TCX parsing,
 * stats, GPX export) and file storage live in this plugin's `services/`.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type {
  CheckinTypeServerPlugin,
  PluginLlmRow,
  PluginTimelineContext,
} from 'wwp-shared';
import { query, pool } from '../../server/src/db';
import { config } from '../../server/src/config';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { getVenueTimezone } from '../location/services/geoTimezone';
import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';

import {
  computeTrackStats,
  parseTrackFile,
  parseTrackPoints,
  type GpxPoint,
  type GpxPointSeries,
} from './services/gpx';
import {
  backupTrackFilename,
  buildGpx,
  deleteStoredTrack,
  deriveActivityTypeFromFilename,
  gpxDownloadFilename,
  storeUploadedTrack,
  storedTrackPath,
  type GpxExportTrack,
} from './services/trackFiles';
import { findTrimRange, sliceTrackPoints } from './services/trackBackup';

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/tracks
// (moved from server/src/routes/tracks.ts; behavior unchanged)
// ---------------------------------------------------------------------------

const tracksRouter = Router();

const trackStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-tracks');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, _file, cb) => {
    const ext =
      (path.extname(_file.originalname).toLowerCase() === '.tcx' && '.tcx') || '.gpx';
    cb(null, crypto.randomUUID() + ext);
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
tracksRouter.get('/', async (req: Request, res: Response) => {
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
tracksRouter.get('/map-data', async (req: Request, res: Response) => {
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
tracksRouter.get('/activity-types', async (req: Request, res: Response) => {
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
tracksRouter.get('/:id', async (req: Request, res: Response) => {
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
tracksRouter.post('/', trackUpload.single('file'), async (req: Request, res: Response) => {
  const filePath = (req.file as any)?.path;
  let tempFilePath: string | undefined = filePath;
  let fileHash = '';
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'A .gpx or .tcx file is required' });
    }

    const fileBuffer = fs.readFileSync(filePath);
    fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
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
         avg_hr, max_hr, point_count, file_hash, source_filename, path, points
       )
       VALUES (
         $1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
         $7, $8, $9,
         $10, $11, $12,
         $13, $14, $15, $16, $17,
         ST_SetSRID(ST_GeomFromText($18), 4326),
         $19::jsonb
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
        path.basename(originalName) || null,
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
tracksRouter.put('/:id', async (req: Request, res: Response) => {
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
tracksRouter.post('/:id/trim', async (req: Request, res: Response) => {
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
tracksRouter.get('/:id/download', async (req: Request, res: Response) => {
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
tracksRouter.delete('/:id', async (req: Request, res: Response) => {
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

// ---------------------------------------------------------------------------
// Plugin hooks
// ---------------------------------------------------------------------------

/** Shared column shape for backup export/import and legacy restore. */
interface TrackBackupRow {
  id: string;
  user_id: string;
  name: string;
  activity_type: string | null;
  timezone: string;
  started_at: string;
  ended_at: string;
  distance_m: number | string;
  elapsed_time_s: number | string;
  moving_time_s: number | string;
  elevation_gain_m: number | string;
  avg_speed_mps: number | string;
  max_speed_mps: number | string;
  avg_hr: number | null;
  max_hr: number | null;
  point_count: number | string;
  file_hash: string | null;
  /** [lng, lat] per point, or null for tracks without geometry */
  geometry: [number, number][] | null;
  /** Per-point series (t in epoch ms), or null for legacy tracks */
  points: { t: number | null; ele: number | null; hr: number | null }[] | null;
  created_at: string;
  updated_at: string;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length > 0 ? s : null;
}

/**
 * Parse the GeoJSON LineString stored on a track row (either as a JSON string
 * or an already-decoded object) into [lng, lat] coordinates.
 */
function geojsonToCoordinates(geojson: unknown): [number, number][] | null {
  try {
    const gj = typeof geojson === 'string' ? JSON.parse(geojson) : geojson;
    if (gj?.type === 'LineString' && Array.isArray(gj.coordinates)) {
      return gj.coordinates as [number, number][];
    }
  } catch {
    // fall through
  }
  return null;
}

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  // The framework mounts this at /api/v1/tracks (the pre-plugin URL).
  api: [{ mount: '/tracks', router: tracksRouter }],

  // ------------------------------------------------------------------
  // Unified timeline
  // ------------------------------------------------------------------

  // Keeps the pre-plugin wire shape of the old built-in 'track' branch
  // (track_* columns consumed by the track timeline card). The `type`
  // literal changes from 'track' to the plugin id 'tracks'.
  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'tracks'`,
        id: 't.id',
        user_id: 't.user_id',
        notes: 't.name',
        checked_in_at: 't.started_at',
        created_at: 't.created_at',
        track_name: 't.name',
        track_distance_m: 't.distance_m',
        track_timezone: 't.timezone',
        track_started_at: 't.started_at',
        track_ended_at: 't.ended_at',
        track_elapsed_time_s: 't.elapsed_time_s',
        timezone: 't.timezone',
      })}
      FROM tracks t
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 't',
      timestampColumn: 'started_at',
      timezoneColumn: 'timezone',
      search: (c, q) => c.push(`t.name ILIKE '%' || ? || '%'`, q),
    });
    if (ctx.filterParams.track_activity) {
      conds.push(`t.activity_type ILIKE ?`, ctx.filterParams.track_activity);
    }
    return conds.build();
  },

  // ------------------------------------------------------------------
  // Backups
  // ------------------------------------------------------------------

  // Old backups (pre-plugin) store tracks under the top-level `tracks` key;
  // when a backup carries a plugins.tracks payload the framework restores via
  // backupImport and skips the legacy key.
  legacyBackupKeys: ['tracks'],

  backupExport: async ({ user_id }) => {
    // Start a fresh export plan (a stale plan from a previous export is
    // discarded and its staged temp dir removed).
    if (trackBackupPlan?.userId === user_id && trackBackupPlan.plan.tempDir) {
      removeTrackBackupPlanDir(trackBackupPlan.plan);
    }
    trackBackupPlan = {
      userId: user_id,
      plan: { files: new Map<string, string>(), tempDir: null },
    };

    const result = await query(
      `SELECT id, user_id, name, activity_type, timezone,
              started_at, ended_at,
              distance_m::float, elapsed_time_s::int, moving_time_s::int,
              elevation_gain_m::float, avg_speed_mps::float, max_speed_mps::float,
              avg_hr, max_hr, point_count::int, file_hash, source_filename,
              ST_AsGeoJSON(path) AS geojson,
              points,
              created_at, updated_at
       FROM tracks
       WHERE user_id = $1
       ORDER BY started_at ASC`,
      [user_id],
    );
    const plan = trackBackupPlan.plan;
    // Bundle-wide filename de-duplication (original names may collide).
    const usedFilenames = new Set<string>();
    return result.rows.map((row: any) => {
      const base = {
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
        file_hash: row.file_hash ?? null,
        source_filename: row.source_filename ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      const trackFilename = backupTrackFilename(
        {
          sourceFilename: row.source_filename ?? null,
          name: row.name,
          startedAt: row.started_at,
          timezone: row.timezone,
        },
        usedFilenames,
      );

      // Backup v2: ship an ORIGINAL file (see backupFiles) plus a trim
      // range, instead of inlining the full geometry + per-point series:
      //   1. Stored upload exists and matches the stored points -> ship it
      //      with the trim range.
      //   2. Otherwise (v1-restored tracks, deleted originals, swapped
      //      files) -> generate a GPX from the current DB state and ship
      //      it with trim: null (restore re-parses + recomputes stats, so
      //      a generated file round-trips exactly).
      //   3. Legacy rows without per-point data cannot be expressed as a
      //      point-based file: keep the v1 inline geometry/points shape
      //      (restore still accepts it).
      const storedPoints = Array.isArray(row.points) ? (row.points as GpxPointSeries[]) : null;
      const coordinates = geojsonToCoordinates(row.geojson) ?? [];

      if (
        coordinates.length >= 2 &&
        storedPoints &&
        storedPoints.length === coordinates.length
      ) {
        const original = readStoredTrackForBackup(user_id, String(row.id));
        if (original) {
          const range = findTrimRange(original.points, coordinates, storedPoints);
          if (range) {
            const full = range.start === 0 && range.end === original.points.length - 1;
            const zipPath = `files/${trackFilename}`;
            plan.files.set(zipPath, original.absPath);
            return {
              ...base,
              file: zipPath,
              trim: full ? null : { start_index: range.start, end_index: range.end },
            };
          }
        }

        // Original missing or mismatched: stage a generated GPX.
        const zipPath = `files/${trackFilename}`;
        const staged = stageGeneratedTrackGpx(
          plan,
          {
            id: String(row.id),
            name: row.name,
            activityType: row.activity_type ?? null,
            coordinates,
            points: storedPoints,
          },
          trackFilename,
        );
        plan.files.set(zipPath, staged);
        return {
          ...base,
          file: zipPath,
          trim: null,
        };
      }

      return {
        ...base,
        geometry: coordinates.length > 0 ? coordinates : null,
        points: storedPoints,
      };
    });
  },

  /**
   * Backup v2: the original files this user's tracks should ship. Returns
   * exactly the files referenced by this export's backupExport rows (the
   * framework runs backupExport before backupFiles), plus the staging dir
   * for any generated files.
   */
  backupFiles: async ({ user_id }) => {
    if (!trackBackupPlan || trackBackupPlan.userId !== user_id) {
      return { files: [], tempDir: undefined };
    }
    const plan = trackBackupPlan.plan;
    trackBackupPlan = null; // consumed by this call
    const files = [...plan.files.entries()].map(([zipPath, absPath]) => ({ zipPath, absPath }));
    return { files, tempDir: plan.tempDir ?? undefined };
  },

  backupImport: async ({ user_id, client: txClient, filesDir, errors }, payload) => {
    const rows = Array.isArray(payload) ? (payload as Record<string, any>[]) : [];
    let inserted = 0;
    // Originals restored for file-based rows; their on-disk copies are placed
    // only after the whole transaction commits (restoredFiles is consumed by
    // a post-commit pass in this hook's caller — see note below).
    const restoredFiles: { trackId: string; source: string; ext: string }[] = [];

    // Use the framework's transaction client when provided so restore stays
    // atomic; open our own connection only when running standalone.
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    try {
      for (const row of rows) {
        if (!row?.id || !row.name) continue;

        let insertedCount: number;
        if (typeof row.file === 'string' && filesDir) {
          const outcome = await insertTrackRowFromFile(client, user_id, row, filesDir, errors ?? []);
          insertedCount = outcome.insertedCount;
          if (outcome.insertedCount > 0) {
            restoredFiles.push({
              trackId: String(row.id),
              source: path.join(filesDir, row.file),
              ext: outcome.ext,
            });
          }
        } else {
          insertedCount = await insertTrackRow(client, user_id, row);
        }
        if (insertedCount > 0) inserted++;
      }
    } finally {
      if (ownsClient) client.release();
    }

    // Place restored originals on disk (inside the caller's transaction —
    // file placement is inherently non-transactional, same pattern as the
    // upload route; if a later plugin rolls the transaction back the copied
    // files are simply orphaned and overwritten by the next restore).
    for (const f of restoredFiles) {
      try {
        storeUploadedTrack(user_id, f.source, f.trackId, f.ext);
      } catch {
        errors?.push(`Could not restore the original file for track "${f.trackId}"`);
      }
    }

    return inserted;
  },

  /**
   * Legacy backup restore (backups without a `plugins.tracks` payload keep
   * track rows under the top-level `tracks` key). Behavior mirrors the
   * pre-plugin core import loop.
   */
  restoreLegacyBackup: async ({ user_id, client: txClient }, data) => {
    const client = txClient ?? null;
    const counts = { tracks: { inserted: 0, skipped: 0 } };
    const rows = Array.isArray(data.tracks) ? (data.tracks as Record<string, any>[]) : [];

    for (const row of rows) {
      if (!row?.id || !row.name) {
        counts.tracks.skipped += 1;
        continue;
      }
      const run = (sql: string, values: unknown[]) =>
        client ? client.query(sql, values) : query(sql, values);
      const insertedCount = await insertTrackRow({ query: run } as never, user_id, row);
      if (insertedCount === 1) counts.tracks.inserted += 1;
      else counts.tracks.skipped += 1;
    }

    return counts;
  },

  deleteUserData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const result = await run(
      'DELETE FROM tracks WHERE user_id = $1 RETURNING id',
      [user_id],
    );
    // Remove each deleted track's uploaded original from disk.
    for (const row of result.rows) {
      deleteStoredTrack(user_id, String(row.id));
    }
    return result.rowCount ?? 0;
  },

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo (Immich) / scrobble (Maloja) anchor timestamps: replace the
  // hard-coded tracks UNION branches in those core routes.
  resolveTimestamps: () => ({
    sql: 'SELECT id, started_at AS checked_in_at FROM tracks WHERE id = ANY($1::uuid[])',
  }),

  // "This day in previous years" reflection branch. Emits the shared
  // reflection envelope (matching the location/mood/sleep branches) so the
  // UNION in /stats/reflections lines up; the track payload lives in `data`
  // for the plugin's reflection card.
  reflectionBranch: () => ({
    sql: `
      SELECT
        'tracks' AS type,
        t.id,
        t.started_at AS checked_in_at,
        NULL::text AS note,
        NULL::uuid AS venue_id,
        NULL::text AS venue_name,
        NULL::text AS city,
        NULL::text AS country,
        NULL::double precision AS latitude,
        NULL::double precision AS longitude,
        NULL::text AS venue_category,
        NULL::text AS venue_timezone,
        EXTRACT(YEAR FROM t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::int
        )::int AS years_ago,
        json_build_object(
          'name', t.name,
          'activity_type', t.activity_type,
          'started_at', t.started_at,
          'ended_at', t.ended_at,
          'timezone', t.timezone,
          'distance_m', t.distance_m::float,
          'elapsed_time_s', t.elapsed_time_s::int
        )::jsonb AS data
      FROM tracks t
      WHERE t.user_id = $1
        AND TO_CHAR(t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM t.started_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // Earliest check-in date for the "all time" period selector. Replaces the
  // built-in `tracks` entry (same key, same SQL).
  earliestDate: () => ({
    sql: `SELECT MIN(DATE(started_at AT TIME ZONE COALESCE(timezone, 'UTC')))::text AS date
          FROM tracks WHERE user_id = $1`,
  }),

  // LLM life summary contribution (replaces the hard-coded tracks query and
  // line formatting in the core llm route).
  llm: {
    label: 'tracks',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT started_at AS checked_in_at,
                timezone,
                json_build_object(
                  'name', name,
                  'activity_type', activity_type,
                  'started_at', started_at,
                  'distance_m', distance_m::float,
                  'elapsed_time_s', elapsed_time_s::int
                )::jsonb AS data
         FROM tracks
         WHERE user_id = $1
           AND (started_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date >= $2::date
           AND (started_at AT TIME ZONE COALESCE(timezone, 'UTC'))::date <= $3::date
         ORDER BY started_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row: PluginLlmRow) => {
      const d = row.data as {
        name: string;
        activity_type: string | null;
        started_at: string;
        distance_m: number;
        elapsed_time_s: number;
      };
      const when = formatLlmWhen(d.started_at, row.timezone);
      const type = d.activity_type ? `${d.activity_type} ` : '';
      return [
        `- ${when} — ${type}track "${d.name}": ${formatDistance(Number(d.distance_m))} in ${formatTrackDuration(Number(d.elapsed_time_s))}`,
      ];
    },
  },

  // Timestamp reconciliation participation. Tracks are fallback ANCHORS for
  // other check-in types (anchorLabel); with scanAll: false only rows stored
  // without a timezone or with a UTC label become scan candidates, matching
  // the pre-plugin behavior where tracks were never scanned.
  reconcile: {
    anchorLabel: 'a track',
    scanAll: false,
    detailPath: (id) => `/tracks/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT id,
                started_at AS checked_in_at,
                timezone AS original_timezone
         FROM tracks
         WHERE user_id = $1
         ORDER BY started_at ASC`,
        [user_id],
      );
      return result.rows;
    },
    apply: async (id, suggested_timezone) => {
      // Label-only: the stored instant is the true moment; reconciliation
      // only corrects the stored timezone label.
      const result = await query(
        `UPDATE tracks
         SET timezone = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, suggested_timezone],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },
};

/**
 * Read + parse a user's stored original track file for backup export.
 * Returns the parsed points + the file extension + the path, or null when
 * the original is missing or unparsable (the caller generates a GPX from
 * the current database state instead).
 */
function readStoredTrackForBackup(
  userId: string,
  trackId: string,
): { points: GpxPoint[]; ext: string; absPath: string } | null {
  const path = storedTrackPath(userId, trackId);
  if (!path) return null;
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  if (ext !== '.gpx' && ext !== '.tcx') return null;
  try {
    const xml = fs.readFileSync(path, 'utf-8');
    const points = parseTrackPoints(xml, ext);
    if (points.length < 2) return null;
    return { points, ext, absPath: path };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backup v2 file staging
//
// backupExport decides, per row, which file to ship; backupFiles (run by the
// framework immediately afterwards) returns the accumulated file list. The
// plan is module state keyed by user (the framework calls the hooks
// sequentially per export).
// ---------------------------------------------------------------------------

interface TrackBackupFilePlan {
  /** zipPath (e.g. "files/<id>.gpx") -> absolute source path */
  files: Map<string, string>;
  /** Staging dir for generated files, or null when none were generated. */
  tempDir: string | null;
}

let trackBackupPlan: { userId: string; plan: TrackBackupFilePlan } | null = null;

function removeTrackBackupPlanDir(plan: TrackBackupFilePlan): void {
  if (plan.tempDir) {
    try {
      fs.rmSync(plan.tempDir, { recursive: true, force: true });
    } catch {
      // Best effort; the export route's finally-block also cleans up.
    }
    plan.tempDir = null;
  }
}

/**
 * Generate a GPX from the track's current database state and stage it for
 * the backup bundle. Used when the original uploaded file is missing or no
 * longer matches the stored points (e.g. tracks restored from a v1 backup,
 * which never shipped originals). The restore side re-parses the file and
 * recomputes stats, so a generated file round-trips the current state
 * exactly.
 */
function stageGeneratedTrackGpx(
  plan: TrackBackupFilePlan,
  track: GpxExportTrack,
  filename: string,
): string {
  if (!plan.tempDir) {
    plan.tempDir = fs.mkdtempSync(path.join(config.dataDir, 'tracks-backup-'));
  }
  const absPath = path.join(plan.tempDir, filename);
  fs.writeFileSync(absPath, buildGpx(track));
  return absPath;
}

/**
 * Insert one track row from a backup payload row (new-format backupImport or
 * legacy restore share the same statement). Returns the row count (1 when the
 * row was inserted, 0 when skipped/conflicting).
 */
async function insertTrackRow(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }> },
  user_id: string,
  row: Record<string, any>,
): Promise<number> {
  if (!row?.id || !row.name) return 0;

  const coords = (Array.isArray(row.geometry) ? row.geometry : [])
    .filter((c: unknown) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (coords.length < 2) return 0;

  const wktLineString = `LINESTRING(${coords.map(([lng, lat]) => `${lng} ${lat}`).join(', ')})`;

  const pointsJson =
    Array.isArray(row.points) && row.points.length > 0
      ? JSON.stringify(row.points)
      : null;

  const result = await client.query(
    `INSERT INTO tracks (
       id, user_id, name, activity_type, timezone, started_at, ended_at,
       distance_m, elapsed_time_s, moving_time_s,
       elevation_gain_m, avg_speed_mps, max_speed_mps,
       avg_hr, max_hr, point_count, file_hash, source_filename,
       created_at, updated_at,
       path, points
     )
     VALUES (
       $1, $2, $3, $4, $5,
       COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()),
       $8, $9, $10,
       $11, $12, $13,
       $14, $15, $16, $17, $18,
       COALESCE($19::timestamptz, NOW()), COALESCE($20::timestamptz, NOW()),
       ST_SetSRID(ST_GeomFromText($21), 4326),
       $22::jsonb
     )
     ON CONFLICT (id) DO NOTHING`,
    [
      row.id,
      user_id,
      row.name,
      toStringOrNull(row.activity_type),
      row.timezone || 'UTC',
      row.started_at || null,
      row.ended_at || null,
      toNumber(row.distance_m),
      Math.round(toNumber(row.elapsed_time_s)),
      Math.round(toNumber(row.moving_time_s)),
      toNumber(row.elevation_gain_m),
      toNumber(row.avg_speed_mps),
      toNumber(row.max_speed_mps),
      row.avg_hr == null ? null : Math.round(toNumber(row.avg_hr)),
      row.max_hr == null ? null : Math.round(toNumber(row.max_hr)),
      Math.round(toNumber(row.point_count)),
      toStringOrNull(row.file_hash),
      toStringOrNull(row.source_filename),
      row.created_at || null,
      row.updated_at || null,
      wktLineString,
      pointsJson,
    ]
  );
  return result.rowCount ?? 0;
}

/**
 * Backup v2, file-based restore of one track row: read the original
 * GPX/TCX from the bundle, apply the trim range, recompute all derived
 * stats, and insert the row. Derived values are always recomputed from the
 * original file (the backup row's stats are informational only); the
 * editable row fields (name, activity_type, timezone, file_hash,
 * timestamps) come from the backup.
 */
async function insertTrackRowFromFile(
  client: { query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }> },
  user_id: string,
  row: Record<string, any>,
  filesDir: string,
  errors: string[],
): Promise<{ insertedCount: number; ext: string }> {
  const relFile: string = row.file;
  const ext = path.extname(relFile).toLowerCase() || '.gpx';
  const sourcePath = path.resolve(filesDir, relFile);

  // Defense in depth: the file must live under the plugin's filesDir.
  if (!sourcePath.startsWith(path.resolve(filesDir) + path.sep) || !fs.existsSync(sourcePath)) {
    errors.push(`Track "${row.name}": original file ${relFile} missing from backup; skipped`);
    return { insertedCount: 0, ext };
  }

  let original: GpxPoint[];
  try {
    original = parseTrackPoints(fs.readFileSync(sourcePath, 'utf-8'), ext);
  } catch {
    errors.push(`Track "${row.name}": original file ${relFile} could not be parsed; skipped`);
    return { insertedCount: 0, ext };
  }

  const range = row.trim && typeof row.trim === 'object'
    ? {
        start: Math.max(0, toNumber(row.trim.start_index, 0)),
        end: Math.min(original.length - 1, toNumber(row.trim.end_index, original.length - 1)),
      }
    : null;
  const points = sliceTrackPoints(original, range);
  if (points.length < 2) {
    errors.push(`Track "${row.name}": trimmed range leaves fewer than 2 points; skipped`);
    return { insertedCount: 0, ext };
  }

  let stats;
  try {
    stats = computeTrackStats(points, String(row.name), toStringOrNull(row.activity_type));
  } catch {
    errors.push(`Track "${row.name}": could not recompute stats from original file; skipped`);
    return { insertedCount: 0, ext };
  }

  const pointsSeries: GpxPointSeries[] = points.map((p) => ({
    t: p.time ? p.time.getTime() : null,
    ele: p.ele,
    hr: p.hr,
  }));
  const wktLineString =
    `LINESTRING(` + stats.coordinates.map(([lng, lat]) => `${lng} ${lat}`).join(', ') + `)`;

  try {
    const result = await client.query(
      `INSERT INTO tracks (
         id, user_id, name, activity_type, timezone, started_at, ended_at,
         distance_m, elapsed_time_s, moving_time_s,
         elevation_gain_m, avg_speed_mps, max_speed_mps,
         avg_hr, max_hr, point_count, file_hash, source_filename,
         created_at, updated_at, path, points
       )
       VALUES (
         $1, $2, $3, $4, $5,
         COALESCE($6::timestamptz, NOW()), COALESCE($7::timestamptz, NOW()),
         $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
         COALESCE($19::timestamptz, NOW()), COALESCE($20::timestamptz, NOW()),
         ST_SetSRID(ST_GeomFromText($21), 4326), $22::jsonb
       )
       ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        user_id,
        row.name,
        toStringOrNull(row.activity_type),
        row.timezone || 'UTC',
        row.started_at || null,
        row.ended_at || null,
        stats.distanceM,
        stats.elapsedTimeS,
        stats.movingTimeS,
        stats.elevationGainM,
        stats.avgSpeedMps,
        stats.maxSpeedMps,
        stats.avgHr,
        stats.maxHr,
        stats.pointCount,
        toStringOrNull(row.file_hash),
        toStringOrNull(row.source_filename),
        row.created_at || null,
        row.updated_at || null,
        wktLineString,
        JSON.stringify(pointsSeries),
      ],
    );
    return { insertedCount: result.rowCount ?? 0, ext };
  } catch (err: any) {
    if (err?.code === '23505') {
      // Duplicate (user_id, file_hash): the same original already exists.
      errors.push(`Track "${row.name}": an identical track already exists; skipped`);
      return { insertedCount: 0, ext };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// LLM line formatting (moved from server/src/routes/llm.ts)
// ---------------------------------------------------------------------------

function formatLlmWhen(iso: string | Date, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
}

function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatTrackDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
