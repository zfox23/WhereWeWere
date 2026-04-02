import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import * as unzipper from 'unzipper';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

const daylioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'wherewewere-import');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  },
});

const daylioUpload = multer({
  storage: daylioStorage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.daylio')) {
      cb(null, true);
    } else {
      cb(new Error('Only .daylio files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});

interface DaylioEntry {
  id: number;
  datetime: number;
  mood: number;
  tags?: number[];
  note?: string;
}

interface DaylioTag {
  id: number;
  name: string;
  id_tag_group: number;
}

interface DaylioTagGroup {
  id: number;
  name: string;
}

interface DaylioBackup {
  dayEntries: DaylioEntry[];
  tags: DaylioTag[];
  tag_groups: DaylioTagGroup[];
}

// Icon mapping for common activities
const ACTIVITY_ICON_MAP: Record<string, string> = {
  // Social activities
  'friends': 'people-fill',
  'family': 'people-fill',
  'Date': 'heart',
  'girlfriend': 'heart',
  'boyfriend': 'heart',
  'talking to strangers': 'chat-bubble',
  'social': 'people-fill',
  'party': 'confetti',
  'friends i don\'t know yet': 'telescope',
  'meaningful conversations': 'chat-dots',
  'alone time': 'person',
  
  // Activities & Recreation
  'gaming': 'joystick',
  'board games': 'dice-1',
  'movies & tv': 'film',
  'reading': 'book',
  'music': 'music-note',
  'photography': 'camera',
  'videography': 'camera-video',
  'hiking': 'mountain',
  'climbing': 'mountain',
  'biking': 'bicycle',
  'walking': 'person-walking',
  'swimming': 'water',
  'dancing': 'disco',
  'outdoors': 'tree',
  'beach': 'water-waves',
  'relax': 'sun-glasses',
  'cooking': 'fire',
  
  // Work & Productivity
  'work': 'briefcase',
  'programming': 'code',
  'ai': 'lightbulb',
  'writing': 'pencil',
  'therapy': 'person-heart',
  'workout': 'dumbbell',
  
  // Health
  'adderall': 'pill',
  'caffeine': 'cup',
  'alcohol': 'cup',
  'weed': 'leaf',
  'mushrooms': 'leaf',
  'sick': 'face-tired',
  'crohn\'s flareup': 'heart-break',
  'pain': 'heart-break',
  'tummy ache': 'star',
  'sore voice': 'mic',
  'physically exhausted': 'hourglass-split',
  
  // Sleep
  'awake': 'eye',
  'tired': 'moon',
  'nap': 'moon',
  'sleep': 'moon',
  
  // Other
  'ate delicious food': 'heart',
  'cleaning': 'broom',
  'errands': 'arrow-down-up',
  'mosby disturbance': 'exclamation-triangle',
  'street noise': 'exclamation-triangle',
  'feeling strong': 'lightning-fill',
  'energized': 'lightning-fill',
  'focused': 'target',
  'calm': 'cloud-sun',
  'excited': 'star-fill',
  'anxious': 'exclamation-triangle',
  'angry': 'exclamation-triangle',
  'stress': 'exclamation-triangle',
  'bored': 'dash',
  'sad': 'heart-break',
  'suicidal': 'heart-break',
  'hopeless': 'heart-break',
  'frantic': 'lightning-fill',
  'valued': 'star-fill',
  'gratitude': 'hand-thumbs-up',
  'repair': 'screwdriver',
  'fussy': 'exclamation-triangle',
  'something amazing': 'star-fill',
  'something hilarious': 'emoji-laughing',
  'something frustrating': 'exclamation-triangle',
};

function guessActivityIcon(activityName: string): string {
  const lowercaseName = activityName.toLowerCase();
  
  // Direct lookup
  if (ACTIVITY_ICON_MAP[lowercaseName]) {
    return ACTIVITY_ICON_MAP[lowercaseName];
  }
  
  // Fuzzy matching
  for (const [key, icon] of Object.entries(ACTIVITY_ICON_MAP)) {
    if (lowercaseName.includes(key) || key.includes(lowercaseName)) {
      return icon;
    }
  }
  
  // Default icons based on activity name patterns
  if (lowercaseName.includes('work') || lowercaseName.includes('job')) return 'briefcase';
  if (lowercaseName.includes('play') || lowercaseName.includes('game')) return 'joystick';
  if (lowercaseName.includes('walk') || lowercaseName.includes('run')) return 'person-walking';
  if (lowercaseName.includes('exercise') || lowercaseName.includes('work out')) return 'dumbbell';
  if (lowercaseName.includes('eat') || lowercaseName.includes('cook')) return 'fire';
  if (lowercaseName.includes('sleep') || lowercaseName.includes('nap')) return 'moon';
  
  // Default fallback
  return 'circle-fill';
}

async function findOrCreateActivityGroup(
  name: string,
  cache: Map<string, string>
): Promise<string> {
  const key = `group:${name.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;

  const existing = await query(
    'SELECT id FROM mood_activity_groups WHERE user_id = $1 AND LOWER(name) = $2',
    [USER_ID, name.toLowerCase().trim()]
  );
  if (existing.rows.length > 0) {
    cache.set(key, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const result = await query(
    'INSERT INTO mood_activity_groups (user_id, name) VALUES ($1, $2) RETURNING id',
    [USER_ID, name.trim()]
  );
  cache.set(key, result.rows[0].id);
  return result.rows[0].id;
}

async function findOrCreateActivity(
  name: string,
  groupId: string,
  cache: Map<string, string>,
  icon?: string
): Promise<string> {
  const key = `activity:${groupId}:${name.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;

  const existing = await query(
    'SELECT id FROM mood_activities WHERE group_id = $1 AND LOWER(name) = $2',
    [groupId, name.toLowerCase().trim()]
  );
  if (existing.rows.length > 0) {
    cache.set(key, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const result = await query(
    'INSERT INTO mood_activities (group_id, name, icon) VALUES ($1, $2, $3) RETURNING id',
    [groupId, name.trim(), icon || null]
  );
  cache.set(key, result.rows[0].id);
  return result.rows[0].id;
}

async function extractBackupFromZip(zipPath: string): Promise<DaylioBackup> {
  return new Promise((resolve, reject) => {
    let backupContent = '';
    
    fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', (entry: any) => {
        if (entry.path === 'backup.daylio') {
          entry.on('data', (data: Buffer) => {
            backupContent += data.toString('utf-8');
          });
          entry.on('end', () => {
            // backupContent is base64-encoded
            try {
              const decoded = Buffer.from(backupContent, 'base64').toString('utf-8');
              const parsed = JSON.parse(decoded) as DaylioBackup;
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse backup.daylio: ${(err as any).message}`));
            }
          });
        } else {
          entry.autodrain();
        }
      })
      .on('error', reject);
  });
}

// POST / - import Daylio .daylio file
router.post('/', daylioUpload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'No .daylio file provided' });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const backup = await extractBackupFromZip(file.path);

    // Build tag ID -> tag name mapping
    const tagMap = new Map<number, string>();
    backup.tags.forEach((tag) => {
      tagMap.set(tag.id, tag.name);
    });

    // Build tag group ID -> group name mapping
    const tagGroupMap = new Map<number, string>();
    backup.tag_groups.forEach((group) => {
      tagGroupMap.set(group.id, group.name);
    });

    // Build tag ID -> tag group ID mapping
    const tagToGroupMap = new Map<number, number>();
    backup.tags.forEach((tag) => {
      tagToGroupMap.set(tag.id, tag.id_tag_group);
    });

    // Cache for groups and activities
    const cacheGroupId = new Map<string, string>();
    const cacheActivityId = new Map<string, string>();

    for (const entry of backup.dayEntries) {
      try {
        const { datetime, mood, tags: tagIds = [], note = null } = entry;

        if (!datetime || !mood || mood < 1 || mood > 5) {
          skipped++;
          continue;
        }

        // Invert Daylio mood scale (1=Excellent→5, 5=Awful→1 in WhereWeWere)
        const invertedMood = 6 - mood;

        // Compute dedup hash from datetime
        const daylioHash = crypto
          .createHash('sha256')
          .update(`daylio:${datetime}`)
          .digest('hex')
          .slice(0, 16);

        // Check for duplicate
        const existing = await query(
          'SELECT id FROM mood_checkins WHERE daylio_hash = $1',
          [daylioHash]
        );
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        // Convert unix timestamp to date
        const checkedInAt = new Date(datetime);

        // Insert mood checkin
        const insertResult = await query(
          `INSERT INTO mood_checkins (user_id, mood, note, checked_in_at, daylio_hash)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [USER_ID, invertedMood, note, checkedInAt, daylioHash]
        );

        const moodCheckinId = insertResult.rows[0].id;

        // Link activities (from tags)
        if (tagIds && tagIds.length > 0) {
          const tagNameSet = new Set<string>();
          
          for (const tagId of tagIds) {
            const tagName = tagMap.get(tagId);
            if (!tagName) continue;
            
            tagNameSet.add(tagName);
          }

          for (const tagName of tagNameSet) {
            try {
              // Find the tag and its group
              const tagId = [...tagMap.entries()].find(([_, name]) => name === tagName)?.[0];
              if (!tagId) continue;

              const groupId = tagToGroupMap.get(tagId);
              if (!groupId) continue;

              const groupName = tagGroupMap.get(groupId);
              if (!groupName) continue;

              // Find or create group
              const actGroupId = await findOrCreateActivityGroup(groupName, cacheGroupId);

              // Guess icon for activity
              const icon = guessActivityIcon(tagName);

              // Find or create activity
              const activityId = await findOrCreateActivity(tagName, actGroupId, cacheActivityId, icon);

              // Link activity to mood checkin
              await query(
                'INSERT INTO mood_checkin_activities (mood_checkin_id, activity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [moodCheckinId, activityId]
              );
            } catch (actErr: any) {
              errors.push(`Failed to link activity "${tagName}": ${actErr.message}`);
            }
          }
        }

        imported++;
      } catch (rowErr: any) {
        errors.push(`Entry error: ${rowErr.message || rowErr}`);
        skipped++;
      }
    }

    // Clean up temp file
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }

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
