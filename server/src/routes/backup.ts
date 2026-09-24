import { Router, Request, Response } from 'express';
import multer from 'multer';
import { pool, query } from '../db';
import {
  deletePluginData,
  exportPluginData,
  exportPluginFiles,
  importPluginData,
  restoreLegacyPluginData,
  type PluginBackupPayload,
} from '../plugins/backup';
import {
  BACKUP_FORMAT,
  LATEST_BACKUP_SCHEMA_VERSION,
  extractBackupZip,
  listBackupPluginFiles,
  readBackupJsonFile,
  removeBackupTempDir,
  streamBackupZip,
} from '../services/backupArchive';
import { allPlugins } from '../plugins/registry';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const FIRST_START_OVER_CONFIRMATION = 'DELETE MY DATA';
const SECOND_START_OVER_CONFIRMATION = 'START OVER';

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const isJson =
      file.mimetype === 'application/json' || name.endsWith('.json');
    const isZip =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      name.endsWith('.zip');
    if (isJson || isZip) {
      cb(null, true);
    } else {
      cb(new Error('Only backup .json or .zip files are allowed'));
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 },
});

interface BackupUser {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupSettings {
  dawarich_url: string | null;
  dawarich_api_key: string | null;
  immich_url: string | null;
  immich_api_key: string | null;
  maloja_url: string | null;
  theme: string | null;
  system_light_theme: string | null;
  system_dark_theme: string | null;
  distance_unit: string | null;
  created_at?: string;
  updated_at?: string;
}

interface BackupV1 {
  format: typeof BACKUP_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  data: {
    user: BackupUser | null;
    settings: BackupSettings | null;
    /** Plugin-owned data (check-in types that are plugins). */
    plugins: Record<string, unknown>;
  };
  /**
   * The original `data` object as received, untyped. Legacy backup restore
   * hooks read their type-specific keys from here (they predate `plugins`).
   */
  raw?: Record<string, unknown>;
}

/**
 * The logical restore input shared by both archive shapes:
 *  - v1: a single JSON document ({ format, schemaVersion, exportedAt, data })
 *  - v2: a ZIP bundle (manifest backup.json + plugins/<id>.json per plugin)
 */
interface ParsedBackup {
  schemaVersion: number;
  user: BackupUser | null;
  settings: BackupSettings | null;
  pluginsPayload: PluginBackupPayload | null;
  /** v1 only: the full `data` object for legacy restore hooks. */
  raw: Record<string, unknown> | null;
  /**
   * v2 only: for each plugin that has bundled files, the directory inside
   * the extracted temp root where `plugins/<id>/` landed. The route removes
   * the temp root when done.
   */
  tempRoot?: string;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function assertSupportedSchemaVersion(schemaVersion: number): void {
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error('Backup schemaVersion must be a positive integer');
  }
  if (schemaVersion > LATEST_BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Backup schemaVersion ${schemaVersion} is newer than supported version ${LATEST_BACKUP_SCHEMA_VERSION}`
    );
  }
}

/** Parse a v1 single-JSON backup document. */
function parseV1Backup(raw: unknown): ParsedBackup {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup payload must be a JSON object');
  }

  const source = raw as Record<string, unknown>;
  if (source.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format: expected "${BACKUP_FORMAT}"`);
  }

  assertSupportedSchemaVersion(toNumber(source.schemaVersion, NaN));

  // Migration hook for future schema upgrades.
  let migrated = source;
  let currentVersion = toNumber(source.schemaVersion, 1);
  while (currentVersion < LATEST_BACKUP_SCHEMA_VERSION) {
    if (currentVersion === 1) {
      // v1 documents remain fully restorable; the v2 ZIP shape changes the
      // *container*, not the per-plugin payload, so no data migration is
      // needed to accept v1 on a v2-aware server.
      break;
    }
    throw new Error(`No migrator available for schemaVersion ${currentVersion}`);
  }

  const migratedData = (migrated.data ?? {}) as Record<string, unknown>;

  const user = migratedData.user && typeof migratedData.user === 'object'
    ? migratedData.user as BackupUser
    : null;

  const settings = migratedData.settings && typeof migratedData.settings === 'object'
    ? migratedData.settings as BackupSettings
    : null;

  return {
    schemaVersion: toNumber(source.schemaVersion, 1),
    user,
    settings,
    pluginsPayload: (migratedData.plugins as PluginBackupPayload) ?? null,
    raw: migratedData,
  };
}

/** Parse a v2 ZIP bundle buffer (already extracted to a temp root). */
function parseV2Backup(tempRoot: string): ParsedBackup {
  const manifest = readBackupJsonFile(tempRoot, 'backup.json');
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Backup ZIP is missing a valid backup.json manifest');
  }

  const m = manifest as Record<string, unknown>;
  if (m.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format: expected "${BACKUP_FORMAT}"`);
  }
  assertSupportedSchemaVersion(toNumber(m.schemaVersion, NaN));

  const pluginsPayload: PluginBackupPayload = {};
  for (const pluginId of listBackupPluginFiles(tempRoot)) {
    const entry = readBackupJsonFile(tempRoot, `plugins/${pluginId}.json`);
    if (entry && typeof entry === 'object') {
      pluginsPayload[pluginId] = entry as PluginBackupPayload[string];
    }
  }

  return {
    schemaVersion: toNumber(m.schemaVersion, LATEST_BACKUP_SCHEMA_VERSION),
    user: (m.user as BackupUser) ?? null,
    settings: (m.settings as BackupSettings) ?? null,
    pluginsPayload,
    raw: null,
    tempRoot,
  };
}

/**
 * Run the shared restore (user, settings, legacy plugin keys, plugin data)
 * inside the caller's transaction. Returns per-section row counts.
 */
async function runRestore(
  client: import('pg').PoolClient,
  backup: ParsedBackup,
  errors: string[],
): Promise<Record<string, { inserted: number; skipped: number }>> {
  const counts: Record<string, { inserted: number; skipped: number }> = {};

  if (backup.user?.display_name !== undefined) {
    await client.query(
      `UPDATE users
       SET display_name = COALESCE($2, display_name),
           updated_at = NOW()
       WHERE id = $1`,
      [USER_ID, backup.user.display_name]
    );
  }

  if (backup.settings) {
    const s = backup.settings;
    await client.query(
      `INSERT INTO user_settings (
         user_id, dawarich_url, dawarich_api_key,
         immich_url, immich_api_key, maloja_url,
         theme, system_light_theme, system_dark_theme,
         distance_unit
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id) DO UPDATE SET
          dawarich_url = EXCLUDED.dawarich_url,
          dawarich_api_key = EXCLUDED.dawarich_api_key,
          immich_url = EXCLUDED.immich_url,
          immich_api_key = EXCLUDED.immich_api_key,
          maloja_url = EXCLUDED.maloja_url,
          theme = COALESCE(EXCLUDED.theme, user_settings.theme),
          system_light_theme = COALESCE(EXCLUDED.system_light_theme, user_settings.system_light_theme),
          system_dark_theme = COALESCE(EXCLUDED.system_dark_theme, user_settings.system_dark_theme),
          distance_unit = COALESCE(EXCLUDED.distance_unit, user_settings.distance_unit),
          updated_at = NOW()`,
      [
        USER_ID,
        toStringOrNull(s.dawarich_url),
        toStringOrNull(s.dawarich_api_key),
        toStringOrNull(s.immich_url),
        toStringOrNull(s.immich_api_key),
        toStringOrNull(s.maloja_url),
        toStringOrNull(s.theme),
        toStringOrNull(s.system_light_theme),
        toStringOrNull(s.system_dark_theme),
        toStringOrNull(s.distance_unit),
      ]
    );

    // Legacy setting values that plugins have moved to plugin_settings
    // (e.g. mood_icon_pack) are claimed by the declaring plugin so old
    // backups restore into plugin_settings.
    for (const plugin of allPlugins()) {
      for (const key of plugin.server.legacySettingsKeys ?? []) {
        const value = (s as unknown as Record<string, unknown>)[key];
        if (value == null) continue;
        await client.query(
          `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (user_id, plugin_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [USER_ID, plugin.id, key, JSON.stringify(value)]
        );
      }
    }
  }

  // Plugin check-in types: new-format backups (with a plugins payload) are
  // restored by importPluginData below; legacy backups are restored here via
  // each plugin's restoreLegacyBackup hook, which also claims its legacy
  // keys so no core loop runs for them.
  if (backup.pluginsPayload || allPlugins().some((p) => p.server.restoreLegacyBackup)) {
    const legacy = await restoreLegacyPluginData(client, USER_ID, backup.raw ?? {}, backup.pluginsPayload, errors);
    for (const [pluginId, pluginCounts] of Object.entries(legacy)) {
      for (const [key, pc] of Object.entries(pluginCounts)) {
        counts[key] = pc;
      }
    }
  }

  // Plugin data (generic + custom storage) — restored inside the same
  // transaction, honoring each plugin's declared backupOrder.
  if (backup.pluginsPayload) {
    // v2 file bundles: each plugin with extracted files gets its directory.
    const filesDirs: Record<string, string> = {};
    if (backup.tempRoot) {
      for (const pluginId of Object.keys(backup.pluginsPayload)) {
        filesDirs[pluginId] = `${backup.tempRoot}/plugins/${pluginId}`;
      }
    }
    const pluginCounts = await importPluginData(client, USER_ID, backup.pluginsPayload, filesDirs, errors);
    for (const [pluginId, pc] of Object.entries(pluginCounts)) {
      counts[`plugin:${pluginId}`] = pc;
    }
  }

  return counts;
}

router.get('/export', async (_req: Request, res: Response) => {
  let fileTempDirs: string[] = [];
  try {
    const [
      userResult,
      settingsResult,
      pluginsData,
    ] = await Promise.all([
        query(
          `SELECT id, username, email, display_name, created_at, updated_at
           FROM users
           WHERE id = $1`,
          [USER_ID]
        ),
        query(
          `SELECT dawarich_url, dawarich_api_key,
                  immich_url, immich_api_key,
                  maloja_url,
                  theme,
                  system_light_theme,
                  system_dark_theme,
                  distance_unit,
                  created_at,
                  updated_at
           FROM user_settings
           WHERE user_id = $1`,
          [USER_ID]
        ),
        exportPluginData(USER_ID),
      ]);

    // File collection runs AFTER the data export: a plugin's backupFiles may
    // stage generated files whose contents depend on its backupExport output
    // (e.g. tracks generates a GPX for rows whose original is missing).
    const { files: pluginFiles, tempDirs } = await exportPluginFiles(USER_ID);
    fileTempDirs = tempDirs;

    const manifest: import('../services/backupArchive').BackupManifest = {
      format: BACKUP_FORMAT,
      schemaVersion: LATEST_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      user: userResult.rows[0] ?? null,
      settings: settingsResult.rows[0] ?? null,
    };

    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="wherewewere-backup-v${LATEST_BACKUP_SCHEMA_VERSION}-${day}.zip"`
    );
    await streamBackupZip(res, manifest, pluginsData, pluginFiles);
  } catch (err) {
    console.error('Error exporting backup:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export backup' });
    } else {
      res.destroy();
    }
  } finally {
    for (const dir of fileTempDirs) removeBackupTempDir(dir);
  }
});

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  const client = await pool.connect();
  let tempRoot: string | undefined;
  try {
    let backup: ParsedBackup;

    if (req.file) {
      const name = req.file.originalname.toLowerCase();
      const isZip =
        req.file.mimetype === 'application/zip' ||
        req.file.mimetype === 'application/x-zip-compressed' ||
        name.endsWith('.zip');

      if (isZip) {
        tempRoot = await extractBackupZip(req.file.buffer);
        backup = parseV2Backup(tempRoot);
        backup.tempRoot = tempRoot;
      } else {
        backup = parseV1Backup(JSON.parse(req.file.buffer.toString('utf-8')));
      }
    } else {
      backup = parseV1Backup(req.body);
    }

    const errors: string[] = [];
    // withTransaction commits on success and rolls back + rethrows on error.
    const counts = await withTransaction(client, (tx) =>
      runRestore(tx, { ...backup, tempRoot: tempRoot }, errors)
    );

    res.json({
      message: 'Backup import complete',
      schemaVersion: backup.schemaVersion,
      counts,
      errors,
    });
  } catch (err) {
    // withTransaction already rolls back when the restore fails; a pre-
    // transaction failure (parse/extract) has nothing to roll back.
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error importing backup:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to import backup' });
  } finally {
    if (tempRoot) removeBackupTempDir(tempRoot);
    client.release();
  }
});

/** Run `fn` inside an explicit transaction on `client`. */
async function withTransaction<T>(
  client: import('pg').PoolClient,
  fn: (tx: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

router.post('/start-over', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const first = (req.body?.first_confirmation ?? '').toString().trim();
    const second = (req.body?.second_confirmation ?? '').toString().trim();

    if (first !== FIRST_START_OVER_CONFIRMATION || second !== SECOND_START_OVER_CONFIRMATION) {
      return res.status(400).json({
        error: 'Start-over confirmation failed',
        required: {
          first_confirmation: FIRST_START_OVER_CONFIRMATION,
          second_confirmation: SECOND_START_OVER_CONFIRMATION,
        },
      });
    }

    const rawOptions = req.body?.options ?? {};
    const deleteAllCheckins = Boolean(rawOptions.delete_all_checkins);
    // Per-plugin check-in deletion: options use `delete_<pluginId>_checkins`.
    // Legacy aliases: `delete_venue_checkins` maps to the location plugin;
    // `delete_media_items` (pre-plugin "All Media" checkbox) maps to the
    // media plugin, whose deleteUserData hook wipes all media tables.
    const legacyVenueDelete = deleteAllCheckins || Boolean(rawOptions.delete_venue_checkins);
    const legacyMediaDelete = deleteAllCheckins || Boolean(rawOptions.delete_media_items);
    const selectedPluginCheckinIds = allPlugins()
      .filter((p) => deleteAllCheckins
        || Boolean(rawOptions[`delete_${p.id}_checkins`])
        || (legacyVenueDelete && p.id === 'location')
        || (legacyMediaDelete && p.id === 'media'))
      .map((p) => p.id);
    const resetAccountSettings = Boolean(rawOptions.reset_account_settings);
    // Per-plugin settings reset: options use `reset_<pluginId>_settings`.
    const selectedPluginSettingsIds = allPlugins()
      .filter((p) => Boolean(rawOptions[`reset_${p.id}_settings`]))
      .map((p) => p.id);
    const resetIntegrationsSettings = Boolean(rawOptions.reset_integrations_settings);

    if (selectedPluginCheckinIds.length === 0 && !resetAccountSettings && selectedPluginSettingsIds.length === 0 && !resetIntegrationsSettings) {
      return res.status(400).json({
        error: 'No start-over actions selected',
      });
    }

    await client.query('BEGIN');

    const counts: Record<string, number> = {};

    if (selectedPluginCheckinIds.length > 0) {
      // Check-in plugins own their deletion via their deleteUserData hook.
      const pluginCounts = await deletePluginData(client, USER_ID, selectedPluginCheckinIds);
      for (const [pluginId, deleted] of Object.entries(pluginCounts)) {
        counts[`plugin_checkins_${pluginId}`] = deleted;
      }
    }

    if (selectedPluginSettingsIds.length > 0) {
      // Settings reset: the framework wipes this plugin's plugin_settings rows;
      // the plugin's resetSettings hook (when present) clears any
      // user-scoped lookup tables it owns.
      for (const plugin of allPlugins()) {
        if (!selectedPluginSettingsIds.includes(plugin.id)) continue;
        const settingsResult = await client.query(
          `DELETE FROM plugin_settings WHERE user_id = $1 AND plugin_id = $2`,
          [USER_ID, plugin.id]
        );
        let deleted = settingsResult.rowCount ?? 0;
        if (plugin.server.resetSettings) {
          deleted += await plugin.server.resetSettings({ user_id: USER_ID, client });
        }
        counts[`plugin_settings_${plugin.id}_reset`] = deleted;
      }
    }

    if (resetIntegrationsSettings) {
      const integrationSettingsResult = await client.query(
        `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url)
         VALUES ($1, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           dawarich_url = NULL,
           dawarich_api_key = NULL,
           immich_url = NULL,
           immich_api_key = NULL,
           maloja_url = NULL,
           updated_at = NOW()`,
        [USER_ID]
      );
      counts.user_settings_integrations_reset = integrationSettingsResult.rowCount ?? 0;
    }

    if (resetAccountSettings) {
      const profileResult = await client.query(
        `UPDATE users
         SET display_name = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [USER_ID]
      );
      counts.user_profile_reset = profileResult.rowCount ?? 0;

      const accountSettingsResult = await client.query(
        `INSERT INTO user_settings (user_id, theme, system_light_theme, system_dark_theme, distance_unit)
         VALUES ($1, 'system', 'sunrise', 'midnight', 'metric')
         ON CONFLICT (user_id) DO UPDATE SET
           theme = 'system',
           system_light_theme = 'sunrise',
           system_dark_theme = 'midnight',
           distance_unit = 'metric',
           updated_at = NOW()`,
        [USER_ID]
      );
      counts.user_settings_account_reset = accountSettingsResult.rowCount ?? 0;
    }

    await client.query('COMMIT');

    res.json({ message: 'Selected data has been reset.', counts });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error running start-over:', err);
    res.status(500).json({ error: 'Failed to start over' });
  } finally {
    client.release();
  }
});

export const backupRouter = router;
