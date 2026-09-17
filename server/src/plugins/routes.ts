/**
 * Framework routes for check-in type plugins.
 *
 *   GET    /api/v1/plugins                      -> list registered plugin metadata
 *   GET    /api/v1/plugins/:pluginId            -> plugin manifest (fields, strings)
 *   GET    /api/v1/plugins/:pluginId/checkins   -> list generic check-ins
 *   POST   /api/v1/plugins/:pluginId/checkins   -> create (schema-validated)
 *   GET    /api/v1/plugins/:pluginId/checkins/:id
 *   PUT    /api/v1/plugins/:pluginId/checkins/:id
 *   DELETE /api/v1/plugins/:pluginId/checkins/:id
 *   GET    /api/v1/plugins/:pluginId/settings   -> effective settings
 *   PUT    /api/v1/plugins/:pluginId/settings   -> upsert declared keys
 *
 * Plugins with custom storage do NOT use the check-ins endpoints; they own
 * their own API routes via `server.api`. The metadata + settings endpoints
 * are available to all plugins.
 */

import { Router, Request, Response } from 'express';
import { allPlugins, getPlugin } from './registry';
import {
  createGenericCheckin,
  deleteGenericCheckin,
  getGenericCheckin,
  listGenericCheckins,
  getPluginSettings,
  setPluginSettings,
  updateGenericCheckin,
} from './genericStore';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';

function publicManifest(pluginId: string) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;
  return {
    id: plugin.id,
    version: plugin.version,
    fields: plugin.fields,
    strings: plugin.strings,
    filterParams: plugin.filterParams ?? [],
  };
}

// GET / - list registered plugins
router.get('/', (_req: Request, res: Response) => {
  res.json(allPlugins().map((p) => publicManifest(p.id)).filter(Boolean));
});

// GET /:pluginId - plugin manifest
router.get('/:pluginId', (req: Request, res: Response) => {
  const manifest = publicManifest(String(req.params.pluginId));
  if (!manifest) return res.status(404).json({ error: 'Unknown plugin' });
  res.json(manifest);
});

// --- generic check-in CRUD (generic-storage plugins only) -----------------

async function genericPluginOr404(pluginId: string, res: Response) {
  const plugin = getPlugin(pluginId);
  if (!plugin) {
    res.status(404).json({ error: 'Unknown plugin' });
    return null;
  }
  if (plugin.server.storage === 'custom') {
    res.status(400).json({ error: `Plugin "${pluginId}" uses custom storage and does not expose generic check-in routes` });
    return null;
  }
  return plugin;
}

// GET /:pluginId/checkins
router.get('/:pluginId/checkins', async (req: Request, res: Response) => {
  const plugin = await genericPluginOr404(String(req.params.pluginId), res);
  if (!plugin) return;
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
    const rows = await listGenericCheckins(plugin.id, USER_ID, { limit, offset });
    res.json(rows);
  } catch (err) {
    console.error('Error listing plugin checkins:', err);
    res.status(500).json({ error: 'Failed to list check-ins' });
  }
});

// POST /:pluginId/checkins
router.post('/:pluginId/checkins', async (req: Request, res: Response) => {
  const plugin = await genericPluginOr404(String(req.params.pluginId), res);
  if (!plugin) return;
  try {
    const { checked_in_at, checkin_timezone, data } = req.body ?? {};
    const row = await createGenericCheckin(USER_ID, plugin, {
      checked_in_at: checked_in_at ?? null,
      checkin_timezone: checkin_timezone ?? null,
      data: data ?? {},
    });
    res.status(201).json(row);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    console.error('Error creating plugin checkin:', err);
    res.status(status).json({ error: (err as Error).message || 'Failed to create check-in' });
  }
});

// GET /:pluginId/checkins/:id
router.get('/:pluginId/checkins/:id', async (req: Request, res: Response) => {
  const plugin = await genericPluginOr404(String(req.params.pluginId), res);
  if (!plugin) return;
  try {
    const row = await getGenericCheckin(String(req.params.id), plugin.id, USER_ID);
    if (!row) return res.status(404).json({ error: 'Check-in not found' });
    res.json(row);
  } catch (err) {
    console.error('Error getting plugin checkin:', err);
    res.status(500).json({ error: 'Failed to get check-in' });
  }
});

// PUT /:pluginId/checkins/:id
router.put('/:pluginId/checkins/:id', async (req: Request, res: Response) => {
  const plugin = await genericPluginOr404(String(req.params.pluginId), res);
  if (!plugin) return;
  try {
    const { checked_in_at, checkin_timezone, data } = req.body ?? {};
    const row = await updateGenericCheckin(String(req.params.id), plugin, USER_ID, {
      checked_in_at: checked_in_at ?? undefined,
      checkin_timezone: checkin_timezone ?? undefined,
      data: data ?? undefined,
    });
    if (!row) return res.status(404).json({ error: 'Check-in not found' });
    res.json(row);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    console.error('Error updating plugin checkin:', err);
    res.status(status).json({ error: (err as Error).message || 'Failed to update check-in' });
  }
});

// DELETE /:pluginId/checkins/:id
router.delete('/:pluginId/checkins/:id', async (req: Request, res: Response) => {
  const plugin = await genericPluginOr404(String(req.params.pluginId), res);
  if (!plugin) return;
  try {
    const id = String(req.params.id);
    const deleted = await deleteGenericCheckin(id, plugin.id, USER_ID);
    if (!deleted) return res.status(404).json({ error: 'Check-in not found' });
    res.json({ message: 'Check-in deleted', id });
  } catch (err) {
    console.error('Error deleting plugin checkin:', err);
    res.status(500).json({ error: 'Failed to delete check-in' });
  }
});

// --- plugin settings -------------------------------------------------------

// GET /:pluginId/settings
router.get('/:pluginId/settings', async (req: Request, res: Response) => {
  const plugin = getPlugin(String(req.params.pluginId));
  if (!plugin) return res.status(404).json({ error: 'Unknown plugin' });
  try {
    const settings = await getPluginSettings(USER_ID, plugin);
    res.json(settings);
  } catch (err) {
    console.error('Error getting plugin settings:', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// PUT /:pluginId/settings
router.put('/:pluginId/settings', async (req: Request, res: Response) => {
  const plugin = getPlugin(String(req.params.pluginId));
  if (!plugin) return res.status(404).json({ error: 'Unknown plugin' });
  try {
    const updates = (req.body ?? {}) as Record<string, unknown>;
    const settings = await setPluginSettings(USER_ID, plugin, updates);
    res.json(settings);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    console.error('Error setting plugin settings:', err);
    res.status(status).json({ error: (err as Error).message || 'Failed to update settings' });
  }
});

export { router as pluginsRouter };
