import { Router, Request, Response } from 'express';
import { query } from '../db';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { findOrReuseVenue } from '../services/venueMerge';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

const csvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-import');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});

const csvUpload = multer({
  storage: csvStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Find or create a venue from Swarm CSV data
async function findOrCreateVenue(
  venueName: string,
  lat: number,
  lng: number,
  swarmVenueId: string | null
): Promise<string> {
  const venue = await findOrReuseVenue({
    name: venueName,
    latitude: lat,
    longitude: lng,
    swarm_venue_id: swarmVenueId,
  });

  return venue.id;
}

// POST / - import Swarm CSV files
router.post('/', csvUpload.array('files', 100), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No CSV files provided' });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    for (const file of files) {
      const content = fs.readFileSync(file.path, 'utf-8');

      // The Swarm CSV export has repeated header rows between records.
      // Split by lines, find all header rows, and parse each block.
      const lines = content.split('\n');
      let currentHeaders: string[] = [];
      const records: Record<string, string>[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Parse the line as CSV
        let parsed: string[][];
        try {
          parsed = parse(trimmed, { relax_column_count: true, trim: true });
        } catch {
          continue;
        }

        if (parsed.length === 0 || parsed[0].length === 0) continue;
        const row = parsed[0];

        // Detect header row: starts with "id" as first field
        if (row[0] === 'id') {
          currentHeaders = row;
          continue;
        }

        // Data row — map to object using current headers
        if (currentHeaders.length > 0) {
          const record: Record<string, string> = {};
          for (let i = 0; i < currentHeaders.length && i < row.length; i++) {
            record[currentHeaders[i]] = row[i];
          }
          records.push(record);
        }
      }

      for (const row of records) {
        try {
          const swarmId = row['id'];
          const venueName = row['venue.name'];
          const lat = parseFloat(row['lat']);
          const lng = parseFloat(row['lng']);
          const createdAt = row['createdAt'];
          const shout = row['shout'] || null;
          const swarmVenueId = row['venue.id'] || null;

          if (!swarmId || !venueName || isNaN(lat) || isNaN(lng) || !createdAt) {
            skipped++;
            continue;
          }

          // Check for duplicate by swarm_id
          const existing = await query(
            'SELECT id FROM checkins WHERE swarm_id = $1',
            [swarmId]
          );
          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          const venueId = await findOrCreateVenue(venueName, lat, lng, swarmVenueId);

          await query(
            `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, swarm_id)
             VALUES ($1, $2, $3, $4::timestamptz, $5)`,
            [USER_ID, venueId, shout, createdAt, swarmId]
          );

          imported++;
        } catch (rowErr: any) {
          errors.push(`Row error (id=${row['id']}): ${rowErr.message || rowErr}`);
          skipped++;
        }
      }

      // Clean up temp file
      try {
        fs.unlinkSync(file.path);
      } catch { /* ignore */ }
    }

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err: any) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message || String(err) });
  }
});

export const importRouter = router;
