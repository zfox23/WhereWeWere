import { find as findTimezone } from 'geo-tz';
import { query } from '../db';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const NEARBY_WINDOW_MS = 24 * 60 * 60 * 1000;
const FALLBACK_WINDOW_MS = 72 * 60 * 60 * 1000;

type CheckinKind = 'venue' | 'mood' | 'media';

interface VenueCheckinRow {
  id: string;
  checked_in_at: string;
  original_timezone: string | null;
  venue_name: string;
  latitude: number | string | null;
  longitude: number | string | null;
}

interface MoodCheckinRow {
  id: string;
  checked_in_at: string;
  original_timezone: string | null;
}

interface MediaCheckinRow {
  id: string;
  checked_in_at: string;
  original_timezone: string | null;
  media_type: string;
  media_item_id: string;
  media_title: string;
}

type FallbackKind = 'mood' | 'media' | 'track' | 'sleep';

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export interface TimestampReconciliationSuggestion {
  id: string;
  type: CheckinKind;
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  suggested_timezone: string;
  reconciled_timestamp: string;
  reason: string;
}

export interface TimestampReconciliationUninferableMoodCheckin {
  id: string;
  type: 'mood';
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  reason: string;
}

export interface TimestampReconciliationUninferableMediaCheckin {
  id: string;
  type: 'media';
  detail_path: string;
  original_timestamp: string;
  original_timezone: string | null;
  reason: string;
}

export interface TimestampReconciliationScanResult {
  suggestions: TimestampReconciliationSuggestion[];
  uninferable_mood_checkins: TimestampReconciliationUninferableMoodCheckin[];
  uninferable_media_checkins: TimestampReconciliationUninferableMediaCheckin[];
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

/** Mirror of the client-side slugify (client/src/utils/slugify.ts). */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const MEDIA_ROUTE_SEGMENTS: Record<string, string> = {
  movie: 'movie',
  tv_show: 'tv',
  game: 'game',
  book: 'book',
  board_game: 'board-game',
};

function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    return value ? parseInt(value, 10) : 0;
  };

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
    millisecond: date.getUTCMilliseconds(),
  };
}

function getUtcDateParts(date: Date): LocalDateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

function toComparableUtc(parts: LocalDateParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
}

function wallTimeToUtcIso(parts: LocalDateParts, timeZone: string): string {
  let guess = toComparableUtc(parts);
  const desiredComparable = toComparableUtc(parts);

  for (let index = 0; index < 6; index += 1) {
    const actual = getLocalDateParts(new Date(guess), timeZone);
    const actualComparable = toComparableUtc(actual);
    const diff = desiredComparable - actualComparable;

    if (diff === 0) {
      return new Date(guess).toISOString();
    }

    guess += diff;
  }

  return new Date(guess).toISOString();
}

function buildReconciledTimestamp(originalTimestamp: string, originalTimezone: string | null, suggestedTimezone: string): string {
  const originalDate = new Date(originalTimestamp);
  const localParts = originalTimezone
    ? getLocalDateParts(originalDate, originalTimezone)
    : getUtcDateParts(originalDate);

  return wallTimeToUtcIso(localParts, suggestedTimezone);
}

export function getVenueTimezone(latitude: number | string | null, longitude: number | string | null): string | null {
  if (latitude == null || longitude == null) {
    return null;
  }

  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);

  if (!Number.isFinite(numericLatitude) || !Number.isFinite(numericLongitude)) {
    return null;
  }

  const result = findTimezone(numericLatitude, numericLongitude);
  const timeZone = result[0] || null;
  return timeZone && isValidTimeZone(timeZone) ? timeZone : null;
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

function buildVenueSuggestion(row: VenueCheckinRow): TimestampReconciliationSuggestion | null {
  const suggestedTimezone = getVenueTimezone(row.latitude, row.longitude);
  if (!suggestedTimezone || suggestedTimezone === normalizeTimezone(row.original_timezone || '')) {
    return null;
  }

  return {
    id: row.id,
    type: 'venue',
    detail_path: `/checkins/${row.id}`,
    original_timestamp: row.checked_in_at,
    original_timezone: row.original_timezone,
    suggested_timezone: suggestedTimezone,
    reconciled_timestamp: buildReconciledTimestamp(row.checked_in_at, row.original_timezone, suggestedTimezone),
    reason: row.original_timezone
      ? `Venue location for ${row.venue_name} resolves to ${suggestedTimezone}, not ${row.original_timezone}.`
      : `Venue location for ${row.venue_name} resolves to ${suggestedTimezone}.`,
  };
}

function toVenueAnchor(row: VenueCheckinRow): AnyTimezoneAnchor | null {
  const timezone = getVenueTimezone(row.latitude, row.longitude);
  if (!timezone) {
    return null;
  }

  return {
    id: row.id,
    kind: 'venue',
    label: row.venue_name,
    checkedInAtMs: new Date(row.checked_in_at).getTime(),
    timezone,
  };
}

function buildUninferableMoodCheckin(
  row: MoodCheckinRow,
  reason: string
): TimestampReconciliationUninferableMoodCheckin {
  return {
    id: row.id,
    type: 'mood',
    detail_path: `/mood-checkins/${row.id}`,
    original_timestamp: row.checked_in_at,
    original_timezone: row.original_timezone,
    reason,
  };
}

interface AnyTimezoneAnchor {
  id: string;
  kind: 'venue' | FallbackKind;
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

function toFallbackAnchors(rows: FallbackAnchorRow[], kind: FallbackKind): AnyTimezoneAnchor[] {
  const anchors: AnyTimezoneAnchor[] = [];
  for (const row of rows) {
    if (!row.timezone || row.timezone === 'UTC' || !isValidTimeZone(row.timezone)) {
      continue;
    }
    anchors.push({
      id: row.id,
      kind,
      label: row.label || 'a check-in',
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

  const venueCandidates = candidates.filter((anchor) => anchor.kind === 'venue');
  const otherCandidates = candidates.filter((anchor) => anchor.kind !== 'venue');

  const nearestVenue = findClosestAnchor(timestampMs, venueCandidates);
  if (nearestVenue && nearestVenue.diffMs <= NEARBY_WINDOW_MS) {
    return { anchor: nearestVenue.anchor, diffMs: nearestVenue.diffMs, windowMs: NEARBY_WINDOW_MS };
  }

  const nearestOther = findClosestAnchor(timestampMs, otherCandidates);
  if (nearestOther && nearestOther.diffMs <= NEARBY_WINDOW_MS) {
    return { anchor: nearestOther.anchor, diffMs: nearestOther.diffMs, windowMs: NEARBY_WINDOW_MS };
  }

  const nearestAny = findClosestAnchor(timestampMs, candidates);
  if (!nearestAny) {
    return null;
  }

  if (nearestAny.diffMs <= FALLBACK_WINDOW_MS) {
    return { anchor: nearestAny.anchor, diffMs: nearestAny.diffMs, windowMs: FALLBACK_WINDOW_MS };
  }

  return { anchor: nearestAny.anchor, diffMs: nearestAny.diffMs, windowMs: 0 };
}

const FALLBACK_KIND_LABELS: Record<FallbackKind, string> = {
  mood: 'mood check-in',
  media: 'media check-in',
  track: 'track',
  sleep: 'sleep entry',
};

function buildAnchorReason(resolved: ResolvedTimezoneAnchor): string {
  const { anchor, diffMs, windowMs } = resolved;
  const diffLabel = formatDiffFromMs(diffMs);
  const windowNote = windowMs === FALLBACK_WINDOW_MS ? ' (within the extended 72-hour window)' : '';

  if (anchor.kind === 'venue') {
    return `Nearest venue check-in is ${diffLabel} away at ${anchor.label}${windowNote}, which resolves to ${anchor.timezone}.`;
  }

  const labelNote = anchor.kind === 'mood' || anchor.kind === 'sleep' ? '' : ` (${anchor.label})`;
  return `No venue check-in within 24 hours; nearest ${FALLBACK_KIND_LABELS[anchor.kind]} is ${diffLabel} away${labelNote}${windowNote}, which is stored as ${anchor.timezone}.`;
}

function buildMoodSuggestion(
  row: MoodCheckinRow,
  anchors: AnyTimezoneAnchor[]
): {
  suggestion: TimestampReconciliationSuggestion | null;
  uninferable: TimestampReconciliationUninferableMoodCheckin | null;
} {
  const resolved = resolveTimezoneAnchor(new Date(row.checked_in_at).getTime(), row.id, anchors);

  if (!resolved) {
    return {
      suggestion: null,
      uninferable: buildUninferableMoodCheckin(
        row,
        'No check-ins with a trustworthy timezone were found.'
      ),
    };
  }

  if (resolved.windowMs === 0) {
    return {
      suggestion: null,
      uninferable: buildUninferableMoodCheckin(
        row,
        `Nearest check-in with a trustworthy timezone is ${formatDiffFromMs(resolved.diffMs)} away, which exceeds the 72-hour inference window.`
      ),
    };
  }

  if (resolved.anchor.timezone === normalizeTimezone(row.original_timezone || '')) {
    return {
      suggestion: null,
      uninferable: null,
    };
  }

  return {
    suggestion: {
      id: row.id,
      type: 'mood',
      detail_path: `/mood-checkins/${row.id}`,
      original_timestamp: row.checked_in_at,
      original_timezone: row.original_timezone,
      suggested_timezone: resolved.anchor.timezone,
      reconciled_timestamp: buildReconciledTimestamp(row.checked_in_at, row.original_timezone, resolved.anchor.timezone),
      reason: buildAnchorReason(resolved),
    },
    uninferable: null,
  };
}

function buildUninferableMediaCheckin(
  row: MediaCheckinRow,
  reason: string
): TimestampReconciliationUninferableMediaCheckin {
  return {
    id: row.id,
    type: 'media',
    detail_path: buildMediaDetailPath(row),
    original_timestamp: row.checked_in_at,
    original_timezone: row.original_timezone,
    reason,
  };
}

function buildMediaDetailPath(row: Pick<MediaCheckinRow, 'media_type' | 'media_item_id' | 'media_title'>): string {
  const segment = MEDIA_ROUTE_SEGMENTS[row.media_type] || 'movie';
  const slug = row.media_title ? slugify(row.media_title) : '';
  return `/media/${segment}/${row.media_item_id}/${slug}`;
}

function needsTimezoneReconciliation(originalTimezone: string | null): boolean {
  return !originalTimezone || originalTimezone === 'UTC';
}

function buildMediaSuggestion(
  row: MediaCheckinRow,
  anchors: AnyTimezoneAnchor[]
): {
  suggestion: TimestampReconciliationSuggestion | null;
  uninferable: TimestampReconciliationUninferableMediaCheckin | null;
} {
  if (!needsTimezoneReconciliation(row.original_timezone)) {
    return { suggestion: null, uninferable: null };
  }

  const resolved = resolveTimezoneAnchor(new Date(row.checked_in_at).getTime(), row.id, anchors);

  if (!resolved) {
    return {
      suggestion: null,
      uninferable: buildUninferableMediaCheckin(
        row,
        'No check-ins with a trustworthy timezone were found.'
      ),
    };
  }

  if (resolved.windowMs === 0) {
    return {
      suggestion: null,
      uninferable: buildUninferableMediaCheckin(
        row,
        `Nearest check-in with a trustworthy timezone is ${formatDiffFromMs(resolved.diffMs)} away, which exceeds the 72-hour inference window.`
      ),
    };
  }

  const prefix = row.original_timezone
    ? 'Stored timezone is UTC. '
    : 'Stored without timezone. ';

  return {
    suggestion: {
      id: row.id,
      type: 'media',
      detail_path: buildMediaDetailPath(row),
      original_timestamp: row.checked_in_at,
      original_timezone: row.original_timezone,
      suggested_timezone: resolved.anchor.timezone,
      reconciled_timestamp: buildReconciledTimestamp(row.checked_in_at, row.original_timezone, resolved.anchor.timezone),
      reason: prefix + buildAnchorReason(resolved),
    },
    uninferable: null,
  };
}

async function loadVenueCheckins(userId: string): Promise<VenueCheckinRow[]> {
  const result = await query(
    `SELECT c.id,
            c.checked_in_at,
            c.checkin_timezone AS original_timezone,
            v.name AS venue_name,
            v.latitude,
            v.longitude
     FROM checkins c
     JOIN venues v ON v.id = c.venue_id
     WHERE c.user_id = $1
     ORDER BY c.checked_in_at ASC`,
    [userId]
  );

  return result.rows as VenueCheckinRow[];
}

async function loadMoodCheckins(userId: string): Promise<MoodCheckinRow[]> {
  const result = await query(
    `SELECT mc.id,
            mc.checked_in_at,
            mc.mood_timezone AS original_timezone
     FROM mood_checkins mc
     WHERE mc.user_id = $1
     ORDER BY mc.checked_in_at ASC`,
    [userId]
  );

  return result.rows as MoodCheckinRow[];
}

async function loadMediaCheckins(userId: string): Promise<MediaCheckinRow[]> {
  const result = await query(
    `SELECT mc.id,
            mc.checked_in_at,
            mc.checkin_timezone AS original_timezone,
            mi.media_type,
            mi.id AS media_item_id,
            mi.title AS media_title
     FROM media_checkins mc
     JOIN media_items mi ON mi.id = mc.media_item_id
     WHERE mc.user_id = $1
     ORDER BY mc.checked_in_at ASC`,
    [userId]
  );

  return result.rows as MediaCheckinRow[];
}

async function loadTrackAnchorRows(userId: string): Promise<FallbackAnchorRow[]> {
  const result = await query(
    `SELECT id,
            started_at AS checked_in_at,
            timezone,
            name AS label
     FROM tracks
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows as FallbackAnchorRow[];
}

async function loadSleepAnchorRows(userId: string): Promise<FallbackAnchorRow[]> {
  const result = await query(
    `SELECT id,
            started_at AS checked_in_at,
            sleep_timezone AS timezone,
            NULL::text AS label
     FROM sleep_entries
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows as FallbackAnchorRow[];
}

export async function getTimestampReconciliationSuggestions(userId = USER_ID): Promise<TimestampReconciliationScanResult> {
  const [venueRows, moodRows, mediaRows, trackRows, sleepRows] = await Promise.all([
    loadVenueCheckins(userId),
    loadMoodCheckins(userId),
    loadMediaCheckins(userId),
    loadTrackAnchorRows(userId),
    loadSleepAnchorRows(userId),
  ]);

  const venueSuggestions = venueRows
    .map((row) => buildVenueSuggestion(row))
    .filter((row): row is TimestampReconciliationSuggestion => row !== null);

  const moodFallbackRows: FallbackAnchorRow[] = moodRows.map((row) => ({
    id: row.id,
    checked_in_at: row.checked_in_at,
    timezone: row.original_timezone,
    label: null,
  }));

  const mediaFallbackRows: FallbackAnchorRow[] = mediaRows.map((row) => ({
    id: row.id,
    checked_in_at: row.checked_in_at,
    timezone: row.original_timezone,
    label: row.media_title,
  }));

  const anchors: AnyTimezoneAnchor[] = [
    ...venueRows
      .map((row) => toVenueAnchor(row))
      .filter((row): row is AnyTimezoneAnchor => row !== null),
    ...toFallbackAnchors(moodFallbackRows, 'mood'),
    ...toFallbackAnchors(mediaFallbackRows, 'media'),
    ...toFallbackAnchors(trackRows, 'track'),
    ...toFallbackAnchors(sleepRows, 'sleep'),
  ].sort((a, b) => a.checkedInAtMs - b.checkedInAtMs);

  const moodAnalysis = moodRows.map((row) => buildMoodSuggestion(row, anchors));
  const mediaAnalysis = mediaRows.map((row) => buildMediaSuggestion(row, anchors));

  const moodSuggestions = moodAnalysis
    .map((item) => item.suggestion)
    .filter((row): row is TimestampReconciliationSuggestion => row !== null);

  const mediaSuggestions = mediaAnalysis
    .map((item) => item.suggestion)
    .filter((row): row is TimestampReconciliationSuggestion => row !== null);

  const uninferableMoodCheckins = moodAnalysis
    .map((item) => item.uninferable)
    .filter((row): row is TimestampReconciliationUninferableMoodCheckin => row !== null)
    .sort((left, right) => new Date(right.original_timestamp).getTime() - new Date(left.original_timestamp).getTime());

  const uninferableMediaCheckins = mediaAnalysis
    .map((item) => item.uninferable)
    .filter((row): row is TimestampReconciliationUninferableMediaCheckin => row !== null)
    .sort((left, right) => new Date(right.original_timestamp).getTime() - new Date(left.original_timestamp).getTime());

  return {
    suggestions: [...venueSuggestions, ...moodSuggestions, ...mediaSuggestions].sort(compareSuggestions),
    uninferable_mood_checkins: uninferableMoodCheckins,
    uninferable_media_checkins: uninferableMediaCheckins,
  };
}

export async function computeAppliedReconciliation(update: TimestampReconciliationUpdate): Promise<{ checkedInAt: string; timeZone: string } | null> {
  if (!isValidTimeZone(update.suggested_timezone)) {
    return null;
  }

  const table =
    update.type === 'venue' ? 'checkins' : update.type === 'mood' ? 'mood_checkins' : 'media_checkins';
  const timezoneColumn = update.type === 'mood' ? 'mood_timezone' : 'checkin_timezone';

  const result = await query(
    `SELECT checked_in_at, ${timezoneColumn} AS original_timezone
     FROM ${table}
     WHERE id = $1`,
    [update.id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0] as { checked_in_at: string; original_timezone: string | null };
  return {
    checkedInAt: buildReconciledTimestamp(row.checked_in_at, row.original_timezone, update.suggested_timezone),
    timeZone: update.suggested_timezone,
  };
}