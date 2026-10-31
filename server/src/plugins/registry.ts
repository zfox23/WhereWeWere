/**
 * Server-side check-in type plugin registry.
 *
 * Each plugin folder under `plugins/<name>/` contains:
 *   - manifest.ts  (pure data: id, version, fields, strings)
 *   - server.ts    (exports `server: CheckinTypeServerPlugin`)
 *
 * The registry joins the manifest with the server half and enforces
 * duplicate-id detection. Built-in check-in types register here as plugins
 * during the transition; until then the timeline route also keeps its
 * hard-coded branches.
 */

import type { CheckinTypeServer, PluginTimelineContext } from 'wwp-shared';
import { isValidPluginId } from 'wwp-shared';
import { query } from '../db';
import { genericTimelineSelect, genericTimelineWhere } from './genericStore';
import { isUuid } from '../services/batching';

// Import plugin server halves here. Convention:
//   import { server as moodServer } from '../../../plugins/mood/server';
//   import { manifest as moodManifest } from '../../../plugins/mood/manifest';
import { server as moodServer } from '../../../plugins/mood/server';
import { manifest as moodManifest } from '../../../plugins/mood/manifest';
import { server as sleepServer } from '../../../plugins/sleep/server';
import { manifest as sleepManifest } from '../../../plugins/sleep/manifest';
import { server as tracksServer } from '../../../plugins/tracks/server';
import { manifest as tracksManifest } from '../../../plugins/tracks/manifest';
import { server as locationServer } from '../../../plugins/location/server';
import { manifest as locationManifest } from '../../../plugins/location/manifest';
import { server as mediaServer } from '../../../plugins/media/server';
import { manifest as mediaManifest } from '../../../plugins/media/manifest';
import { server as scubaServer } from '../../../plugins/scuba/server';
import { manifest as scubaManifest } from '../../../plugins/scuba/manifest';
import { server as musicServer } from '../../../plugins/music/server';
import { manifest as musicManifest } from '../../../plugins/music/manifest';
import { server as foodServer } from '../../../plugins/food/server';
import { manifest as foodManifest } from '../../../plugins/food/manifest';
import { server as notesServer } from '../../../plugins/notes/server';
import { manifest as notesManifest } from '../../../plugins/notes/manifest';

const registrations: CheckinTypeServer[] = [
  { ...moodManifest, server: moodServer },
  { ...sleepManifest, server: sleepServer },
  { ...tracksManifest, server: tracksServer },
  { ...locationManifest, server: locationServer },
  { ...mediaManifest, server: mediaServer },
  { ...scubaManifest, server: scubaServer },
  { ...musicManifest, server: musicServer },
  { ...foodManifest, server: foodServer },
  { ...notesManifest, server: notesServer },
];

const byId = new Map<string, CheckinTypeServer>();

for (const plugin of registrations) {
  if (!isValidPluginId(plugin.id)) {
    throw new Error(`Plugin id "${plugin.id}" is invalid (must match /^[a-z][a-z0-9_]*$/)`);
  }
  if (byId.has(plugin.id)) {
    throw new Error(`Duplicate check-in plugin id: ${plugin.id}`);
  }
  byId.set(plugin.id, plugin);
}

/** All registered plugins, in registration order. */
export function allPlugins(): CheckinTypeServer[] {
  return registrations;
}

/**
 * Register a plugin at runtime (tests only). Production plugins are
 * registered statically above; this exists so test fixtures can exercise
 * the framework without being shipped. The plugin must be created before
 * the Express app is built (routes capture branch lists at startup).
 */
export function registerPlugin(plugin: CheckinTypeServer): void {
  if (!isValidPluginId(plugin.id)) {
    throw new Error(`Plugin id "${plugin.id}" is invalid (must match /^[a-z][a-z0-9_]*$/)`);
  }
  if (byId.has(plugin.id)) {
    throw new Error(`Duplicate check-in plugin id: ${plugin.id}`);
  }
  registrations.push(plugin);
  byId.set(plugin.id, plugin);
}

/** Look up a plugin by id. */
export function getPlugin(id: string): CheckinTypeServer | undefined {
  return byId.get(id);
}

/** True when a plugin with this id is registered. */
export function hasPlugin(id: string): boolean {
  return byId.has(id);
}

/** All plugin ids. */
export function pluginIds(): string[] {
  return Array.from(byId.keys());
}

/**
 * All earliest-date sources: built-in types plus every plugin's hook.
 * Returns `{ key, sql }` entries (entries without a hook are omitted).
 */
export function earliestDateSources(): { key: string; sql: string }[] {
  const sources: { key: string; sql: string }[] = [];
  for (const plugin of allPlugins()) {
    const hook = plugin.server.earliestDate?.();
    if (hook) sources.push({ key: plugin.id, sql: hook.sql });
  }
  return sources;
}

/**
 * SQL branches resolving check-in ids to anchor timestamps (id, checked_in_at)
 * for photo/scrobble enrichment. Each branch is a full SELECT filtering on
 * $1 (uuid[]). Use {@link pluginTimestampUnion} to combine them.
 */
export function pluginTimestampBranches(): string[] {
  return allPlugins()
    .map((plugin) => plugin.server.resolveTimestamps?.().sql ?? null)
    .filter((sql): sql is string => sql !== null);
}

/**
 * UNION of every plugin's `resolveTimestamps` branch — the complete set of
 * check-in anchor-timestamp lookups. Returns a single expression like
 * `SELECT ... WHERE ... UNION ALL SELECT ... WHERE ...`, or a no-op
 * `SELECT ... WHERE FALSE` when no plugins contribute (so callers can keep
 * a stable (id, checked_in_at) column shape). `indent` is applied to each
 * continuation line.
 *
 * NOT user-scoped: the branches resolve any id. Never feed it ids from a
 * client or a backup without first narrowing them to the user's own
 * check-ins with {@link ownedCheckinTypes}.
 */
export function pluginTimestampUnion(indent = ''): string {
  const branches = pluginTimestampBranches();
  if (branches.length === 0) {
    return `SELECT NULL::uuid AS id, NULL::timestamptz AS checked_in_at WHERE FALSE`;
  }
  const sep = `\n${indent}UNION ALL`;
  return branches.map((b) => `(\n${indent}${b.trim()}\n${indent})`).join(sep);
}

/**
 * SQL branches for the "this day in previous years" reflection list. Each
 * branch is a parenthesized SELECT matching the core reflection column shape
 * (type, id, checked_in_at, note, venue_*, reflection_year, years_ago,
 * data jsonb) and uses $1 (user_id) and $2 (target date).
 */
export function pluginReflectionBranches(): string[] {
  return allPlugins()
    .map((plugin) => plugin.server.reflectionBranch?.().sql ?? null)
    .filter((sql): sql is string => sql !== null)
    .map((sql) => `(\n        ${sql.trim()}\n        )`);
}

/** Rebase $n placeholders so they start after `offset` parameters. */
export function rebasePlaceholders(sql: string, offset: number): string {
  return sql.replace(/\$(\d+)/g, (_m, n) => `$${offset + parseInt(n, 10)}`);
}

/**
 * One user's check-ins of every type as `(type, id)` rows: the union of each
 * plugin's timeline branch filtered to `userId` (and, defensively, re-checked
 * on the branch's `user_id` envelope column), plus its resolveTimestamps
 * rows restricted to `user_id`. Use it whenever a client- or backup-supplied
 * check-in id must be proven to belong to the user (`resolveTimestamps` alone
 * resolves anyone's ids).
 *
 * Placeholders start after `paramOffset`; append `values` to the caller's
 * parameter list in that position.
 */
export function userCheckinRefsSql(userId: string, paramOffset = 0): { sql: string; values: unknown[] } {
  const values: unknown[] = [userId];
  const userParam = `$${paramOffset + 1}`;
  const branches: string[] = [];
  for (const plugin of allPlugins()) {
    const ctx: PluginTimelineContext = { user_id: userId, from: null, to: null, q: null, filterParams: {} };
    let selectSql: string;
    let clause: { sql: string | null; values: unknown[] } | null;
    if (plugin.server.storage === 'custom') {
      if (!plugin.server.buildTimelineSelect || !plugin.server.buildTimelineWhere) continue;
      selectSql = plugin.server.buildTimelineSelect().sql;
      clause = plugin.server.buildTimelineWhere(ctx);
    } else {
      selectSql = genericTimelineSelect(plugin.id);
      clause = genericTimelineWhere(plugin, ctx);
    }
    const where = clause?.sql ? rebasePlaceholders(clause.sql, paramOffset + values.length) : null;
    values.push(...(clause?.values ?? []));
    branches.push(
      `SELECT b.type, b.id FROM (\n${selectSql}\n${where ? `WHERE ${where}` : ''}\n) b WHERE b.user_id = ${userParam}`,
    );
    // A timeline row isn't always a check-in row (music's timeline lists
    // listening sessions while companions and anchors key on scrobbles), so
    // also take the plugin's resolveTimestamps rows, with its id filter
    // swapped for the user filter.
    const resolveSql = plugin.server.resolveTimestamps?.().sql;
    const scoped = resolveSql ? userScopedTimestampBranch(resolveSql, userParam) : null;
    if (scoped) {
      branches.push(`SELECT '${plugin.id}'::text AS type, r.id FROM (\n${scoped}\n) r`);
    }
  }
  if (branches.length === 0) {
    return { sql: 'SELECT NULL::text AS type, NULL::uuid AS id WHERE FALSE', values };
  }
  return { sql: branches.map((b) => `(${b})`).join('\nUNION ALL\n'), values };
}

const RESOLVE_ID_FILTER = /(?<![\w.])id\s*=\s*ANY\(\s*\$1::uuid\[\]\s*\)/i;

/**
 * A resolveTimestamps branch (single-table `... WHERE id = ANY($1::uuid[])`)
 * rewritten to list the user's rows instead: the id filter becomes
 * `user_id = <userParam>`. Null when the branch doesn't have that exact shape
 * (or uses other placeholders) — the caller then simply skips it, so an
 * unexpected shape can only hide rows, never widen the result.
 */
function userScopedTimestampBranch(sql: string, userParam: string): string | null {
  if (!RESOLVE_ID_FILTER.test(sql)) return null;
  const scoped = sql.replace(RESOLVE_ID_FILTER, `user_id = ${userParam}`);
  if (/\$\d/.test(scoped.split(userParam).join(''))) return null;
  return scoped;
}

/**
 * Which of `ids` are check-ins owned by `userId`, as a map id -> check-in
 * type (keys are lowercase). Ids belonging to another user (or to nothing)
 * are simply absent.
 * Pass the caller's transaction client to see rows it has not committed yet.
 */
export async function ownedCheckinTypes(
  userId: string,
  ids: string[],
  executor: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> } = { query },
): Promise<Map<string, string>> {
  const owned = new Map<string, string>();
  const uuids = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))];
  if (uuids.length === 0) return owned;
  const refs = userCheckinRefsSql(userId, 1);
  const result = await executor.query(
    `SELECT DISTINCT type, id FROM (\n${refs.sql}\n) refs WHERE refs.id = ANY($1::uuid[])`,
    [uuids, ...refs.values],
  );
  for (const row of result.rows) owned.set(String(row.id), String(row.type));
  return owned;
}
