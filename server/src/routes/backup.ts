import { Router, Request, Response } from 'express';
import multer from 'multer';
import { pool, query } from '../db';
import {
  deletePluginData,
  exportPluginData,
  importPluginData,
  restoreLegacyPluginData,
} from '../plugins/backup';
import { allPlugins } from '../plugins/registry';

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const BACKUP_FORMAT = 'wherewewere-backup';
const LATEST_BACKUP_SCHEMA_VERSION = 1;
const FIRST_START_OVER_CONFIRMATION = 'DELETE MY DATA';
const SECOND_START_OVER_CONFIRMATION = 'START OVER';

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON backup files are allowed'));
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
  plex_usernames: string | null;
  theme: string | null;
  system_light_theme: string | null;
  system_dark_theme: string | null;
  distance_unit: string | null;
  created_at?: string;
  updated_at?: string;
}

interface BackupMediaItem {
  id: string;
  media_type: string;
  external_source: string | null;
  external_id: string | null;
  title: string;
  author: string | null;
  release_year: number | null;
  image_url: string | null;
  external_url: string | null;
  platform?: string | null;
  overview?: string | null;
  content_rating?: string | null;
  players?: number | null;
  coop?: string | null;
  genres?: string[] | null;
  developers?: string[] | null;
  publishers?: string[] | null;
  page_count?: number | null;
  series_name?: string | null;
  series_position?: number | null;
  series_count?: number | null;
  rating?: number | null;
  raw_score?: number | string | null;
  notes?: string | null;
  time_played_minutes?: number | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupMediaCheckin {
  id: string;
  media_item_id: string;
  season_number: number | null;
  episode_number: number | null;
  episode_title: string | null;
  checkin_type: string;
  rating: number | null;
  raw_score: number | string | null;
  notes: string | null;
  time_played_minutes?: number | null;
  checked_in_at: string;
  checkin_timezone: string;
  external_event_id: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupMediaList {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface BackupMediaListItem {
  list_id: string;
  media_item_id: string;
  position: number;
  added_at: string;
}

interface BackupV1 {
  format: typeof BACKUP_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  data: {
    user: BackupUser | null;
    settings: BackupSettings | null;
    mediaItems: BackupMediaItem[];
    mediaCheckins: BackupMediaCheckin[];
    mediaLists: BackupMediaList[];
    mediaListItems: BackupMediaListItem[];
    /** Plugin-owned data (check-in types that are plugins). */
    plugins: Record<string, unknown>;
  };
  /**
   * The original `data` object as received, untyped. Legacy backup restore
   * hooks read their type-specific keys from here (they predate `plugins`).
   */
  raw?: Record<string, unknown>;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Coerce a value to a non-negative integer, or null when missing / non-finite / negative.
 * Used for INT columns (page_count, series_position, series_count) and for
 * time_played_minutes, which carries CHECK (time_played_minutes IS NULL OR >= 0).
 */
function toIntOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Coerce a value to a valid media item status, or null otherwise. */
function toStatusOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === 'completed' || v === 'in_progress' || v === 'dropped' ? v : null;
}

/**
 * Coerce a value to a string array (PG TEXT[] columns: genres/developers/
 * publishers), or null when absent. Non-string elements are dropped; an
 * array of only blanks becomes null.
 */
function toStringArrayOrNull(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const names = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '');
  return names.length > 0 ? names : null;
}

function ensureV1Backup(raw: unknown): BackupV1 {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Backup payload must be a JSON object');
  }

  const source = raw as Record<string, unknown>;
  if (source.format !== BACKUP_FORMAT) {
    throw new Error(`Unsupported backup format: expected "${BACKUP_FORMAT}"`);
  }

  const schemaVersion = toNumber(source.schemaVersion, NaN);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new Error('Backup schemaVersion must be a positive integer');
  }

  if (schemaVersion > LATEST_BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Backup schemaVersion ${schemaVersion} is newer than supported version ${LATEST_BACKUP_SCHEMA_VERSION}`
    );
  }

  // Migration hook for future schema upgrades.
  let migrated = source;
  let currentVersion = schemaVersion;
  while (currentVersion < LATEST_BACKUP_SCHEMA_VERSION) {
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
    format: BACKUP_FORMAT,
    schemaVersion: 1,
    exportedAt: typeof migrated.exportedAt === 'string' ? migrated.exportedAt : new Date().toISOString(),
    data: {
      plugins: (migratedData.plugins as Record<string, unknown>) ?? {},
      user,
      settings,
      mediaItems: asArray<BackupMediaItem>(migratedData.mediaItems),
      mediaCheckins: asArray<BackupMediaCheckin>(migratedData.mediaCheckins),
      mediaLists: asArray<BackupMediaList>(migratedData.mediaLists),
      mediaListItems: asArray<BackupMediaListItem>(migratedData.mediaListItems),
    },
    raw: migratedData,
  };
}

router.get('/export', async (_req: Request, res: Response) => {
try {
  const [
    userResult,
    settingsResult,
    mediaItemsResult,
      mediaCheckinsResult,
      mediaListsResult,
      mediaListItemsResult,
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
                plex_usernames,
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
      query(
        `SELECT id, media_type, external_source, external_id,
               title, author, release_year, image_url, external_url,
               platform, overview, content_rating, players, coop,
               genres, developers, publishers,
               page_count, series_name, series_position, series_count,
               rating, raw_score, notes, time_played_minutes, status,
               created_at, updated_at
        FROM media_items
        WHERE user_id = $1
        ORDER BY created_at ASC, title ASC`,
       [USER_ID]
     ),
     query(
       `SELECT id, media_item_id, season_number, episode_number, episode_title,
               checkin_type, rating, raw_score, notes, time_played_minutes,
               checked_in_at, checkin_timezone, external_event_id,
               created_at, updated_at
        FROM media_checkins
        WHERE user_id = $1
        ORDER BY checked_in_at ASC`,
       [USER_ID]
     ),
     query(
       `SELECT id, name, created_at, updated_at
        FROM media_lists
        WHERE user_id = $1
        ORDER BY created_at ASC`,
       [USER_ID]
     ),
     query(
       `SELECT mli.list_id, mli.media_item_id, mli.position, mli.added_at
        FROM media_list_items mli
        JOIN media_lists ml ON ml.id = mli.list_id
        WHERE ml.user_id = $1
        ORDER BY ml.created_at ASC, mli.position ASC`,
       [USER_ID]
     ),
     exportPluginData(USER_ID),
   ]);

    const payload: BackupV1 = {
      format: BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {
        user: userResult.rows[0] ?? null,
        settings: settingsResult.rows[0] ?? null,
        mediaItems: mediaItemsResult.rows,
        mediaCheckins: mediaCheckinsResult.rows,
        mediaLists: mediaListsResult.rows,
        mediaListItems: mediaListItemsResult.rows,
        plugins: pluginsData,
      },
    };

    const day = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="wherewewere-backup-v1-${day}.json"`);
    res.json(payload);
  } catch (err) {
    console.error('Error exporting backup:', err);
    res.status(500).json({ error: 'Failed to export backup' });
  }
});

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const rawPayload = req.file
      ? JSON.parse(req.file.buffer.toString('utf-8'))
      : req.body;

    const backup = ensureV1Backup(rawPayload);
    const counts: Record<string, { inserted: number; skipped: number }> = {
      mediaItems: { inserted: 0, skipped: 0 },
      mediaCheckins: { inserted: 0, skipped: 0 },
      mediaLists: { inserted: 0, skipped: 0 },
      mediaListItems: { inserted: 0, skipped: 0 },
    };
    const errors: string[] = [];

    await client.query('BEGIN');

    const pluginsPayload = (backup.data as Record<string, any>).plugins ?? null;

    if (backup.data.user?.display_name !== undefined) {
      await client.query(
        `UPDATE users
         SET display_name = COALESCE($2, display_name),
             updated_at = NOW()
         WHERE id = $1`,
        [USER_ID, backup.data.user.display_name]
      );
    }

    if (backup.data.settings) {
      const s = backup.data.settings;
      await client.query(
        `INSERT INTO user_settings (
           user_id, dawarich_url, dawarich_api_key,
           immich_url, immich_api_key, maloja_url, plex_usernames,
           theme, system_light_theme, system_dark_theme,
           distance_unit
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (user_id) DO UPDATE SET
            dawarich_url = EXCLUDED.dawarich_url,
            dawarich_api_key = EXCLUDED.dawarich_api_key,
            immich_url = EXCLUDED.immich_url,
            immich_api_key = EXCLUDED.immich_api_key,
            maloja_url = EXCLUDED.maloja_url,
            plex_usernames = EXCLUDED.plex_usernames,
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
          toStringOrNull(s.plex_usernames),
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
    if (pluginsPayload || allPlugins().some((p) => p.server.restoreLegacyBackup)) {
      const legacy = await restoreLegacyPluginData(client, USER_ID, backup.raw ?? {}, pluginsPayload);
      for (const [pluginId, pluginCounts] of Object.entries(legacy)) {
        for (const [key, pc] of Object.entries(pluginCounts)) {
          counts[key] = pc;
        }
      }
    }

    // Media: items first (so external-source dedupe is resolved before
    // check-ins and list items reference them), then check-ins, lists,
    // and finally list memberships.
    for (const item of backup.data.mediaItems) {
      if (!item?.id || !item.media_type || !item.title) {
        counts.mediaItems.skipped += 1;
        errors.push('Skipped media item with missing id/media_type/title');
        continue;
      }

      const result = await client.query(
        `INSERT INTO media_items (
           id, user_id, media_type, external_source, external_id,
           title, author, release_year, image_url, external_url,
           platform, overview, content_rating, players, coop,
           genres, developers, publishers,
           page_count, series_name, series_position, series_count,
           rating, raw_score, notes, time_played_minutes, status,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15,
           $16, $17, $18, $19, $20,
           $21, $22, $23, $24, $25, $26, $27,
           COALESCE($28::timestamptz, NOW()), COALESCE($29::timestamptz, NOW())
         )
         ON CONFLICT (id) DO NOTHING`,
         [
           item.id,
           USER_ID,
           item.media_type,
           toStringOrNull(item.external_source),
           toStringOrNull(item.external_id),
           item.title,
           toStringOrNull(item.author),
           item.release_year != null ? toNumber(item.release_year, NaN) : null,
           toStringOrNull(item.image_url),
           toStringOrNull(item.external_url),
           toStringOrNull(item.platform),
           toStringOrNull(item.overview),
           toStringOrNull(item.content_rating),
           // CHECK (players IS NULL OR players > 0) — non-positive values are
           // dropped rather than failing the insert.
           item.players != null && Number(item.players) > 0 ? Math.round(Number(item.players)) : null,
           toStringOrNull(item.coop),
           toStringArrayOrNull(item.genres),
           toStringArrayOrNull(item.developers),
           toStringArrayOrNull(item.publishers),
           toIntOrNull(item.page_count),
           toStringOrNull(item.series_name),
           toIntOrNull(item.series_position),
           toIntOrNull(item.series_count),
           item.rating != null ? toNumber(item.rating, NaN) : null,
           item.raw_score != null ? String(item.raw_score) : null,
           toStringOrNull(item.notes),
           toIntOrNull(item.time_played_minutes),
           toStatusOrNull(item.status),
           item.created_at || null,
           item.updated_at || null,
         ]
       );

      if (result.rowCount === 1) {
        counts.mediaItems.inserted += 1;
      } else {
        counts.mediaItems.skipped += 1;
      }
    }

    for (const checkin of backup.data.mediaCheckins) {
      if (!checkin?.id || !checkin.media_item_id) {
        counts.mediaCheckins.skipped += 1;
        errors.push('Skipped media check-in with missing id/media_item_id');
        continue;
      }

      const result = await client.query(
        `INSERT INTO media_checkins (
           id, user_id, media_item_id,
           season_number, episode_number, episode_title,
           checkin_type, rating, raw_score, notes, time_played_minutes,
           checked_in_at, checkin_timezone, external_event_id,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3,
           $4, $5, $6,
           $7, $8, $9, $10, $11,
           COALESCE($12::timestamptz, NOW()), $13,
           $14,
           COALESCE($15::timestamptz, NOW()),
           COALESCE($16::timestamptz, NOW())
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          checkin.id,
          USER_ID,
          checkin.media_item_id,
          checkin.season_number ?? null,
          checkin.episode_number ?? null,
          toStringOrNull(checkin.episode_title),
          checkin.checkin_type || 'completed',
          checkin.rating != null ? toNumber(checkin.rating, NaN) : null,
          checkin.raw_score != null ? String(checkin.raw_score) : null,
          toStringOrNull(checkin.notes),
          toIntOrNull(checkin.time_played_minutes),
          checkin.checked_in_at || null,
          toStringOrNull(checkin.checkin_timezone) || 'UTC',
          toStringOrNull(checkin.external_event_id),
          checkin.created_at || null,
          checkin.updated_at || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.mediaCheckins.inserted += 1;
      } else {
        counts.mediaCheckins.skipped += 1;
      }
    }

    for (const list of backup.data.mediaLists) {
      if (!list?.id || !list.name) {
        counts.mediaLists.skipped += 1;
        errors.push('Skipped media list with missing id/name');
        continue;
      }

      const result = await client.query(
        `INSERT INTO media_lists (id, user_id, name, created_at, updated_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [list.id, USER_ID, list.name, list.created_at || null, list.updated_at || null]
      );

      if (result.rowCount === 1) {
        counts.mediaLists.inserted += 1;
      } else {
        counts.mediaLists.skipped += 1;
      }
    }

    for (const listItem of backup.data.mediaListItems) {
      if (!listItem?.list_id || !listItem.media_item_id) {
        counts.mediaListItems.skipped += 1;
        errors.push('Skipped media list item with missing list_id/media_item_id');
        continue;
      }

      const result = await client.query(
        `INSERT INTO media_list_items (list_id, media_item_id, position, added_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
         ON CONFLICT (list_id, media_item_id) DO NOTHING`,
        [
          listItem.list_id,
          listItem.media_item_id,
          toNumber(listItem.position, 0),
          listItem.added_at || null,
        ]
      );

      if (result.rowCount === 1) {
        counts.mediaListItems.inserted += 1;
      } else {
        counts.mediaListItems.skipped += 1;
      }
    }

    // Plugin data (generic + custom storage) — restored inside the same
    // transaction, honoring each plugin's declared backupOrder.
    if (pluginsPayload) {
      const pluginCounts = await importPluginData(client, USER_ID, pluginsPayload);
      for (const [pluginId, pc] of Object.entries(pluginCounts)) {
        counts[`plugin:${pluginId}`] = pc;
      }
    }

    await client.query('COMMIT');

    res.json({
      message: 'Backup import complete',
      schemaVersion: backup.schemaVersion,
      counts,
      errors,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error importing backup:', err);
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to import backup' });
  } finally {
    client.release();
  }
});

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
    // Legacy `delete_venue_checkins` maps to the location plugin.
    const legacyVenueDelete = deleteAllCheckins || Boolean(rawOptions.delete_venue_checkins);
    const selectedPluginCheckinIds = allPlugins()
      .filter((p) => deleteAllCheckins
        || Boolean(rawOptions[`delete_${p.id}_checkins`])
        || (legacyVenueDelete && p.id === 'location'))
      .map((p) => p.id);
    const deleteMediaItems = Boolean(rawOptions.delete_media_items);
    const resetAccountSettings = Boolean(rawOptions.reset_account_settings);
    // Per-plugin settings reset: options use `reset_<pluginId>_settings`.
    const selectedPluginSettingsIds = allPlugins()
      .filter((p) => Boolean(rawOptions[`reset_${p.id}_settings`]))
      .map((p) => p.id);
    const resetIntegrationsSettings = Boolean(rawOptions.reset_integrations_settings);

    if (selectedPluginCheckinIds.length === 0 && !deleteMediaItems && !resetAccountSettings && selectedPluginSettingsIds.length === 0 && !resetIntegrationsSettings) {
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

    if (deleteMediaItems) {
      // Delete all locally stored media: check-ins, list items, cached episodes, items, and lists.
      const mediaCheckinsResult = await client.query('DELETE FROM media_checkins WHERE user_id = $1', [USER_ID]);
      counts.media_checkins = mediaCheckinsResult.rowCount ?? 0;
      const listItemsResult = await client.query(
        'DELETE FROM media_list_items WHERE list_id IN (SELECT id FROM media_lists WHERE user_id = $1)',
        [USER_ID]
      );
      counts.media_list_items = listItemsResult.rowCount ?? 0;

      const episodesResult = await client.query(
        'DELETE FROM media_tv_episodes WHERE media_item_id IN (SELECT id FROM media_items WHERE user_id = $1)',
        [USER_ID]
      );
      counts.media_tv_episodes = episodesResult.rowCount ?? 0;

      const itemsResult = await client.query('DELETE FROM media_items WHERE user_id = $1', [USER_ID]);
      counts.media_items = itemsResult.rowCount ?? 0;

      const listsResult = await client.query('DELETE FROM media_lists WHERE user_id = $1', [USER_ID]);
      counts.media_lists = listsResult.rowCount ?? 0;
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
        `INSERT INTO user_settings (user_id, dawarich_url, dawarich_api_key, immich_url, immich_api_key, maloja_url, plex_usernames)
         VALUES ($1, NULL, NULL, NULL, NULL, NULL, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
           dawarich_url = NULL,
           dawarich_api_key = NULL,
           immich_url = NULL,
           immich_api_key = NULL,
           maloja_url = NULL,
           plex_usernames = NULL,
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
