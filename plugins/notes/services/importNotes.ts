/**
 * Notes plugin — planning a text-file import (pure; the routes feed it).
 *
 * A file named `2017-10-15 Night with Jason.md` becomes a note dated
 * 2017-10-15 titled "Night with Jason". Its time is the file's modified time
 * when that falls on the same local date, else 8pm local. The local zone is
 * where the user's other check-ins put them at the time (timezone anchors),
 * else the fallback zone picked on the import form.
 */

import { createHash } from 'crypto';
import { localDateInZone, wallTimeToUtcMs } from 'wwp-shared';
import { timezoneAt, type TimezoneAnchor } from '../../../server/src/services/timezoneAnchors';
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH } from '../manifest';
import { firstLine, normalizeBody } from './notesRepo';

export const IMPORT_EXTENSIONS = /\.(md|markdown|txt)$/i;

/** Hour (local) given to a dated file whose modified time is on another day. */
export const DEFAULT_HOUR = 20;

export interface ImportFileMeta {
  name: string;
  /** File.lastModified (epoch ms), when the browser knew it. */
  lastModified: number | null;
}

export type TimeSource = 'file_modified' | 'default_evening' | 'missing';
export type TimezoneSource = 'history' | 'fallback';
export type DuplicateKind = 'date_title' | 'content' | 'batch';

export interface PlannedNote {
  index: number;
  filename: string;
  title: string | null;
  body: string;
  excerpt: string;
  checked_in_at: string;
  timezone: string;
  local_date: string;
  time_source: TimeSource;
  tz_source: TimezoneSource;
  duplicate: DuplicateKind | null;
  /** Ticked in the preview unless a duplicate, undated, or unreadable. */
  selected_default: boolean;
  error: string | null;
}

/** Decode file bytes: UTF-8 when valid, else Latin-1 (old Windows notes). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

export function bodyHash(body: string): string {
  return createHash('md5').update(body, 'utf8').digest('hex');
}

const DATE_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})(.*)$/;

/** Basename without directories or the extension. */
export function baseName(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? filename;
  return name.replace(/\.[^.]+$/, '');
}

/** `{date, rest}` for a name starting with a real YYYY-MM-DD date, else null. */
export function parseDatePrefix(base: string): { y: number; m: number; d: number; date: string; rest: string } | null {
  const match = DATE_PREFIX_RE.exec(base);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  // "2017-10-15T..." or "2017-10-150" is not a date prefix followed by a title.
  if (match[4] && /^[0-9]/.test(match[4])) return null;
  return { y, m, d, date: `${match[1]}-${match[2]}-${match[3]}`, rest: match[4] };
}

function cleanTitle(text: string): string | null {
  const title = text.replace(/^[\s_\-.,:;–—]+/, '').replace(/[\s_\-.,:;–—]+$/, '').replace(/\s+/g, ' ');
  return title ? title.slice(0, MAX_TITLE_LENGTH) : null;
}

function hasAnchorAtOrBefore(anchors: TimezoneAnchor[], ms: number): boolean {
  return anchors.length > 0 && anchors[0].at <= ms;
}

export interface PlanInput {
  index: number;
  meta: ImportFileMeta;
  text: string;
  anchors: TimezoneAnchor[];
  fallbackTimezone: string;
  now?: number;
}

/** Title, instant and zone for one file. Duplicates are marked separately. */
export function planImportRow({ index, meta, text, anchors, fallbackTimezone, now = Date.now() }: PlanInput): PlannedNote {
  const base = baseName(meta.name);
  const body = normalizeBody(text);
  const lastModified = meta.lastModified != null && Number.isFinite(meta.lastModified) ? meta.lastModified : null;
  const prefix = parseDatePrefix(base);

  let title: string | null;
  let instant: number;
  let timezone: string;
  let timeSource: TimeSource;
  let tzSource: TimezoneSource;

  if (prefix) {
    title = cleanTitle(prefix.rest);
    // Anchors are hours to days apart, so reading the wall time as UTC is
    // close enough to pick the zone the user was in that evening.
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

  let error: string | null = null;
  if (!title && !/\S/.test(body)) error = 'The file is empty';
  else if (body.length > MAX_BODY_LENGTH) error = `The file is too long (max ${MAX_BODY_LENGTH} characters)`;

  return {
    index,
    filename: meta.name,
    title,
    body,
    excerpt: firstLine(body),
    checked_in_at: new Date(instant).toISOString(),
    timezone,
    local_date: localDateInZone(instant, timezone),
    time_source: timeSource,
    tz_source: tzSource,
    duplicate: null,
    selected_default: error == null && timeSource !== 'missing',
    error,
  };
}

/** What's already stored, for duplicate detection. */
export interface ExistingNoteKeys {
  /** `${local date}|${lower(title)}` of titled notes. */
  dateTitles: Set<string>;
  /** md5 of each note's body. */
  bodyHashes: Set<string>;
}

function dateTitleKey(date: string, title: string): string {
  return `${date}|${title.toLowerCase()}`;
}

export function existingKey(date: string, title: string | null): string | null {
  return title ? dateTitleKey(date, title) : null;
}

/**
 * Flag rows matching a stored note (same local date + title, or the same
 * text) or an earlier row of the same batch, and untick them. Mutates and
 * returns `rows`.
 */
export function markDuplicates(rows: PlannedNote[], existing: ExistingNoteKeys): PlannedNote[] {
  const batchKeys = new Set<string>();
  const batchHashes = new Set<string>();
  for (const row of rows) {
    if (row.error) continue;
    const key = row.title ? dateTitleKey(row.local_date, row.title) : null;
    const hash = /\S/.test(row.body) ? bodyHash(row.body) : null;
    if (key && existing.dateTitles.has(key)) row.duplicate = 'date_title';
    else if (hash && existing.bodyHashes.has(hash)) row.duplicate = 'content';
    else if ((key && batchKeys.has(key)) || (hash && batchHashes.has(hash))) row.duplicate = 'batch';
    if (row.duplicate) row.selected_default = false;
    if (key) batchKeys.add(key);
    if (hash) batchHashes.add(hash);
  }
  return rows;
}

/** Parse the multipart `meta` field: one `{name, lastModified}` per uploaded file, in order. */
export function parseImportMeta(raw: unknown, fileCount: number, fallbackNames: string[]): ImportFileMeta[] {
  let parsed: unknown = [];
  if (typeof raw === 'string' && raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = [];
    }
  }
  const list = Array.isArray(parsed) ? parsed : [];
  const metas: ImportFileMeta[] = [];
  for (let i = 0; i < fileCount; i++) {
    const m = (list[i] ?? {}) as Record<string, unknown>;
    const name = typeof m.name === 'string' && m.name ? m.name : fallbackNames[i];
    const lm = Number(m.lastModified);
    metas.push({ name, lastModified: m.lastModified != null && Number.isFinite(lm) && lm > 0 ? lm : null });
  }
  return metas;
}
