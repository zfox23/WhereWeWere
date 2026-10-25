/**
 * Music plugin — per-scrobble timezone assignment.
 *
 * Scrobble sources send only epoch seconds, so a play's local zone is taken
 * from the user's other check-ins: the zone of the latest timezone-bearing
 * check-in at or before the play (any plugin that declares `timezoneAnchors`).
 * Plays before the first such check-in get the fallback zone.
 */

import { isValidTimeZone } from 'wwp-shared';
import { query } from '../../../server/src/db';
import { allPlugins } from '../../../server/src/plugins/registry';

export interface TimezoneAnchor {
  /** Epoch milliseconds. */
  at: number;
  timezone: string;
}

/**
 * The timezone in effect at `ms`: that of the latest anchor at or before it,
 * else `fallback`. `anchors` must be sorted ascending by `at`.
 */
export function timezoneAt(anchors: TimezoneAnchor[], ms: number, fallback: string): string {
  let lo = 0;
  let hi = anchors.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].at <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? anchors[lo - 1].timezone : fallback;
}

/**
 * Every usable anchor across plugins, sorted. UTC anchors are dropped: imports
 * and webhooks label unknown zones "UTC", so it says nothing about where the
 * user was (the reconciliation tool treats it the same way).
 */
export async function loadTimezoneAnchors(userId: string): Promise<TimezoneAnchor[]> {
  const anchors: TimezoneAnchor[] = [];
  for (const plugin of allPlugins()) {
    const hook = plugin.server.timezoneAnchors;
    if (!hook) continue;
    const result = await query(hook().sql, [userId]);
    for (const row of result.rows as { at: Date | string; timezone: string | null }[]) {
      if (!row.timezone || row.timezone === 'UTC' || !isValidTimeZone(row.timezone)) continue;
      const at = new Date(row.at).getTime();
      if (Number.isFinite(at)) anchors.push({ at, timezone: row.timezone });
    }
  }
  return anchors.sort((a, b) => a.at - b.at);
}

/** Timezones for the given moments, in the same order. */
export async function resolveTimezones(userId: string, times: Date[], fallback: string): Promise<string[]> {
  if (times.length === 0) return [];
  const anchors = await loadTimezoneAnchors(userId);
  return times.map((t) => timezoneAt(anchors, t.getTime(), fallback));
}
