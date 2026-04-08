import { Router, Request, Response } from 'express';
import { query } from '../db';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

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
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseOffsetMinutes(offsetToken: string): number {
  if (offsetToken === 'GMT' || offsetToken === 'UTC') return 0;
  const match = offsetToken.match(/^(?:GMT|UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return sign * (hours * 60 + minutes);
}

function getOffsetMinutesForTimezone(utcMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  });

  const parts = formatter.formatToParts(new Date(utcMs));
  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value || 'UTC';
  return parseOffsetMinutes(tzName);
}

function sleepLocalDateTimeToIso(value: string, timeZone: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  const baseUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcMs = baseUtc;

  // Iterate to account for DST transitions around the local wall-clock time.
  for (let i = 0; i < 3; i++) {
    const offsetMinutes = getOffsetMinutesForTimezone(utcMs, timeZone);
    const nextUtc = baseUtc - (offsetMinutes * 60 * 1000);
    if (Math.abs(nextUtc - utcMs) < 1000) {
      utcMs = nextUtc;
      break;
    }
    utcMs = nextUtc;
  }

  return new Date(utcMs).toISOString();
}

function normalizeRating(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(5, parsed));
}

// POST / - import Sleep as Android CSV
router.post('/', csvUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No CSV file provided' });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const content = fs.readFileSync(file.path, 'utf-8');
    const lines = content.split('\n');

    let currentHeaders: string[] = [];
    const records: Record<string, string>[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: string[][];
      try {
        parsed = parse(trimmed, { relax_column_count: true, trim: true });
      } catch {
        continue;
      }

      if (!parsed.length || !parsed[0].length) continue;
      const row = parsed[0];

      if (row[0] === 'Id') {
        currentHeaders = row;
        continue;
      }

      // Sleep as Android includes non-record rows that start with an empty Id column.
      if (!currentHeaders.length || !row[0] || !/^\d+$/.test(row[0])) {
        continue;
      }

      const record: Record<string, string> = {};
      for (let i = 0; i < currentHeaders.length && i < row.length; i++) {
        record[currentHeaders[i]] = row[i];
      }
      records.push(record);
    }

    for (const row of records) {
      const sleepAsAndroidId = Number(row['Id']);
      const requestedTimezone = String(row['Tz'] || '').trim();
      const timezone = isValidTimeZone(requestedTimezone) ? requestedTimezone : 'UTC';
      const fromIso = sleepLocalDateTimeToIso(String(row['From'] || ''), timezone);
      const toIso = sleepLocalDateTimeToIso(String(row['To'] || ''), timezone);
      const rating = normalizeRating(String(row['Rating'] || '0'));
      const comment = String(row['Comment'] || '').trim() || null;

      if (!Number.isFinite(sleepAsAndroidId) || !fromIso || !toIso) {
        skipped++;
        continue;
      }

      try {
        const insertResult = await query(
          `INSERT INTO sleep_entries (
             user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, rating, comment
           )
           VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7)
           ON CONFLICT (user_id, sleep_as_android_id) DO NOTHING
           RETURNING id`,
          [USER_ID, sleepAsAndroidId, timezone, fromIso, toIso, rating, comment]
        );

        if (insertResult.rows.length === 0) {
          skipped++;
        } else {
          imported++;
        }
      } catch (rowErr: any) {
        errors.push(`Row error (Id=${row['Id']}): ${rowErr.message || rowErr}`);
        skipped++;
      }
    }

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err: any) {
    console.error('Sleep as Android import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message || String(err) });
  } finally {
    try {
      fs.unlinkSync(file.path);
    } catch {
      // ignore cleanup failures
    }
  }
});

export const importSleepAsAndroidRouter = router;
