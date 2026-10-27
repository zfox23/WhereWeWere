import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
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
  buildBackupZip,
} from '../services/backupArchive';
import { restoreCompanionRows } from '../services/companions';
import { allPlugins } from '../plugins/registry';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const FIRST_START_OVER_CONFIRMATION = 'DELETE MY DATA';
const SECOND_START_OVER_CONFIRMATION = 'START OVER';

// Stream uploads to disk instead of buffering up to 500 MB in memory.
const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
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
  /** v2 only: the core companion table rows from companions.json. */
  companions: unknown[] | null;
  /** v2 only: the "Postcard From Your Past" history from postcards.json. */
  postcards: unknown[] | null;
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
    // v1 bundles have no core companions.json / postcards.json: check-in
    // companions in old backups still restore via the plugins' legacy hooks.
    companions: null,
    postcards: null,
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
    companions: readCompanionsFile(tempRoot),
    postcards: readPostcardsFile(tempRoot),
    raw: null,
    tempRoot,
  };
}

/**
 * Read companions.json from an extracted v2 bundle (core companion table
 * dump). Missing or malformed files yield null: old bundles predate the
 * file and their check-in companions restore via the plugins' hooks.
 */
function readCompanionsFile(tempRoot: string): unknown[] | null {
  const parsed = readBackupJsonFile(tempRoot, 'companions.json');
  if (!Array.isArray(parsed)) return null;
  return parsed;
}

/** Read postcards.json (Postcard From Your Past history) from a v2 bundle. */
function readPostcardsFile(tempRoot: string): unknown[] | null {
  const parsed = readBackupJsonFile(tempRoot, 'postcards.json');
  if (!Array.isArray(parsed)) return null;
  return parsed;
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
         immich_url, immich_api_key,
         theme, system_light_theme, system_dark_theme,
         distance_unit
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id) DO UPDATE SET
          dawarich_url = COALESCE(EXCLUDED.dawarich_url, user_settings.dawarich_url),
          dawarich_api_key = COALESCE(EXCLUDED.dawarich_api_key, user_settings.dawarich_api_key),
          immich_url = COALESCE(EXCLUDED.immich_url, user_settings.immich_url),
          immich_api_key = COALESCE(EXCLUDED.immich_api_key, user_settings.immich_api_key),
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

  // Core companion table (v2 companions.json): every check-in type's
  // companion rows plus standalone names added in the Companions tab.
  // Idempotent — the plugins' payloads may re-restore the same rows and
  // ON CONFLICT keeps those no-ops.
  if (Array.isArray(backup.companions) && backup.companions.length > 0) {
    counts.companions = await restoreCompanionRows(backup.companions, client);
  }

  // Postcard From Your Past history (v2 postcards.json): re-insert rows with
  // their generated ids so repeated restores are no-ops.
  if (Array.isArray(backup.postcards) && backup.postcards.length > 0) {
    let inserted = 0;
    let skipped = 0;
    for (const raw of backup.postcards) {
      if (!raw || typeof raw !== 'object') {
        skipped += 1;
        continue;
      }
      const p = raw as Record<string, unknown>;
      if (typeof p.id !== 'string' || typeof p.message !== 'string' || typeof p.sender_line !== 'string') {
        skipped += 1;
        continue;
      }
      const day = (v: unknown) =>
        typeof v === 'string' ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : '';
      const periodFrom = day(p.period_from);
      const periodTo = day(p.period_to);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(periodTo)) {
        skipped += 1;
        continue;
      }
      const result = await client.query(
        `INSERT INTO postcards (id, user_id, period_from, period_to, addressed_to, sender_line,
                                stamp_city, message, images, counts, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          USER_ID,
          periodFrom,
          periodTo,
          typeof p.addressed_to === 'string' ? p.addressed_to : '',
          p.sender_line,
          typeof p.stamp_city === 'string' ? p.stamp_city : null,
          p.message,
          JSON.stringify(Array.isArray(p.images) ? p.images : []),
          JSON.stringify(p.counts && typeof p.counts === 'object' ? p.counts : {}),
          typeof p.created_at === 'string' ? p.created_at : null,
        ]
      );
      if ((result.rowCount ?? 0) > 0) inserted += 1;
      else skipped += 1;
    }
    counts.postcards = { inserted, skipped };
  }

  return counts;
}

type ExportStage = 'collecting' | 'zipping' | 'ready' | 'error';

interface ExportProgress {
  stage: ExportStage;
  processed: number;
  total: number;
}

/**
 * Collect the backup data and build the ZIP in a temp file. `onProgress`
 * reports the stage and, while zipping, how many entries are done.
 */
async function buildExport(
  onProgress: (progress: ExportProgress) => void,
): Promise<{ zipPath: string; fileName: string }> {
  let fileTempDirs: string[] = [];
  try {
    onProgress({ stage: 'collecting', processed: 0, total: 0 });
    const [
      userResult,
      settingsResult,
      companionsResult,
      postcardsResult,
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
        // Core companion table: every check-in type's rows plus standalone
        // names. Row ids are not preserved (they are never referenced).
        query(
          `SELECT checkin_type, checkin_id, name, created_at
           FROM companions
           ORDER BY name, checkin_id`
        ),
        // Postcard From Your Past history. Full rows so the restored
        // postcards keep their generated id, message, and image metadata.
        query(
          `SELECT id, period_from, period_to, addressed_to, sender_line, stamp_city,
                  message, images, counts, created_at
           FROM postcards
           WHERE user_id = $1
           ORDER BY created_at`,
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

    onProgress({ stage: 'zipping', processed: 0, total: 0 });
    const zipPath = await buildBackupZip(
      manifest,
      pluginsData,
      pluginFiles,
      companionsResult.rows,
      postcardsResult.rows,
      (p) => onProgress({ stage: 'zipping', ...p }),
    );
    const day = new Date().toISOString().slice(0, 10);
    return { zipPath, fileName: `wherewewere-backup-v${LATEST_BACKUP_SCHEMA_VERSION}-${day}.zip` };
  } finally {
    for (const dir of fileTempDirs) removeBackupTempDir(dir);
  }
}

/** Send a built backup ZIP with an exact Content-Length, then delete it. */
function sendExport(res: Response, zipPath: string, fileName: string): void {
  const dir = path.dirname(zipPath);
  const cleanup = () => removeBackupTempDir(dir);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(fs.statSync(zipPath).size));
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.on('close', cleanup);
  fs.createReadStream(zipPath)
    .on('error', (err) => {
      console.error('Error sending backup:', err);
      res.destroy();
    })
    .pipe(res);
}

// Export jobs: the build is slow, so the client starts one, polls its
// progress, then downloads the finished file.
interface ExportJob extends ExportProgress {
  zipPath?: string;
  fileName?: string;
  error?: string;
  timer?: NodeJS.Timeout;
}
const EXPORT_JOB_TTL_MS = 15 * 60 * 1000;
const exportJobs = new Map<string, ExportJob>();

function dropExportJob(id: string): void {
  const job = exportJobs.get(id);
  if (!job) return;
  if (job.timer) clearTimeout(job.timer);
  if (job.zipPath) removeBackupTempDir(path.dirname(job.zipPath));
  exportJobs.delete(id);
}

router.post('/export-jobs', (_req: Request, res: Response) => {
  const id = randomUUID();
  const job: ExportJob = { stage: 'collecting', processed: 0, total: 0 };
  exportJobs.set(id, job);
  job.timer = setTimeout(() => dropExportJob(id), EXPORT_JOB_TTL_MS);
  buildExport((p) => Object.assign(job, p))
    .then(({ zipPath, fileName }) => {
      job.zipPath = zipPath;
      job.fileName = fileName;
      job.stage = 'ready';
    })
    .catch((err) => {
      console.error('Error exporting backup:', err);
      job.stage = 'error';
      job.error = 'Failed to export backup';
    });
  res.status(202).json({ id });
});

router.get('/export-jobs/:id', (req: Request, res: Response) => {
  const job = exportJobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ error: 'Export not found' });
  const size = job.zipPath ? fs.statSync(job.zipPath).size : undefined;
  res.json({ stage: job.stage, processed: job.processed, total: job.total, size, error: job.error });
});

router.get('/export-jobs/:id/download', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const job = exportJobs.get(id);
  if (!job || job.stage !== 'ready' || !job.zipPath || !job.fileName) {
    return res.status(404).json({ error: 'Export not ready' });
  }
  const { zipPath, fileName } = job;
  // sendExport removes the file once the response closes.
  job.zipPath = undefined;
  dropExportJob(id);
  sendExport(res, zipPath, fileName);
});

router.get('/export', async (_req: Request, res: Response) => {
  try {
    const { zipPath, fileName } = await buildExport(() => {});
    sendExport(res, zipPath, fileName);
  } catch (err) {
    console.error('Error exporting backup:', err);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  let tempRoot: string | undefined;
  // Checked out only once the archive is extracted and parsed: that part is
  // slow and must not pin a pooled connection.
  let client: import('pg').PoolClient | undefined;
  try {
    let backup: ParsedBackup;

    if (req.file) {
      const name = req.file.originalname.toLowerCase();
      const isZip =
        req.file.mimetype === 'application/zip' ||
        req.file.mimetype === 'application/x-zip-compressed' ||
        name.endsWith('.zip');

      if (isZip) {
        tempRoot = await extractBackupZip(req.file.path);
        backup = parseV2Backup(tempRoot);
        backup.tempRoot = tempRoot;
      } else {
        backup = parseV1Backup(JSON.parse(fs.readFileSync(req.file.path, 'utf-8')));
      }
    } else {
      backup = parseV1Backup(req.body);
    }

    const errors: string[] = [];
    client = await pool.connect();
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
    await client?.query('ROLLBACK').catch(() => {});
    console.error('Error importing backup:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to import backup' });
  } finally {
    if (tempRoot) removeBackupTempDir(tempRoot);
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    client?.release();
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
    // All-data options (e.g. "All Venues") wipe everything a plugin owns,
    // which includes its check-ins, so they imply the check-in deletion.
    const selectedAllDataIds = allPlugins()
      .filter((p) => Boolean(rawOptions[`delete_${p.id}_all`]))
      .map((p) => p.id);
    const pluginCheckinIds = [
      ...new Set([...selectedPluginCheckinIds, ...selectedAllDataIds]),
    ];
    const resetAccountSettings = Boolean(rawOptions.reset_account_settings);
    // Wipes the entire core companion table: companions on check-ins of
    // every type plus standalone names from the Companions tab. (Check-in
    // companions are also cleaned up by each plugin's deleteUserData hook
    // when its check-ins are deleted; this option covers the rest, e.g.
    // standalone names, when only the companion data is selected.)
    const deleteCompanions = Boolean(rawOptions.delete_companions);
    // "Postcard From Your Past" history (Profile > Reflect).
    const deletePostcards = Boolean(rawOptions.delete_postcards);
    // Per-plugin settings reset: options use `reset_<pluginId>_settings`.
    const selectedPluginSettingsIds = allPlugins()
      .filter((p) => Boolean(rawOptions[`reset_${p.id}_settings`]))
      .map((p) => p.id);
    const resetIntegrationsSettings = Boolean(rawOptions.reset_integrations_settings);

    if (pluginCheckinIds.length === 0 && selectedAllDataIds.length === 0 && !resetAccountSettings && selectedPluginSettingsIds.length === 0 && !resetIntegrationsSettings && !deleteCompanions && !deletePostcards) {
      return res.status(400).json({
        error: 'No start-over actions selected',
      });
    }

    await client.query('BEGIN');

    const counts: Record<string, number> = {};

    if (pluginCheckinIds.length > 0) {
      // Check-in plugins own their deletion via their deleteUserData hook.
      const pluginCounts = await deletePluginData(client, USER_ID, pluginCheckinIds);
      for (const [pluginId, deleted] of Object.entries(pluginCounts)) {
        counts[`plugin_checkins_${pluginId}`] = deleted;
      }
    }

    for (const plugin of allPlugins()) {
      if (!selectedAllDataIds.includes(plugin.id)) continue;
      // Plugins without a deleteAllData hook keep nothing beyond check-in
      // data, so the check-in deletion above already covered everything.
      if (!plugin.server.deleteAllData) continue;
      // Runs after check-in deletion on purpose: the hook may reference
      // rows owned by check-ins (e.g. check-ins that must reference a venue).
      counts[`plugin_all_data_${plugin.id}`] = await plugin.server.deleteAllData({
        user_id: USER_ID,
        client,
      });
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

    if (deleteCompanions) {
      const companionResult = await client.query('DELETE FROM companions');
      counts.companions_deleted = companionResult.rowCount ?? 0;
    }

    if (deletePostcards) {
      const postcardsResult = await client.query('DELETE FROM postcards');
      counts.postcards_deleted = postcardsResult.rowCount ?? 0;
    }

    if (resetIntegrationsSettings) {
      const integrationSettingsResult = await client.query(
        `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key)
         VALUES ($1, NULL, NULL, NULL, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           dawarich_url = NULL,
           dawarich_api_key = NULL,
           immich_url = NULL,
           immich_api_key = NULL,
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
