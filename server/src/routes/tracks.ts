import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { parseGpx } from '../services/gpx';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

const trackStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-tracks');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, _file, cb) => {
    cb(null, `${uuidv4()}.gpx`);
  },
});

const trackUpload = multer({
  storage: trackStorage,
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/gpx+xml' ||
      file.mimetype === 'text/xml' ||
      file.mimetype === 'application/xml' ||
      file.originalname.toLowerCase().endsWith('.gpx')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .gpx files are allowed'));
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

function trackRowToApi(row: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
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
  SELECT t.id, t.user_id, t.name, t.timezone,
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

// GET /:id - get single track with geometry (GeoJSON coordinates)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT t.id, t.user_id, t.name, t.timezone,
              t.started_at, t.ended_at,
              t.distance_m, t.elapsed_time_s, t.moving_time_s,
              t.elevation_gain_m, t.avg_speed_mps, t.max_speed_mps,
              t.avg_hr, t.max_hr, t.point_count,
              t.created_at, t.updated_at,
              ST_AsGeoJSON(t.path) AS geojson
       FROM tracks t
       WHERE t.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Track not found' });
    }

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

    res.json(api);
  } catch (err) {
    console.error('Error getting track:', err);
    res.status(500).json({ error: 'Failed to get track' });
  }
});

// POST / - upload a .gpx file and create a track
router.post('/', trackUpload.single('file'), async (req: Request, res: Response) => {
  const filePath = (req.file as any)?.path;
  let fileHash = '';
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'A .gpx file is required' });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const xml = fileBuffer.toString('utf-8');
    const fallbackName = (req.file as any).originalname
      .replace(/\.gpx$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Track';

    const stats = parseGpx(xml, fallbackName);

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
         user_id, name, timezone, started_at, ended_at,
         distance_m, elapsed_time_s, moving_time_s,
         elevation_gain_m, avg_speed_mps, max_speed_mps,
         avg_hr, max_hr, point_count, file_hash, path
       )
       VALUES (
         $1, $2, $3, $4::timestamptz, $5::timestamptz,
         $6, $7, $8,
         $9, $10, $11,
         $12, $13, $14, $15,
         ST_SetSRID(ST_GeomFromText($16), 4326)
       )
       RETURNING *`,
      [
        USER_ID,
        stats.name,
        sanitizeTimezone(req.body?.timezone),
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
      ]
    );

    res.status(201).json(trackRowToApi(result.rows[0]));
  } catch (err: any) {
    if (err instanceof Error && /Invalid GPX|could not parse/.test(err.message)) {
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
    if (filePath) {
      fs.unlink(filePath, () => {});
    }
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

    res.json({ message: 'Track deleted', id });
  } catch (err) {
    console.error('Error deleting track:', err);
    res.status(500).json({ error: 'Failed to delete track' });
  }
});

export const tracksRouter = router;
