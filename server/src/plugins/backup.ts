/**
 * Framework backup/restore/start-over support for check-in type plugins.
 *
 * Export shape (under backup.data.plugins):
 *   {
 *     [pluginId]: {
 *       checkins: <rows from backupExport, generic rows for generic storage>,
 *       extra: { [tableName]: rows[] },  // custom storage extraBackupTables
 *       settings: { [key]: value }       // plugin_settings rows (key -> value)
 *     }
 *   }
 *
 * Import:
 *   - generic plugins: plugin_checkins rows are re-inserted with the backup
 *     id (ON CONFLICT DO NOTHING).
 *   - custom plugins: restore steps run in `backupOrder` — 'primary' runs
 *     backupImport(payload.checkins), extra table names run the declared
 *     select/insert templates.
 *   - `settings` are upserted into plugin_settings (only keys declared in
 *     the plugin's settingsKeys, when the plugin declares any).
 *   - When a plugin's payload is present, its `legacyBackupKeys` are
 *     claimed: the caller must skip the corresponding legacy import loops.
 *
 * File bundles (backup v2 ZIPs): exportPluginFiles() collects each
 * plugin's backupFiles so the caller can add them to the archive under
 * plugins/<id>/<zipPath>. On restore, importPluginData passes
 * options.filesDir (the extracted plugins/<id> directory) into the hook
 * context so file-based plugins can read their originals back.
 */

import type { PoolClient } from 'pg';
import { query } from '../db';
import { allPlugins } from './registry';
import { exportGenericCheckins, importGenericCheckins, type PluginCheckinBackupRow } from './genericStore';

export interface PluginBackupEntry {
  checkins: unknown;
  extra?: Record<string, Record<string, unknown>[]>;
  /** Stored plugin settings (plugin_settings rows) keyed by setting name. */
  settings?: Record<string, unknown>;
}

export type PluginBackupPayload = Record<string, PluginBackupEntry>;

/**
 * A plugin file to ship in a v2 ZIP bundle: the plugin id, the path inside
 * the ZIP relative to `plugins/<id>/`, and the absolute path on disk to
 * read from.
 */
export interface PluginBackupFile {
  pluginId: string;
  /** Relative to plugins/<id>/ inside the ZIP (e.g. "files/<id>.gpx"). */
  zipPath: string;
  absPath: string;
}

/** Collect all plugin data for a backup. */
export async function exportPluginData(user_id: string): Promise<PluginBackupPayload> {
  const out: PluginBackupPayload = {};

  for (const plugin of allPlugins()) {
    const isCustom = plugin.server.storage === 'custom';
    if (isCustom) {
      if (!plugin.server.backupExport) {
        throw new Error(`Plugin "${plugin.id}" declares custom storage but has no backupExport`);
      }
      const checkins = await plugin.server.backupExport({ user_id });
      const extra: Record<string, Record<string, unknown>[]> = {};
      for (const table of plugin.server.extraBackupTables ?? []) {
        const result = await query(table.select, [user_id]);
        extra[table.table] = result.rows;
      }
      const entry: PluginBackupEntry = Object.keys(extra).length > 0
        ? { checkins, extra }
        : { checkins };
      const settings = await exportPluginSettings(user_id, plugin.id);
      if (settings) entry.settings = settings;
      out[plugin.id] = entry;
    } else {
      const checkins = await exportGenericCheckins(user_id, plugin.id);
      const entry: PluginBackupEntry = { checkins };
      const settings = await exportPluginSettings(user_id, plugin.id);
      if (settings) entry.settings = settings;
      out[plugin.id] = entry;
    }
  }

  return out;
}

/**
 * Collect the files a v2 backup bundle should ship (backup v2 ZIPs only).
 * For each custom-storage plugin that declares a `backupFiles` hook, the
 * returned refs name the ZIP entry (`plugins/<id>/<zipPath>`) and the
 * on-disk source. Plugins that stage generated files may also return a
 * `tempDir`, which the caller must remove after the archive is complete
 * (collected in `tempDirs`).
 *
 * NOTE: callers must run exportPluginData FIRST — hooks like tracks'
 * backupFiles depend on decisions made during backupExport.
 */
export async function exportPluginFiles(
  user_id: string,
): Promise<{ files: PluginBackupFile[]; tempDirs: string[] }> {
  const out: PluginBackupFile[] = [];
  const tempDirs: string[] = [];
  for (const plugin of allPlugins()) {
    const hook = plugin.server.backupFiles;
    if (!hook) continue;
    const result = await hook({ user_id });
    for (const ref of result.files) {
      out.push({ pluginId: plugin.id, zipPath: ref.zipPath, absPath: ref.absPath });
    }
    if (result.tempDir) tempDirs.push(result.tempDir);
  }
  return { files: out, tempDirs };
}

/**
 * Read the user's stored rows for a plugin from plugin_settings as a
 * key -> value map, or `undefined` when the plugin has no stored settings.
 */
async function exportPluginSettings(
  user_id: string,
  pluginId: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await query(
    `SELECT key, value FROM plugin_settings WHERE user_id = $1 AND plugin_id = $2`,
    [user_id, pluginId],
  );
  if (result.rows.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const row of result.rows) out[row.key] = row.value;
  return out;
}

/**
 * Which legacy backup data keys are claimed by plugins that have a payload.
 * The backup import must skip the legacy loops for these keys.
 */
export function claimedLegacyKeys(pluginsPayload: PluginBackupPayload | null | undefined): Set<string> {
  const claimed = new Set<string>();
  if (!pluginsPayload) return claimed;
  for (const plugin of allPlugins()) {
    if (pluginsPayload[plugin.id]) {
      for (const key of plugin.server.legacyBackupKeys ?? []) {
        claimed.add(key);
      }
    }
  }
  return claimed;
}

export interface PluginImportCounts {
  [pluginKey: string]: { inserted: number; skipped: number };
}

/**
 * Dispatch a *legacy* backup (one that predates the `plugins` section and
 * stores check-in types under top-level keys) to the plugins that declared
 * `restoreLegacyBackup`. A plugin is skipped when the backup already carries
 * its `plugins.<id>` payload (that path restores it via importPluginData),
 * which prevents double-imports. Returns a map of pluginId -> per-legacy-key
 * counts; the caller must skip its own legacy import loops for every
 * pluginId present in the result.
 */
export async function restoreLegacyPluginData(
  client: PoolClient,
  user_id: string,
  data: Record<string, unknown>,
  pluginsPayload: PluginBackupPayload | null | undefined,
  errors?: string[],
): Promise<Record<string, Record<string, { inserted: number; skipped: number }>>> {
  const out: Record<string, Record<string, { inserted: number; skipped: number }>> = {};
  for (const plugin of allPlugins()) {
    const hook = plugin.server.restoreLegacyBackup;
    if (!hook) continue;
    if (pluginsPayload?.[plugin.id]) continue; // new-format payload handles it
    out[plugin.id] = await hook({ user_id, client, errors }, data);
  }
  return out;
}

/**
 * Restore plugin data from a backup payload. Must run inside the caller's
 * transaction (on `client`). Returns per-plugin counts.
 *
 * `filesDirs` (backup v2 ZIP restores) maps a plugin id to the directory
 * where that plugin's bundled files were extracted; it is passed to
 * `backupImport` as `ctx.filesDir` so file-based plugins can read their
 * originals back.
 */
export async function importPluginData(
  client: PoolClient,
  user_id: string,
  pluginsPayload: PluginBackupPayload,
  filesDirs?: Record<string, string>,
  errors?: string[],
): Promise<PluginImportCounts> {
  const counts: PluginImportCounts = {};

  for (const plugin of allPlugins()) {
    const entry = pluginsPayload[plugin.id];
    if (!entry) continue;

    const isCustom = plugin.server.storage === 'custom';
    const order = plugin.server.backupOrder ?? (
      isCustom ? ['primary', ...(plugin.server.extraBackupTables ?? []).map((t) => t.table)] : ['primary']
    );

    const pluginCounts = { inserted: 0, skipped: 0 };

    for (const step of order) {
      if (step === 'primary') {
        if (isCustom) {
          if (!plugin.server.backupImport) {
            throw new Error(`Plugin "${plugin.id}" declares custom storage but has no backupImport`);
          }
          const inserted = await plugin.server.backupImport(
            { user_id, client, filesDir: filesDirs?.[plugin.id], errors },
            entry.checkins,
          );
          pluginCounts.inserted += inserted;
        } else {
          const result = await importGenericCheckins(user_id, entry.checkins as PluginCheckinBackupRow[] | null, client);
          pluginCounts.inserted += result.inserted;
          pluginCounts.skipped += result.skipped;
        }
      } else {
        const table = (plugin.server.extraBackupTables ?? []).find((t) => t.table === step);
        if (!table) {
          throw new Error(`Plugin "${plugin.id}" backupOrder references unknown table "${step}"`);
        }
        const rows = entry.extra?.[table.table] ?? [];
        for (const row of rows) {
          const values = table.userIdFirst ? [user_id, ...Object.values(row)] : Object.values(row);
          const result = await client.query(table.insert, values);
          if ((result.rowCount ?? 0) > 0) pluginCounts.inserted += 1;
          else pluginCounts.skipped += 1;
        }
      }
    }

    // Plugin settings (plugin_settings rows): upsert, overwriting current
    // values. When the plugin declares settingsKeys, only declared keys are
    // written (mirrors setPluginSettings, and keeps renamed/stale keys out
    // of the table).
    if (entry.settings && typeof entry.settings === 'object') {
      const declared = new Set((plugin.server.settingsKeys ?? []).map((k) => k.name));
      for (const [key, value] of Object.entries(entry.settings)) {
        if (declared.size > 0 && !declared.has(key)) continue;
        const result = await client.query(
          `INSERT INTO plugin_settings (user_id, plugin_id, key, value)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (user_id, plugin_id, key) DO UPDATE
           SET value = EXCLUDED.value
           WHERE plugin_settings.value IS DISTINCT FROM EXCLUDED.value`,
          [user_id, plugin.id, key, JSON.stringify(value)],
        );
        if ((result.rowCount ?? 0) > 0) pluginCounts.inserted += 1;
        else pluginCounts.skipped += 1;
      }
    }

    counts[plugin.id] = pluginCounts;
  }

  return counts;
}

/**
 * Start-over: delete all plugin data for the user. Returns per-plugin row
 * counts (generic rows deleted for generic plugins; deleteUserData for
 * custom plugins plus cascade-deleted extra tables). The plugin's
 * `plugin_settings` rows are always deleted as part of this — a plugin's
 * settings belong to its check-in data, so deleting check-ins wipes them
 * too. (Deleting settings WITHOUT check-ins is handled separately by the
 * start-over route via the resetSettings flow.)
 */
export async function deletePluginData(
  client: PoolClient,
  user_id: string,
  /** When provided, only these plugin ids are deleted; otherwise ALL plugins. */
  pluginIds?: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const selected = pluginIds ? allPlugins().filter((p) => pluginIds.includes(p.id)) : allPlugins();

  for (const plugin of selected) {
    let deleted = 0;
    if (plugin.server.storage === 'custom') {
      if (!plugin.server.deleteUserData) {
        throw new Error(`Plugin "${plugin.id}" declares custom storage but has no deleteUserData`);
      }
      deleted = await plugin.server.deleteUserData({ user_id, client });
    } else {
      const result = await client.query(
        `DELETE FROM plugin_checkins WHERE user_id = $1 AND plugin_id = $2 RETURNING id`,
        [user_id, plugin.id],
      );
      deleted = result.rowCount ?? 0;
    }
    // Settings belong to the plugin's data: always wipe them with it.
    const settingsResult = await client.query(
      `DELETE FROM plugin_settings WHERE user_id = $1 AND plugin_id = $2`,
      [user_id, plugin.id],
    );
    deleted += settingsResult.rowCount ?? 0;
    counts[plugin.id] = deleted;
  }

  return counts;
}
