import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

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

const MOOD_MAP: Record<string, number> = {
  awful: 1,
  bad: 2,
  meh: 3,
  good: 4,
  excellent: 5,
  rad: 5,
  great: 5,
};

async function findOrCreateActivity(
  name: string,
  groupId: string,
  cache: Map<string, string>
): Promise<string> {
  const key = name.toLowerCase().trim();
  if (cache.has(key)) return cache.get(key)!;

  const existing = await query(
    'SELECT id FROM mood_activities WHERE group_id = $1 AND LOWER(name) = $2',
    [groupId, key]
  );
  if (existing.rows.length > 0) {
    cache.set(key, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const result = await query(
    'INSERT INTO mood_activities (group_id, name) VALUES ($1, $2) RETURNING id',
    [groupId, name.trim()]
  );
  cache.set(key, result.rows[0].id);
  return result.rows[0].id;
}

// POST / - import Daylio CSV file
router.post('/', csvUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No CSV file provided' });
  }

  const importTimezone = req.body.timezone || 'UTC';

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    let content = fs.readFileSync(file.path, 'utf-8');
    // Strip BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    const records: Record<string, string>[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });

    // Find or create the "Daylio Import" activity group
    let groupResult = await query(
      "SELECT id FROM mood_activity_groups WHERE user_id = $1 AND name = 'Daylio Import'",
      [USER_ID]
    );
    let groupId: string;
    if (groupResult.rows.length > 0) {
      groupId = groupResult.rows[0].id;
    } else {
      const newGroup = await query(
        "INSERT INTO mood_activity_groups (user_id, name) VALUES ($1, 'Daylio Import') RETURNING id",
        [USER_ID]
      );
      groupId = newGroup.rows[0].id;
    }

    const activityCache = new Map<string, string>();

    for (const row of records) {
      try {
        const fullDate = row['full_date'];
        const time = row['time'] || '';
        const moodText = (row['mood'] || '').toLowerCase().trim();
        const activitiesStr = row['activities'] || '';
        const rawNote = row['note'] || '';
        const note = rawNote.replace(/<br\s*\/?>/gi, '\n').trim() || null;

        if (!fullDate || !moodText) {
          skipped++;
          continue;
        }

        const moodValue = MOOD_MAP[moodText];
        if (!moodValue) {
          errors.push(`Unknown mood "${row['mood']}" for date ${fullDate}`);
          skipped++;
          continue;
        }

        // Compute dedup hash from date + time
        const hashInput = `${fullDate}|${time}`;
        const daylioHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

        // Check for duplicate
        const existing = await query(
          'SELECT id FROM mood_checkins WHERE daylio_hash = $1',
          [daylioHash]
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Insert mood checkin with timezone-aware timestamp
        // PostgreSQL can parse "2:44 PM" format natively via ::timestamp
        const insertResult = await query(
          `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, daylio_hash)
           VALUES ($1, $2, $3,
             (($4::date) || ' ' || COALESCE(NULLIF($5, ''), '12:00 PM'))::timestamp
             AT TIME ZONE $6,
             $7)
           RETURNING id`,
          [USER_ID, moodValue, note, fullDate, time, importTimezone, daylioHash]
        );

        const moodCheckinId = insertResult.rows[0].id;

        // Parse and link activities (deduplicate within same row)
        if (activitiesStr.trim()) {
          const activityNames = [...new Set(
            activitiesStr.split('|').map((s: string) => s.trim()).filter(Boolean)
          )];
          for (const actName of activityNames) {
            const activityId = await findOrCreateActivity(actName, groupId, activityCache);
            await query(
              'INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [moodCheckinId, activityId]
            );
          }
        }

        imported++;
      } catch (rowErr: any) {
        errors.push(`Row error (${row['full_date']}): ${rowErr.message || rowErr}`);
        skipped++;
      }
    }

    // Clean up temp file
    try { fs.unlinkSync(file.path); } catch { /* ignore */ }

    res.json({
      imported,
      skipped,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err: any) {
    console.error('Daylio import error:', err);
    res.status(500).json({ error: 'Import failed', details: err.message || String(err) });
  }
});

export const importDaylioRouter = router;
