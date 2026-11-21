/** /import/swarm — Swarm (Foursquare) CSV export import. */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { query } from '../../../server/src/db';
import { currentUserId } from '../../../server/src/auth/context';
import { createImportUpload, removeImportFile } from '../../../server/src/plugins/uploads';
import { findOrReuseVenue } from '../services/venueMerge';
import { inferVenueTimezone } from './helpers';

export const swarmImportRouter = Router();

const csvUpload = createImportUpload({
  fileFilter: (file) =>
    file.mimetype === 'text/csv' || file.originalname.endsWith('.csv') ? null : 'Only CSV files are allowed',
});

// POST / - import Swarm CSV files
swarmImportRouter.post('/', csvUpload.array('files', 100), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No CSV files provided' });
  }
  const userId = currentUserId();

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    for (const file of files) {
      const content = fs.readFileSync(file.path, 'utf-8');

      // The Swarm CSV export has repeated header rows between records, and
      // `shout` values may contain quoted newlines, so parse the whole file as
      // CSV (a split on '\n' tore those records apart and silently dropped
      // them) and then walk the rows, switching headers at each header row.
      let allRows: string[][];
      try {
        allRows = parse(content, {
          bom: true,
          relax_column_count: true,
          relax_quotes: true,
          skip_empty_lines: true,
          skip_records_with_error: true,
          trim: true,
        }) as string[][];
      } catch (parseErr: any) {
        errors.push(`${file.originalname}: could not parse CSV (${parseErr.message || parseErr})`);
        continue;
      }
      let currentHeaders: string[] = [];
      const records: Record<string, string>[] = [];

      for (const row of allRows) {
        if (row.length === 0) continue;

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

          // Check for duplicate by swarm_id (this user's own import)
          const existing = await query(
            'SELECT id FROM checkins WHERE swarm_id = $1 AND user_id = $2',
            [swarmId, userId]
          );
          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          const { id: venueId } = await findOrReuseVenue({
            name: venueName,
            latitude: lat,
            longitude: lng,
            swarm_venue_id: swarmVenueId,
          });

          // Without a timezone the check-in reads as UTC in stats and date
          // filters until the separate backfill script runs.
          const checkinTimezone = await inferVenueTimezone(venueId);
          // swarm_id is unique per user; DO NOTHING covers a concurrent
          // import of the same file racing past the check above.
          const inserted = await query(
            `INSERT INTO checkins (user_id, venue_id, notes, checked_in_at, checkin_timezone, swarm_id)
             VALUES ($1, $2, $3, $4::timestamptz, $5, $6)
             ON CONFLICT DO NOTHING`,
            [userId, venueId, shout, createdAt, checkinTimezone, swarmId]
          );
          if ((inserted.rowCount ?? 0) === 0) {
            skipped++;
            continue;
          }

          imported++;
        } catch (rowErr: any) {
          errors.push(`Row error (id=${row['id']}): ${rowErr.message || rowErr}`);
          skipped++;
        }
      }

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
  } finally {
    // Clean up every uploaded temp file, including after an error mid-loop.
    for (const file of files) removeImportFile(file.path);
  }
});
