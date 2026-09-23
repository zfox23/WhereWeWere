import { Router, Request, Response } from 'express';
import { pool, query } from '../db';
import {
  applyReconciliationUpdate,
  getTimestampReconciliationSuggestions,
  type TimestampReconciliationUpdate,
} from '../services/timestampReconciliation';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const DISTANCE_UNITS = new Set(['metric', 'imperial']);
const TIMELINE_DENSITIES = new Set(['comfortable', 'compact']);
const DEFAULT_SYSTEM_LIGHT_THEME = 'sunrise';
const DEFAULT_SYSTEM_DARK_THEME = 'midnight';

// GET / - get user settings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT u.username, u.email, u.display_name,
              us.dawarich_url, us.dawarich_api_key,
              us.immich_url, us.immich_api_key,
              us.maloja_url,
              us.llm_api_url, us.llm_model, us.llm_reasoning_level,
              us.llm_context_window, us.llm_image_support,
              COALESCE(us.theme, 'system') AS theme,
                    COALESCE(us.system_light_theme, $2) AS system_light_theme,
                    COALESCE(us.system_dark_theme, $3) AS system_dark_theme,
                    COALESCE(us.distance_unit, 'metric') AS distance_unit,
              COALESCE(us.timeline_density, 'comfortable') AS timeline_density
       FROM users u
       LEFT JOIN user_settings us ON us.user_id = u.id
       WHERE u.id = $1`,
                  [USER_ID, DEFAULT_SYSTEM_LIGHT_THEME, DEFAULT_SYSTEM_DARK_THEME]
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

router.get('/timestamp-reconciliation', async (_req: Request, res: Response) => {
  try {
    const result = await getTimestampReconciliationSuggestions(USER_ID);
    res.json(result);
  } catch (err) {
    console.error('Error scanning timestamp reconciliation suggestions:', err);
    res.status(500).json({ error: 'Failed to scan timestamp reconciliation suggestions' });
  }
});

// PUT / - update integration settings
router.put('/', async (req: Request, res: Response) => {
  try {
    const {
      dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url,
      theme, system_light_theme, system_dark_theme,
      distance_unit,
      timeline_density,
      llm_api_url, llm_model, llm_reasoning_level, llm_context_window, llm_image_support,
    } = req.body;

    if (typeof distance_unit !== 'undefined' && !DISTANCE_UNITS.has(distance_unit)) {
      return res.status(400).json({ error: 'distance_unit must be either "metric" or "imperial"' });
    }

    if (typeof timeline_density !== 'undefined' && !TIMELINE_DENSITIES.has(timeline_density)) {
      return res.status(400).json({ error: 'timeline_density must be either "comfortable" or "compact"' });
    }

    if (typeof llm_context_window !== 'undefined' && llm_context_window !== null) {
      const parsed = Number(llm_context_window);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'llm_context_window must be a positive integer' });
      }
    }

    if (typeof llm_image_support !== 'undefined' && llm_image_support !== null && typeof llm_image_support !== 'boolean') {
      return res.status(400).json({ error: 'llm_image_support must be a boolean' });
    }

    const result = await query(
      `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url,
                                  theme, system_light_theme, system_dark_theme, distance_unit, timeline_density,
                                  llm_api_url, llm_model, llm_reasoning_level, llm_context_window, llm_image_support)
       VALUES ($1, $2, $3, $4, $5, $6,
               $7, COALESCE($8, $18), COALESCE($9, $19), $10, $20,
               $11, $12, $13, $14, $15)
       ON CONFLICT (user_id) DO UPDATE SET
         dawarich_url = COALESCE($2, user_settings.dawarich_url),
         dawarich_api_key = COALESCE($3, user_settings.dawarich_api_key),
         immich_url = COALESCE($4, user_settings.immich_url),
         immich_api_key = COALESCE($5, user_settings.immich_api_key),
         maloja_url = COALESCE($6, user_settings.maloja_url),
         theme = COALESCE($7, user_settings.theme),
         system_light_theme = COALESCE($8, user_settings.system_light_theme, $18),
         system_dark_theme = COALESCE($9, user_settings.system_dark_theme, $19),
         distance_unit = COALESCE($10, user_settings.distance_unit),
         timeline_density = COALESCE($20, user_settings.timeline_density),
         llm_api_url = COALESCE($11, user_settings.llm_api_url),
         llm_model = COALESCE($12, user_settings.llm_model),
         llm_reasoning_level = COALESCE($13, user_settings.llm_reasoning_level),
         llm_context_window = COALESCE($14, user_settings.llm_context_window),
         llm_image_support = COALESCE($15, user_settings.llm_image_support),
         updated_at = NOW()
       RETURNING *`,
      [
        USER_ID,
        dawarich_url ?? null, dawarich_api_key ?? null,
        immich_url ?? null, immich_api_key ?? null,
        maloja_url ?? null,
        theme ?? null,
        system_light_theme ?? null,
        system_dark_theme ?? null,
        distance_unit ?? null,
        llm_api_url ?? null,
        llm_model ?? null,
        llm_reasoning_level ?? null,
        llm_context_window ?? null,
        llm_image_support ?? null,
        DEFAULT_SYSTEM_LIGHT_THEME,
        DEFAULT_SYSTEM_DARK_THEME,
        timeline_density ?? null,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.post('/timestamp-reconciliation/apply', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates as TimestampReconciliationUpdate[] : [];

    if (updates.length === 0) {
      return res.status(400).json({ error: 'updates must contain at least one item' });
    }

    await client.query('BEGIN');

    let updated = 0;

    for (const update of updates) {
      if (!update?.id || !update.type || !update.suggested_timezone) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Each update must include id, type, and suggested_timezone' });
      }

      // Label-only: the stored instant is the true moment the event happened;
      // reconciliation only corrects the stored timezone label. Built-in
      // types are updated here; plugin types persist via their own hook.
      const applied = await applyReconciliationUpdate(client as any, update);
      if (!applied) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Unable to reconcile ${update.type} check-in ${update.id}` });
      }

      updated += 1;
    }

    await client.query('COMMIT');
    res.json({ updated });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error applying timestamp reconciliation updates:', err);
    res.status(500).json({ error: 'Failed to apply timestamp reconciliation updates' });
  } finally {
    client.release();
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
