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

import type { CheckinTypeServer } from 'wwp-shared';
import { isValidPluginId } from 'wwp-shared';

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

const registrations: CheckinTypeServer[] = [
  { ...moodManifest, server: moodServer },
  { ...sleepManifest, server: sleepServer },
  { ...tracksManifest, server: tracksServer },
  { ...locationManifest, server: locationServer },
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
 * Earliest-date hooks for core built-in check-in types, keyed by the
 * response key the client expects. As of the location plugin migration no
 * core built-in types remain — every check-in type (location, mood, sleep,
 * tracks) contributes its own `earliestDate` hook (keyed by plugin id).
 */
export const BUILTIN_EARLIEST_DATES: Record<string, { sql: string }> = {};

/**
 * All earliest-date sources: built-in types plus every plugin's hook.
 * Returns `{ key, sql }` entries (entries without a hook are omitted).
 */
export function earliestDateSources(): { key: string; sql: string }[] {
  const sources: { key: string; sql: string }[] = [];
  for (const [key, hook] of Object.entries(BUILTIN_EARLIEST_DATES)) {
    sources.push({ key, sql: hook.sql });
  }
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
