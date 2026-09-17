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

const registrations: CheckinTypeServer[] = [
  { ...moodManifest, server: moodServer },
  { ...sleepManifest, server: sleepServer },
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
 * SQL branches resolving check-in ids to anchor timestamps (id, checked_in_at)
 * for photo/scrobble enrichment. Each branch filters on $1 (uuid[]). Core
 * routes UNION these with their built-in branches.
 */
export function pluginTimestampBranches(): string[] {
  return allPlugins()
    .map((plugin) => plugin.server.resolveTimestamps?.().sql ?? null)
    .filter((sql): sql is string => sql !== null);
}

/**
 * Pre-joined version of {@link pluginTimestampBranches} for splicing after a
 * core SELECT branch: returns 'UNION ALL <branch>' segments including the
 * separator BEFORE the first branch, or '' when no plugins contribute.
 * `indent` is applied to each continuation line.
 */
export function pluginTimestampBranchUnion(indent = ''): string {
  const branches = pluginTimestampBranches();
  if (branches.length === 0) return '';
  const sep = `UNION ALL\n${indent}`;
  return sep + branches.join(sep);
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
