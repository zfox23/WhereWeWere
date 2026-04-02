import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';
const TIME_24H_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeReminderTimes(value: unknown): string[] | null {
  if (typeof value === 'undefined') return null;
  if (!Array.isArray(value)) return null;

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !TIME_24H_PATTERN.test(item)) {
      return null;
    }
    unique.add(item);
  }

  return Array.from(unique).sort();
}

// GET / - get user settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT u.username, u.email, u.display_name,
              us.dawarich_url, us.dawarich_api_key,
              us.immich_url, us.immich_api_key,
              us.maloja_url,
              COALESCE(us.theme, 'system') AS theme,
              COALESCE(us.notifications_enabled, true) AS notifications_enabled,
              COALESCE(us.mood_reminder_times, ARRAY[]::text[]) AS mood_reminder_times,
              COALESCE(us.mood_icon_pack, 'emoji') AS mood_icon_pack
       FROM users u
       LEFT JOIN user_settings us ON us.user_id = u.id
       WHERE u.id = $1`,
      [USER_ID]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting settings:', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT / - update integration settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const {
      dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url,
      theme, notifications_enabled,
      mood_reminder_times,
      mood_icon_pack,
    } = req.body;

    const normalizedReminderTimes = normalizeReminderTimes(mood_reminder_times);
    if (typeof mood_reminder_times !== 'undefined' && normalizedReminderTimes === null) {
      return res.status(400).json({ error: 'mood_reminder_times must be an array of HH:MM values' });
    }

    const result = await query(
      `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url, theme, notifications_enabled,
      mood_reminder_times, mood_icon_pack)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id) DO UPDATE SET
         dawarich_url = COALESCE($2, user_settings.dawarich_url),
         dawarich_api_key = COALESCE($3, user_settings.dawarich_api_key),
         immich_url = COALESCE($4, user_settings.immich_url),
         immich_api_key = COALESCE($5, user_settings.immich_api_key),
         maloja_url = COALESCE($6, user_settings.maloja_url),
         theme = COALESCE($7, user_settings.theme),
         notifications_enabled = COALESCE($8, user_settings.notifications_enabled),
         mood_reminder_times = COALESCE($9::text[], user_settings.mood_reminder_times),
         mood_icon_pack = COALESCE($10, user_settings.mood_icon_pack),
         updated_at = NOW()
       RETURNING *`,
      [
        USER_ID,
        dawarich_url ?? null, dawarich_api_key ?? null,
        immich_url ?? null, immich_api_key ?? null,
        maloja_url ?? null,
        theme ?? null,
        notifications_enabled ?? null,
        normalizedReminderTimes,
        mood_icon_pack ?? null,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// PUT /profile - update username/display_name
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const { username, display_name } = req.body;

    const result = await query(
      `UPDATE users
       SET username = COALESCE($2, username),
           display_name = COALESCE($3, display_name)
       WHERE id = $1
       RETURNING id, username, email, display_name`,
      [USER_ID, username ?? null, display_name ?? null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export const settingsRouter = router;
