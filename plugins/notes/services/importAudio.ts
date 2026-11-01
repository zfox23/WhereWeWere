/**
 * Notes plugin — planning an audio-file import (pure; the routes feed it).
 *
 * Each audio file becomes one note (empty body, the file attached). Dates
 * come from the filename, using the same rules as the text import plus a
 * form that carries the time:
 *
 *   `2023-04-05 14.30.59 Walk in the park.m4a`  -> Apr 5 2023 14:30:59 local,
 *                                                  titled "Walk in the park"
 *   `2023-04-05 14.30.59.m4a`                   -> same, untitled
 *   `2023-04-05 Walk in the park.m4a`           -> the file's modified time when
 *                                                  that is the same local date, else 8pm
 *   `Walk in the park.m4a`                      -> the file's modified time
 *
 * The local zone is where the user's other check-ins put them at the time
 * (timezone anchors), else the fallback zone chosen on the import form. A time
 * in the filename is a local wall-clock time in that zone.
 */

import { localDateInZone, wallTimeToUtcMs } from 'wwp-shared';
import { timezoneAt, type TimezoneAnchor } from '../../../server/src/services/timezoneAnchors';
import { audioMimeForName } from '../audioTypes';
import { MAX_AUDIO_BYTES } from './audioFiles';
import { DEFAULT_HOUR, baseName, cleanTitle, parseDatePrefix } from './importNotes';

export type AudioTimeSource = 'filename' | 'file_modified' | 'default_evening' | 'missing';
export type AudioTimezoneSource = 'history' | 'fallback';
export type AudioDuplicateKind = 'checksum' | 'batch';

/** One staged file, as the browser describes it (no audio bytes). */
export interface AudioFileMeta {
  name: string;
  size: number;
  lastModified: number | null;
  /** SHA-256 hex of the file, computed in the browser; used to spot files already imported. */
  sha256: string | null;
}

export interface PlannedAudio {
  index: number;
  filename: string;
  mime: string | null;
  bytes: number;
  title: string | null;
  checked_in_at: string;
  timezone: string;
  local_date: string;
  time_source: AudioTimeSource;
  tz_source: AudioTimezoneSource;
  sha256: string | null;
  duplicate: AudioDuplicateKind | null;
  /** Ticked in the preview unless a duplicate, undated, or unusable. */
  selected_default: boolean;
  error: string | null;
}

/** `YYYY-MM-DD HH.mm.SS` followed by an optional title (separator: space or underscore between date and time). */
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ _](\d{2})\.(\d{2})\.(\d{2})(?!\d)(.*)$/;

export interface FilenameStamp {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
  date: string;
  rest: string;
}

/** The date + time at the start of a name, when it is a real calendar date and clock time; else null. */
export function parseStamp(base: string): FilenameStamp | null {
  const match = STAMP_RE.exec(base);
  if (!match) return null;
  const [y, m, d, hh, mm, ss] = match.slice(1, 7).map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { y, m, d, hh, mm, ss, date: `${match[1]}-${match[2]}-${match[3]}`, rest: match[7] };
}

function hasAnchorAtOrBefore(anchors: TimezoneAnchor[], ms: number): boolean {
  return anchors.length > 0 && anchors[0].at <= ms;
}

export interface AudioPlanInput {
  index: number;
  meta: AudioFileMeta;
  anchors: TimezoneAnchor[];
  fallbackTimezone: string;
  now?: number;
}

/** Title, instant and zone for one file. Duplicates are marked separately. */
export function planAudioImportRow({ index, meta, anchors, fallbackTimezone, now = Date.now() }: AudioPlanInput): PlannedAudio {
  const base = baseName(meta.name);
  const lastModified = meta.lastModified != null && Number.isFinite(meta.lastModified) && meta.lastModified > 0 ? meta.lastModified : null;
  const stamp = parseStamp(base);
  const prefix = stamp ? null : parseDatePrefix(base);

  let title: string | null;
  let instant: number;
  let timezone: string;
  let timeSource: AudioTimeSource;
  let tzSource: AudioTimezoneSource;

  if (stamp) {
    title = cleanTitle(stamp.rest);
    // Anchors are hours to days apart, so reading the wall time as UTC is close
    // enough to pick the zone the user was in at that moment.
    const approx = Date.UTC(stamp.y, stamp.m - 1, stamp.d, stamp.hh, stamp.mm, stamp.ss);
    timezone = timezoneAt(anchors, approx, fallbackTimezone);
    tzSource = hasAnchorAtOrBefore(anchors, approx) ? 'history' : 'fallback';
    instant = wallTimeToUtcMs(stamp.y, stamp.m, stamp.d, stamp.hh, stamp.mm, stamp.ss, 0, timezone);
    timeSource = 'filename';
  } else if (prefix) {
    title = cleanTitle(prefix.rest);
    const approx = Date.UTC(prefix.y, prefix.m - 1, prefix.d, DEFAULT_HOUR);
    timezone = timezoneAt(anchors, approx, fallbackTimezone);
    tzSource = hasAnchorAtOrBefore(anchors, approx) ? 'history' : 'fallback';
    if (lastModified != null && localDateInZone(lastModified, timezone) === prefix.date) {
      instant = lastModified;
      timeSource = 'file_modified';
    } else {
      instant = wallTimeToUtcMs(prefix.y, prefix.m, prefix.d, DEFAULT_HOUR, 0, 0, 0, timezone);
      timeSource = 'default_evening';
    }
  } else {
    title = cleanTitle(base);
    instant = lastModified ?? now;
    timeSource = lastModified != null ? 'file_modified' : 'missing';
    timezone = timezoneAt(anchors, instant, fallbackTimezone);
    tzSource = hasAnchorAtOrBefore(anchors, instant) ? 'history' : 'fallback';
  }

  const mime = audioMimeForName(meta.name);
  let error: string | null = null;
  if (!mime) error = 'Not a supported audio file';
  else if (!Number.isFinite(meta.size) || meta.size <= 0) error = 'The file is empty';
  else if (meta.size > MAX_AUDIO_BYTES) error = 'The file is larger than 1 GB';

  return {
    index,
    filename: meta.name,
    mime,
    bytes: Number.isFinite(meta.size) ? meta.size : 0,
    title,
    checked_in_at: new Date(instant).toISOString(),
    timezone,
    local_date: localDateInZone(instant, timezone),
    time_source: timeSource,
    tz_source: tzSource,
    sha256: meta.sha256 && /^[0-9a-f]{64}$/i.test(meta.sha256) ? meta.sha256.toLowerCase() : null,
    duplicate: null,
    selected_default: error == null && timeSource !== 'missing',
    error,
  };
}

/**
 * Flag rows whose audio is byte-identical (same SHA-256) to audio already
 * attached to one of the user's notes, or to an earlier row of this batch, and
 * untick them. Mutates and returns `rows`.
 */
export function markAudioDuplicates(rows: PlannedAudio[], existingSha256: ReadonlySet<string>): PlannedAudio[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.error || !row.sha256) continue;
    if (existingSha256.has(row.sha256)) row.duplicate = 'checksum';
    else if (seen.has(row.sha256)) row.duplicate = 'batch';
    if (row.duplicate) row.selected_default = false;
    seen.add(row.sha256);
  }
  return rows;
}
