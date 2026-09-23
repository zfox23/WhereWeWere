import type {
  CheckinTypeServer,
  PluginReconciliationHook,
  PluginReconciliationRow,
} from 'wwp-shared';
import { allPlugins } from '../plugins/registry';

import { DEFAULT_USER_ID as USER_ID } from '../constants';
const NEARBY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FALLBACK_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Every check-in plugin (location, mood, sleep, tracks, media, ...)
 * participates in reconciliation. `type` on suggestions/uninferables is the
 * plugin id; clients render labels from that id.
 */
type CheckinKind = string;

export interface TimestampReconciliationSuggestion {
  id: string;
  type: CheckinKind;
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  suggested_timezone: string;
  reason: string;
}

export interface TimestampReconciliationUninferableCheckin {
  id: string;
  type: CheckinKind;
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  reason: string;
}

export interface TimestampReconciliationScanResult {
  suggestions: TimestampReconciliationSuggestion[];
  /** Uninferable check-ins grouped by type id. */
  uninferable: Record<string, TimestampReconciliationUninferableCheckin[]>;
}

export interface TimestampReconciliationUpdate {
  id: string;
  type: CheckinKind;
  suggested_timezone: string;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirror of the client-side ETC_GMT_DISPLAY_MAP (client/src/utils/checkin.ts).
 * Etc/GMT±N zones (with the inverted POSIX sign) are fixed-offset zones written
 * by imports that only captured a UTC offset. Map them to the representative
 * DST-aware IANA zone so reconciliation suggestions match what the app displays.
 * For imports that recorded the actual local offset at each entry (e.g. Daylio),
 * this mapping is instant-preserving.
 */
const ETC_GMT_IANA_MAP: Record<string, string> = {
  'Etc/GMT+1': 'Atlantic/Azores',       // UTC-1
  'Etc/GMT+2': 'Atlantic/South_Georgia', // UTC-2
  'Etc/GMT+3': 'America/Godthab',       // UTC-3
  'Etc/GMT+4': 'America/New_York',      // UTC-4 (EDT)
  'Etc/GMT+5': 'America/New_York',      // UTC-5 (EST)
  'Etc/GMT+6': 'America/Chicago',       // UTC-6 (CST)
  'Etc/GMT+7': 'America/Denver',        // UTC-7 (MST/PDT)
  'Etc/GMT+8': 'America/Los_Angeles',   // UTC-8 (PST)
  'Etc/GMT+9': 'America/Anchorage',     // UTC-9 (AKST)
  'Etc/GMT+10': 'Pacific/Honolulu',     // UTC-10 (HST)
  'Etc/GMT+11': 'Pacific/Pago_Pago',    // UTC-11
  'Etc/GMT+12': 'Etc/GMT+12',           // UTC-12 (no better representative)
  'Etc/GMT-1': 'Europe/Paris',          // UTC+1 (CET)
  'Etc/GMT-2': 'Europe/Paris',          // UTC+2 (CEST)
  'Etc/GMT-3': 'Europe/Moscow',         // UTC+3 (MSK)
  'Etc/GMT-4': 'Asia/Dubai',            // UTC+4 (GST)
  'Etc/GMT-5': 'Asia/Karachi',          // UTC+5 (PKT)
  'Etc/GMT-6': 'Asia/Bangkok',          // UTC+6 (ICT)
  'Etc/GMT-7': 'Asia/Jakarta',          // UTC+7 (WIB)
  'Etc/GMT-8': 'Asia/Shanghai',         // UTC+8 (CST)
  'Etc/GMT-9': 'Asia/Tokyo',            // UTC+9 (JST)
  'Etc/GMT-10': 'Australia/Sydney',     // UTC+10 (AEDT)
  'Etc/GMT-11': 'Pacific/Noumea',       // UTC+11
  'Etc/GMT-12': 'Pacific/Fiji',         // UTC+12 (FJT)
};

function normalizeTimezone(timeZone: string): string {
  return ETC_GMT_IANA_MAP[timeZone] || timeZone;
}

function formatDiffFromMs(diffMs: number): string {
  const totalMinutes = Math.round(diffMs / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function findClosestAnchor<T extends { checkedInAtMs: number }>(
  timestampMs: number,
  anchors: T[]
): { anchor: T; diffMs: number } | null {
  if (anchors.length === 0) {
    return null;
  }

  let low = 0;
  let high = anchors.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (anchors[mid].checkedInAtMs < timestampMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const candidates = [anchors[low - 1], anchors[low], anchors[low + 1]].filter(Boolean) as T[];
  let best: T | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const diff = Math.abs(candidate.checkedInAtMs - timestampMs);
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }

  return best ? { anchor: best, diffMs: bestDiff } : null;
}

function compareSuggestions(a: TimestampReconciliationSuggestion, b: TimestampReconciliationSuggestion): number {
  return new Date(b.original_timestamp).getTime() - new Date(a.original_timestamp).getTime();
}

interface AnyTimezoneAnchor {
  id: string;
  kind: string;
  label: string;
  checkedInAtMs: number;
  timezone: string;
}

interface ResolvedTimezoneAnchor {
  anchor: AnyTimezoneAnchor;
  diffMs: number;
  /** 0 when the closest anchor is outside the extended fallback window. */
  windowMs: number;
}

interface FallbackAnchorRow {
  id: string;
  checked_in_at: string;
  timezone: string | null;
  label: string | null;
}

function toFallbackAnchors(rows: FallbackAnchorRow[], kind: string, label: string): AnyTimezoneAnchor[] {
  const anchors: AnyTimezoneAnchor[] = [];
  for (const row of rows) {
    if (!row.timezone || row.timezone === 'UTC' || !isValidTimeZone(row.timezone)) {
      continue;
    }
    anchors.push({
      id: row.id,
      kind,
      label: row.label || label,
      checkedInAtMs: new Date(row.checked_in_at).getTime(),
      timezone: normalizeTimezone(row.timezone),
    });
  }
  return anchors.sort((a, b) => a.checkedInAtMs - b.checkedInAtMs);
}

function resolveTimezoneAnchor(
  timestampMs: number,
  selfId: string,
  anchors: AnyTimezoneAnchor[]
): ResolvedTimezoneAnchor | null {
  const candidates = anchors.filter((anchor) => anchor.id !== selfId);
  if (candidates.length === 0) {
    return null;
  }

  const nearest = findClosestAnchor(timestampMs, candidates);
  if (!nearest) {
    return null;
  }

  if (nearest.diffMs <= NEARBY_WINDOW_MS) {
    return { anchor: nearest.anchor, diffMs: nearest.diffMs, windowMs: NEARBY_WINDOW_MS };
  }

  if (nearest.diffMs <= FALLBACK_WINDOW_MS) {
    return { anchor: nearest.anchor, diffMs: nearest.diffMs, windowMs: FALLBACK_WINDOW_MS };
  }

  return { anchor: nearest.anchor, diffMs: nearest.diffMs, windowMs: 0 };
}

function buildAnchorReason(resolved: ResolvedTimezoneAnchor): string {
  const { anchor, diffMs, windowMs } = resolved;
  const diffLabel = formatDiffFromMs(diffMs);
  const windowNote = windowMs === FALLBACK_WINDOW_MS ? ' (within the extended 72-hour window)' : '';

  return `Nearest ${anchor.label} is ${diffLabel} away${windowNote}, which is stored as ${anchor.timezone}.`;
}

/**
 * Anchor-based suggestion builder for plugin reconcile hooks that do not
 * provide their own `suggest` hook.
 */
function buildAnchorSuggestion(input: {
  type: CheckinKind;
  row: { id: string; checked_in_at: string; original_timezone: string | null };
  detailPath: (id: string) => string;
  anchors: AnyTimezoneAnchor[];
  /** Scan-style: only scan rows stored without a timezone / UTC. */
  needsReconciliation: boolean;
}): { suggestion: TimestampReconciliationSuggestion | null; uninferable: TimestampReconciliationUninferableCheckin | null } {
  const { type, row, detailPath, anchors, needsReconciliation } = input;
  if (!needsReconciliation) {
    return { suggestion: null, uninferable: null };
  }

  const uninferable = (reason: string): TimestampReconciliationUninferableCheckin => ({
    id: row.id,
    type,
    detail_path: detailPath(row.id),
    original_timestamp: row.checked_in_at,
    original_timezone: row.original_timezone,
    reason,
  });

  const resolved = resolveTimezoneAnchor(new Date(row.checked_in_at).getTime(), row.id, anchors);

  if (!resolved) {
    return { suggestion: null, uninferable: uninferable('No check-ins with a trustworthy timezone were found.') };
  }

  if (resolved.windowMs === 0) {
    return {
      suggestion: null,
      uninferable: uninferable(
        `Nearest check-in with a trustworthy timezone is ${formatDiffFromMs(resolved.diffMs)} away, which exceeds the 72-hour inference window.`
      ),
    };
  }

  if (resolved.anchor.timezone === normalizeTimezone(row.original_timezone || '')) {
    return { suggestion: null, uninferable: null };
  }

  const prefix = row.original_timezone
    ? 'Stored timezone is UTC. '
    : 'Stored without timezone. ';

  return {
    suggestion: {
      id: row.id,
      type,
      detail_path: detailPath(row.id),
      original_timestamp: row.checked_in_at,
      original_timezone: row.original_timezone,
      suggested_timezone: resolved.anchor.timezone,
      reason: prefix + buildAnchorReason(resolved),
    },
    uninferable: null,
  };
}

function needsTimezoneReconciliation(originalTimezone: string | null): boolean {
  return !originalTimezone || originalTimezone === 'UTC';
}

export async function getTimestampReconciliationSuggestions(userId = USER_ID): Promise<TimestampReconciliationScanResult> {
  interface PluginHookEntry {
    plugin: CheckinTypeServer;
    hook: PluginReconciliationHook;
  }

  const pluginHooks: PluginHookEntry[] = allPlugins()
    .map((plugin): PluginHookEntry | null =>
      plugin.server.reconcile ? { plugin, hook: plugin.server.reconcile } : null
    )
    .filter((entry): entry is PluginHookEntry => entry !== null);

  const pluginRowsList = await Promise.all(
    pluginHooks.map(({ plugin, hook }) => hook.loadCheckins(userId).catch((err: unknown) => {
      console.error(`Plugin "${plugin.id}" reconcile.loadCheckins failed:`, err);
      return [] as PluginReconciliationRow[];
    })),
  );

  const anchors: AnyTimezoneAnchor[] = [
    ...pluginRowsList.flatMap((rows, i) =>
      toFallbackAnchors(
        rows.map((row) => {
          const hook = pluginHooks[i].hook;
          const anchorTz = hook.anchorTimezone
            ? (hook.anchorTimezone(row) ?? row.original_timezone)
            : row.original_timezone;
          return { id: row.id, checked_in_at: row.checked_in_at, timezone: anchorTz, label: null };
        }),
        pluginHooks[i].plugin.id,
        pluginHooks[i].hook.anchorLabel ?? `a ${pluginHooks[i].plugin.id} check-in`,
      )
    ),
  ].sort((a, b) => a.checkedInAtMs - b.checkedInAtMs);

  const suggestions: TimestampReconciliationSuggestion[] = [];
  const uninferable: Record<string, TimestampReconciliationUninferableCheckin[]> = {};

  const addUninferable = (type: CheckinKind, item: TimestampReconciliationUninferableCheckin) => {
    (uninferable[type] ??= []).push(item);
  };

  // Plugin check-ins (via reconcile hooks).
  for (let i = 0; i < pluginHooks.length; i++) {
    const { plugin, hook } = pluginHooks[i];
    const rows = pluginRowsList[i];

    // Plugins that provide their own `suggest` hook bypass the anchor-based
    // pass (e.g. the location plugin resolves venue coordinates to a
    // timezone, which anchors cannot express).
    if (hook.suggest) {
      const scan = hook.scanAll !== false;
      const scannable = scan ? rows : rows.filter((row) => needsTimezoneReconciliation(row.original_timezone));
      const byId = new Map(rows.map((row) => [row.id, row]));
      try {
        const result = await hook.suggest(userId, scannable);
        for (const s of result.suggestions) {
          const row = byId.get(s.id);
          if (!row) continue;
          suggestions.push({
            id: s.id,
            type: plugin.id,
            detail_path: hook.detailPath(s.id),
            original_timestamp: row.checked_in_at,
            original_timezone: row.original_timezone,
            suggested_timezone: s.suggested_timezone,
            reason: s.reason,
          });
        }
        for (const u of result.uninferable) {
          const row = byId.get(u.id);
          if (!row) continue;
          addUninferable(plugin.id, {
            id: u.id,
            type: plugin.id,
            detail_path: hook.detailPath(u.id),
            original_timestamp: row.checked_in_at,
            original_timezone: row.original_timezone,
            reason: u.reason,
          });
        }
      } catch (err) {
        console.error(`Plugin "${plugin.id}" reconcile.suggest failed:`, err);
      }
      continue;
    }

    for (const row of rows) {
      const scan = hook.scanAll !== false;
      const { suggestion, uninferable: un } = buildAnchorSuggestion({
        type: plugin.id,
        row,
        detailPath: hook.detailPath,
        anchors,
        needsReconciliation: scan || needsTimezoneReconciliation(row.original_timezone),
      });
      if (suggestion) suggestions.push(suggestion);
      if (un) addUninferable(plugin.id, un);
    }
  }

  for (const items of Object.values(uninferable)) {
    items.sort((left, right) => new Date(right.original_timestamp).getTime() - new Date(left.original_timestamp).getTime());
  }

  return {
    suggestions: suggestions.sort(compareSuggestions),
    uninferable,
  };
}

/**
 * Reconciliation is label-only: the stored instant is the true moment the
 * event happened, so applying a suggestion only replaces the stored timezone
 * label. This validates the target timezone and that the row exists.
 */
export async function computeAppliedReconciliation(update: TimestampReconciliationUpdate): Promise<{ timeZone: string } | null> {
  if (!isValidTimeZone(update.suggested_timezone)) {
    return null;
  }

  // The plugin's hook validates row existence and applies.
  const plugin = allPlugins().find((p) => p.id === update.type);
  if (plugin?.server.reconcile?.apply) {
    const applied = await plugin.server.reconcile.apply(update.id, update.suggested_timezone);
    return applied ? { timeZone: update.suggested_timezone } : null;
  }

  return null;
}

/**
 * Apply a single reconciliation update. The plugin's reconcile hook
 * validates row existence and persists the label, so this returns true
 * after the hook succeeds.
 */
export async function applyReconciliationUpdate(client: { query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }> }, update: TimestampReconciliationUpdate): Promise<boolean> {
  const applied = await computeAppliedReconciliation(update);
  if (!applied) return false;

  // Plugin types already persisted their label inside reconcile.apply.
  return true;
}
