import crypto from 'crypto';
import { parse } from 'csv-parse/sync';

// ============================================================================
// Yamtrack export CSV parsing and classification.
//
// Shared by the preview endpoint (classify without writing) and the import
// endpoint (classify + transactional idempotent upsert).
//
// Row dispositions (per product decision):
//   - tv / season rows       -> upsert a tv_show media_item, no check-in
//   - episode rows           -> Completed episode check-in timed at end_date
//                               (falling back to start_date, timezone UTC).
//                               Rows are duplicates only when media_id, season,
//                               episode, AND end_date all match.
//   - movie/game/book + Completed/In progress/Dropped -> media_item + check-in
//   - movie/game/book + Planning/Paused               -> media_item only
// ============================================================================

export type YamtrackMediaType = 'tv' | 'season' | 'episode' | 'movie' | 'game' | 'book';

export interface YamtrackRow {
  media_id: string;
  source: string;
  media_type: string;
  title: string;
  image: string | null;
  season_number: string | null;
  episode_number: string | null;
  score: string | null;
  status: string | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  progress: string | null;
  created_at: string | null;
  progressed_at: string | null;
  /** 1-based line number in the CSV (header is line 1). */
  line: number;
}

export type YamtrackDisposition =
  | 'create_tv_show'
  | 'create_episode_checkin'
  | 'create_checkin'
  | 'create_media_item'
  | 'duplicate'
  | 'skipped';

export interface YamtrackPlanItem {
  row: YamtrackRow;
  disposition: YamtrackDisposition;
  reason: string;
  media_type: 'tv_show' | 'movie' | 'game' | 'book' | null;
  external_source: 'tmdb' | 'tgdb' | 'hardcover' | null;
  external_id: string | null;
  checkin_type: 'completed' | 'in_progress' | 'dropped' | null;
  season_number: number | null;
  episode_number: number | null;
  rating: number | null;
  raw_score: number | null;
  checked_in_at: string | null;
  external_event_id: string | null;
  /** For duplicate rows: the line number of the row that will be imported. */
  duplicate_of_line: number | null;
  /** Set when a check-in was actually imported: the stored check-in id. */
  imported_checkin_id?: string | null;
  /** Set when a media item was created/updated. */
  media_item_id?: string | null;
}

export function mapYamtrackSource(source: string): 'tmdb' | 'tgdb' | 'hardcover' | null {
  switch (source) {
    case 'tmdb':
      return 'tmdb';
    case 'igdb':
    case 'tgdb':
      return 'tgdb';
    case 'hardcover':
      return 'hardcover';
    default:
      return null;
  }
}

export function mapYamtrackMediaType(mediaType: string, source: string): YamtrackPlanItem['media_type'] {
  switch (mediaType) {
    case 'tv':
    case 'season':
    case 'episode':
      return 'tv_show';
    case 'movie':
      return 'movie';
    case 'game':
      return 'game';
    case 'book':
      return 'book';
    default:
      return null;
  }
}

/**
 * Map a Yamtrack 0-10 score to a 0-4 star rating.
 * 10 -> 4, 7.5-9.99 -> 3, 5-7.49 -> 2, 2.5-4.99 -> 1, else 0.
 * Null/blank scores produce a null rating.
 */
export function scoreToRating(score: string | null | undefined): number | null {
  if (score == null || score === '') return null;
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 10) return 4;
  if (value >= 7.5) return 3;
  if (value >= 5) return 2;
  if (value >= 2.5) return 1;
  return 0;
}

export function mapYamtrackStatus(status: string | null): YamtrackPlanItem['checkin_type'] {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  if (normalized === 'completed') return 'completed';
  if (normalized === 'in progress') return 'in_progress';
  if (normalized === 'dropped') return 'dropped';
  return null; // planning, paused, etc.
}

/** Parse raw CSV text into Yamtrack rows. Throws on malformed input. */
export function parseYamtrackCsv(csv: string): YamtrackRow[] {
  const records = parse<Record<string, string>, Record<string, string>>(csv, {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  return records.map((rec, idx) => ({
    media_id: cleanStr(rec.media_id) ?? '',
    source: cleanStr(rec.source) ?? '',
    media_type: cleanStr(rec.media_type) ?? '',
    title: cleanStr(rec.title) ?? '',
    image: cleanStr(rec.image),
    season_number: cleanStr(rec.season_number),
    episode_number: cleanStr(rec.episode_number),
    score: cleanStr(rec.score),
    status: cleanStr(rec.status),
    notes: cleanStr(rec.notes),
    start_date: cleanStr(rec.start_date),
    end_date: cleanStr(rec.end_date),
    progress: cleanStr(rec.progress),
    created_at: cleanStr(rec.created_at),
    progressed_at: cleanStr(rec.progressed_at),
    line: idx + 2, // header is line 1
  }));
}

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

export function yamtrackExternalEventId(row: YamtrackRow, dedupeKey: string): string {
  return crypto.createHash('sha1').update(dedupeKey).digest('hex');
}

/**
 * Classify every row into a plan. Deterministic and side-effect free.
 *
 * Dedupe within the file: episode rows are duplicates only when media_id,
 * source, season, episode, and end_date all match (first occurrence wins);
 * the same episode with different end_dates is a rewatch and stays.
 * Media rows dedupe on (media_id, source, media_type, start_date).
 */
export function planYamtrackImport(rows: YamtrackRow[]): YamtrackPlanItem[] {
  const plans: YamtrackPlanItem[] = [];

  // Index episode rows for dedupe: (media_id, source, s, e, checked_at) -> first plan index.
  const episodeByKey = new Map<string, number>();

  for (const row of rows) {
    const mediaType = mapYamtrackMediaType(row.media_type, row.source);
    const externalSource = mapYamtrackSource(row.source);

    if (!mediaType || !row.title) {
      plans.push({
        row,
        disposition: 'skipped',
        reason: `Unrecognized media type "${row.media_type}" or missing title`,
        media_type: null,
        external_source: null,
        external_id: null,
        checkin_type: null,
        season_number: null,
        episode_number: null,
        rating: null,
        raw_score: null,
        checked_in_at: null,
        external_event_id: null,
        duplicate_of_line: null,
      });
      continue;
    }

    if (row.media_type === 'tv' || row.media_type === 'season') {
      plans.push({
        row,
        disposition: 'create_tv_show',
        reason: 'TV show / season entry creates the local TV show entity',
        media_type: 'tv_show',
        external_source: externalSource,
        external_id: row.media_id || null,
        checkin_type: null,
        season_number: row.season_number ? parseInt(row.season_number, 10) : null,
        episode_number: null,
        rating: null,
        raw_score: null,
        checked_in_at: null,
        external_event_id: null,
        duplicate_of_line: null,
      });
      continue;
    }

    if (row.media_type === 'episode') {
      const s = row.season_number ? parseInt(row.season_number, 10) : null;
      const e = row.episode_number ? parseInt(row.episode_number, 10) : null;
      if (s == null || e == null) {
        plans.push({
          row,
          disposition: 'skipped',
          reason: 'Episode row missing season/episode number',
          media_type: 'tv_show',
          external_source: externalSource,
          external_id: row.media_id || null,
          checkin_type: null,
          season_number: null,
          episode_number: null,
          rating: null,
          raw_score: null,
          checked_in_at: null,
          external_event_id: null,
          duplicate_of_line: null,
        });
        continue;
      }
      // Yamtrack stores the watch time in end_date for episode rows
      // (start_date is typically blank); fall back to start_date.
      const checkedAt = row.end_date ?? row.start_date ?? null;
      const dedupeKey = `${row.media_id}|${row.source}|episode|${s}|${e}|${checkedAt ?? ''}`;
      const existingIdx = episodeByKey.get(dedupeKey);
      if (existingIdx != null) {
        plans.push({
          row,
          disposition: 'duplicate',
          reason: `Duplicate episode row (same media, season, episode, and end_date as line ${rows[existingIdx].line})`,
          media_type: 'tv_show',
          external_source: externalSource,
          external_id: row.media_id || null,
          checkin_type: null,
          season_number: s,
          episode_number: e,
          rating: null,
          raw_score: null,
          checked_in_at: null,
          external_event_id: null,
          duplicate_of_line: rows[existingIdx].line,
        });
        continue;
      }

      const plan: YamtrackPlanItem = {
        row,
        disposition: checkedAt ? 'create_episode_checkin' : 'create_tv_show',
        reason: checkedAt
          ? 'Episode entry creates a Completed episode check-in (end_date, UTC)'
          : 'Episode row without end_date or start_date creates the TV show entity only',
        media_type: 'tv_show',
        external_source: externalSource,
        external_id: row.media_id || null,
        checkin_type: checkedAt ? 'completed' : null,
        season_number: s,
        episode_number: e,
        rating: scoreToRating(row.score),
        raw_score: row.score && Number.isFinite(Number(row.score)) ? Number(row.score) : null,
        checked_in_at: checkedAt,
        external_event_id: checkedAt ? yamtrackExternalEventId(row, dedupeKey) : null,
        duplicate_of_line: null,
      };
      plans.push(plan);
      episodeByKey.set(dedupeKey, plans.length - 1);
      continue;
    }

    // movie / game / book
    const checkinType = mapYamtrackStatus(row.status);
    const statusText = row.status || 'no status';

    if (!checkinType) {
      plans.push({
        row,
        disposition: 'create_media_item',
        reason: `Status "${statusText}" only creates the media entity (no check-in)`,
        media_type: mediaType,
        external_source: externalSource,
        external_id: row.media_id || null,
        checkin_type: null,
        season_number: null,
        episode_number: null,
        rating: null,
        raw_score: null,
        checked_in_at: null,
        external_event_id: null,
        duplicate_of_line: null,
      });
      continue;
    }

    if (!row.start_date) {
      plans.push({
        row,
        disposition: 'create_media_item',
        reason: `Status "${statusText}" but no start_date; creates the media entity only`,
        media_type: mediaType,
        external_source: externalSource,
        external_id: row.media_id || null,
        checkin_type: null,
        season_number: null,
        episode_number: null,
        rating: null,
        raw_score: null,
        checked_in_at: null,
        external_event_id: null,
        duplicate_of_line: null,
      });
      continue;
    }

    const dedupeKey = `${row.media_id}|${row.source}|${row.media_type}|${row.start_date}`;
    plans.push({
      row,
      disposition: 'create_checkin',
      reason: `Status "${statusText}" with start_date creates a ${checkinType} check-in (UTC)`,
      media_type: mediaType,
      external_source: externalSource,
      external_id: row.media_id || null,
      checkin_type: checkinType,
      season_number: null,
      episode_number: null,
      rating: scoreToRating(row.score),
      raw_score: row.score && Number.isFinite(Number(row.score)) ? Number(row.score) : null,
      checked_in_at: row.start_date,
      external_event_id: yamtrackExternalEventId(row, dedupeKey),
      duplicate_of_line: null,
    });
  }

  return plans;
}

export interface YamtrackPlanCounts {
  total: number;
  create_tv_show: number;
  create_episode_checkin: number;
  create_checkin: number;
  create_media_item: number;
  duplicate: number;
  skipped: number;
}

export function countPlans(plans: YamtrackPlanItem[]): YamtrackPlanCounts {
  const counts: YamtrackPlanCounts = {
    total: plans.length,
    create_tv_show: 0,
    create_episode_checkin: 0,
    create_checkin: 0,
    create_media_item: 0,
    duplicate: 0,
    skipped: 0,
  };
  for (const plan of plans) {
    counts[plan.disposition]++;
  }
  return counts;
}
