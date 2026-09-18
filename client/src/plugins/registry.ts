/**
 * Client-side check-in type plugin registry.
 *
 * Joins each plugin's shared manifest (from plugins/<name>/manifest.ts)
 * with its client half (plugins/<name>/client.tsx). Enforces duplicate-id
 * detection and provides the lookup helpers the app shell (Home, Profile,
 * Settings, routing) uses to render plugin check-in types.
 */

import type { CheckinTypeClient } from 'wwp-shared';
import { isValidPluginId } from 'wwp-shared';

// Register plugins here. Convention:
//   import { client as moodClient, manifest as moodManifest } from '../../../plugins/mood/client';
import { client as moodClient, manifest as moodManifest } from '../../../plugins/mood/client';
import { client as sleepClient, manifest as sleepManifest } from '../../../plugins/sleep/client';
import { client as tracksClient, manifest as tracksManifest } from '../../../plugins/tracks/client';

const registrations: CheckinTypeClient[] = [
  { ...moodManifest, client: moodClient },
  { ...sleepManifest, client: sleepClient },
  { ...tracksManifest, client: tracksClient },
];

const byId = new Map<string, CheckinTypeClient>();

for (const plugin of registrations) {
  if (!isValidPluginId(plugin.id)) {
    throw new Error(`Plugin id "${plugin.id}" is invalid (must match /^[a-z][a-z0-9_]*$/)`);
  }
  if (byId.has(plugin.id)) {
    throw new Error(`Duplicate check-in plugin id: ${plugin.id}`);
  }
  byId.set(plugin.id, plugin);
}

/** All registered client plugins, in registration order. */
export function allClientPlugins(): CheckinTypeClient[] {
  return registrations;
}

/** Look up a client plugin by id. */
export function getClientPlugin(id: string): CheckinTypeClient | undefined {
  return byId.get(id);
}

/** True when a client plugin with this id is registered. */
export function hasClientPlugin(id: string): boolean {
  return byId.has(id);
}

/**
 * Detail route for a plugin's check-in: the plugin's detailPath pattern with
 * :id substituted, or the generic fallback.
 */
export function pluginDetailPath(pluginId: string, checkinId: string): string {
  const plugin = byId.get(pluginId);
  if (plugin?.client.detailPath) {
    return plugin.client.detailPath.replace(':id', checkinId);
  }
  return `/checkins/${pluginId}/${checkinId}`;
}

/** Detail route from a timeline item (works for built-in types too). */
export function timelineDetailPath(item: { type: string; id: string }): string {
  if (hasClientPlugin(item.type)) {
    return pluginDetailPath(item.type, item.id);
  }
  // Legacy built-in routes.
  switch (item.type) {
    case 'location': return `/checkins/${item.id}`;
    case 'media': return `/media/checkins/${item.id}`;
    default: return `/checkins/${item.type}/${item.id}`;
  }
}
