import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

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
              COALESCE(us.notify_streak_reminder, true) AS notify_streak_reminder,
              COALESCE(us.notify_weekly_summary, true) AS notify_weekly_summary,
              COALESCE(us.notify_milestone, true) AS notify_milestone,
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
      theme, notifications_enabled, notify_streak_reminder, notify_weekly_summary, notify_milestone,
      mood_icon_pack,
    } = req.body;

    const result = await query(
      `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url, theme, notifications_enabled, notify_streak_reminder, notify_weekly_summary, notify_milestone, mood_icon_pack)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id) DO UPDATE SET
         dawarich_url = COALESCE($2, user_settings.dawarich_url),
         dawarich_api_key = COALESCE($3, user_settings.dawarich_api_key),
         immich_url = COALESCE($4, user_settings.immich_url),
         immich_api_key = COALESCE($5, user_settings.immich_api_key),
         maloja_url = COALESCE($6, user_settings.maloja_url),
         theme = COALESCE($7, user_settings.theme),
         notifications_enabled = COALESCE($8, user_settings.notifications_enabled),
         notify_streak_reminder = COALESCE($9, user_settings.notify_streak_reminder),
         notify_weekly_summary = COALESCE($10, user_settings.notify_weekly_summary),
         notify_milestone = COALESCE($11, user_settings.notify_milestone),
         mood_icon_pack = COALESCE($12, user_settings.mood_icon_pack),
         updated_at = NOW()
       RETURNING *`,
      [
        USER_ID,
        dawarich_url ?? null, dawarich_api_key ?? null,
        immich_url ?? null, immich_api_key ?? null,
        maloja_url ?? null,
        theme ?? null,
        notifications_enabled ?? null, notify_streak_reminder ?? null,
        notify_weekly_summary ?? null, notify_milestone ?? null,
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
