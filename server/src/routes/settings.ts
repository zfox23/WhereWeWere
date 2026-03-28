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
              us.immich_url, us.immich_api_key
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
    const { dawarich_url, dawarich_api_key, immich_url, immich_api_key } = req.body;

    const result = await query(
      `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         dawarich_url = COALESCE($2, user_settings.dawarich_url),
         dawarich_api_key = COALESCE($3, user_settings.dawarich_api_key),
         immich_url = COALESCE($4, user_settings.immich_url),
         immich_api_key = COALESCE($5, user_settings.immich_api_key),
         updated_at = NOW()
       RETURNING *`,
      [USER_ID, dawarich_url ?? null, dawarich_api_key ?? null, immich_url ?? null, immich_api_key ?? null]
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
