import { find as findTimezone } from 'geo-tz';
import { query } from '../db';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MOOD_NEARBY_WINDOW_MS = 24 * 60 * 60 * 1000;

type CheckinKind = 'venue' | 'mood';

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

interface VenueAnchor {
  id: string;
  venue_name: string;
  checkedInAt: string;
  checkedInAtMs: number;
  timezone: string;
}

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

export interface TimestampReconciliationScanResult {
  suggestions: TimestampReconciliationSuggestion[];
  uninferable_mood_checkins: TimestampReconciliationUninferableMoodCheckin[];
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

function getVenueTimezone(latitude: number | string | null, longitude: number | string | null): string | null {
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

function findClosestVenueAnchor(timestampMs: number, anchors: VenueAnchor[]): { anchor: VenueAnchor; diffMs: number } | null {
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

  const candidates = [anchors[low - 1], anchors[low], anchors[low + 1]].filter(Boolean) as VenueAnchor[];
  let best: VenueAnchor | null = null;
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
  if (!suggestedTimezone || suggestedTimezone === row.original_timezone) {
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

function toVenueAnchor(row: VenueCheckinRow): VenueAnchor | null {
  const timezone = getVenueTimezone(row.latitude, row.longitude);
  if (!timezone) {
    return null;
  }

  return {
    id: row.id,
    venue_name: row.venue_name,
    checkedInAt: row.checked_in_at,
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

function buildMoodSuggestion(
  row: MoodCheckinRow,
  anchors: VenueAnchor[]
): {
  suggestion: TimestampReconciliationSuggestion | null;
  uninferable: TimestampReconciliationUninferableMoodCheckin | null;
} {
  const originalTimestampMs = new Date(row.checked_in_at).getTime();
  const closest = findClosestVenueAnchor(originalTimestampMs, anchors);

  if (!closest) {
    return {
      suggestion: null,
      uninferable: buildUninferableMoodCheckin(
        row,
        'No venue check-ins with inferrable timezone were found.'
      ),
    };
  }

  if (closest.diffMs > MOOD_NEARBY_WINDOW_MS) {
    return {
      suggestion: null,
      uninferable: buildUninferableMoodCheckin(
        row,
        `Nearest venue check-in is ${formatDiffFromMs(closest.diffMs)} away, which exceeds the 24-hour inference window.`
      ),
    };
  }

  const nearestAnchor = closest.anchor;

  if (nearestAnchor.timezone === row.original_timezone) {
    return {
      suggestion: null,
      uninferable: null,
    };
  }

  const diffLabel = formatDiffFromMs(closest.diffMs);

  return {
    suggestion: {
      id: row.id,
      type: 'mood',
      detail_path: `/mood-checkins/${row.id}`,
      original_timestamp: row.checked_in_at,
      original_timezone: row.original_timezone,
      suggested_timezone: nearestAnchor.timezone,
      reconciled_timestamp: buildReconciledTimestamp(row.checked_in_at, row.original_timezone, nearestAnchor.timezone),
      reason: row.original_timezone
        ? `Nearest venue check-in is ${diffLabel} away at ${nearestAnchor.venue_name}, which resolves to ${nearestAnchor.timezone}.`
        : `Nearest venue check-in is ${diffLabel} away at ${nearestAnchor.venue_name}, which resolves to ${nearestAnchor.timezone}.`,
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

export async function getTimestampReconciliationSuggestions(userId = USER_ID): Promise<TimestampReconciliationScanResult> {
  const [venueRows, moodRows] = await Promise.all([
    loadVenueCheckins(userId),
    loadMoodCheckins(userId),
  ]);

  const venueSuggestions = venueRows
    .map((row) => buildVenueSuggestion(row))
    .filter((row): row is TimestampReconciliationSuggestion => row !== null);

  const venueAnchors = venueRows
    .map((row) => toVenueAnchor(row))
    .filter((row): row is VenueAnchor => row !== null)
    .sort((a, b) => a.checkedInAtMs - b.checkedInAtMs);

  const moodAnalysis = moodRows.map((row) => buildMoodSuggestion(row, venueAnchors));

  const moodSuggestions = moodAnalysis
    .map((item) => item.suggestion)
    .filter((row): row is TimestampReconciliationSuggestion => row !== null);

  const uninferableMoodCheckins = moodAnalysis
    .map((item) => item.uninferable)
    .filter((row): row is TimestampReconciliationUninferableMoodCheckin => row !== null)
    .sort((left, right) => new Date(right.original_timestamp).getTime() - new Date(left.original_timestamp).getTime());

  return {
    suggestions: [...venueSuggestions, ...moodSuggestions].sort(compareSuggestions),
    uninferable_mood_checkins: uninferableMoodCheckins,
  };
}

export async function computeAppliedReconciliation(update: TimestampReconciliationUpdate): Promise<{ checkedInAt: string; timeZone: string } | null> {
  if (!isValidTimeZone(update.suggested_timezone)) {
    return null;
  }

  if (update.type === 'venue') {
    const result = await query(
      `SELECT checked_in_at, checkin_timezone AS original_timezone
       FROM checkins
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

  const result = await query(
    `SELECT checked_in_at, mood_timezone AS original_timezone
     FROM mood_checkins
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