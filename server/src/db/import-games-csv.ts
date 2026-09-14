// ============================================================================
// One-off importer for a hand-maintained games CSV (columns:
//   Title, Genre, Platform, Rating, Notes, Playtime (Hours)).
//
// Usage (from server/):
//   npm run import:games -- --dry-run             # offline preview: no TGDB calls, no writes
//   npm run import:games                          # import the default CSV
//   npm run import:games -- --dry-run /path/file  # preview a different CSV
//   npm run import:games -- /path/to/file.csv     # import a different CSV
//
// Behavior:
//   - Genre is dropped (nothing in the schema stores it).
//   - Every row becomes a 'completed' check-in at the import time (UTC).
//   - Rating (0-10) is stored as raw_score (exact) and rating (0-4 stars,
//     via scoreToRating — same convention as Yamtrack imports).
//   - Time played is a cumulative total that NEVER decreases:
//     stored = max(current stored total, CSV hours * 60).
//   - Metadata enrichment uses one TGDB ByGameName call per game, sequential
//     with a delay between calls. After repeated failures (e.g. hitting the
//     monthly rate cap, 403) further calls stop and the remaining games are
//     created local-only — re-running the script later enriches them.
//   - Title matching is strict: a CSV row only joins an existing game item
//     on an EXACT normalized-title match (or a whitelisted edition qualifier
//     like "… Steam Edition"). Sequels, subtitles, and partial overlaps
//     ("Battlefield 2" vs "Battlefield 2042", "Half-Life 2: Episode One" vs
//     "Half-Life 2") are treated as different games — a new item is created
//     instead of folding data into the wrong one.
//   - Idempotent:
//       * check-ins are deduped by external_event_id =
//         'ggbl:' + sha1(normalized title);
//       * media items are matched by normalized title against ALL existing
//         game items loaded into memory.
//     Re-running only raises time played (never lowers it) and enriches
//     local-only items; it never creates duplicate rows.
//
// A backup is recommended before the first real run: the Settings page has a
// full backup export, or use pg_dump on the database.
// ============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { pool } from './index';
import { tgdb, type TgdbGameResult } from '../services/tgdb';
import { scoreToRating } from '../services/yamtrack';
import { normalizeTitle, titleRelation } from '../services/titleMatch';

// Re-exported for any external consumers of this module's title helpers.
export { normalizeTitle, titleRelation };

const USER_ID = '00000000-0000-0000-0000-000000000001';
const TGDB_API_LIMIT_URL = 'https://api.thegamesdb.net/v1/API/Limit';
/** Delay between consecutive TGDB API calls. */
const TGDB_DELAY_MS = 500;
/** Abort further TGDB calls after this many consecutive failures. */
const TGDB_MAX_CONSECUTIVE_FAILURES = 3;

const DEFAULT_CSV = path.join(
  os.homedir(),
  'Downloads',
  '(Z Only) The Great Big List of Games - Games.csv'
);

// ============================================================================
// CSV parsing
// ============================================================================

interface GameCsvRow {
  line: number;
  title: string;
  platform: string | null;
  rawRating: string | null;
  notes: string | null;
  playtimeHours: number | null;
  timePlayedMinutes: number | null;
  rating: number | null;
  rawScore: number | null;
}

function cleanStr(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

export function parseGamesCsv(csv: string): GameCsvRow[] {
  const records = parse<Record<string, string>, Record<string, string>>(csv, {
    columns: true,
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  return records.map((rec, idx) => {
    const title = cleanStr(rec['Title']);
    if (!title) {
      throw new Error(`Line ${idx + 2}: missing Title`);
    }

    let playtimeHours: number | null = null;
    const rawPlaytime = cleanStr(rec['Playtime (Hours)']);
    if (rawPlaytime != null) {
      const value = Number(rawPlaytime);
      if (Number.isFinite(value) && value >= 0) playtimeHours = value;
    }

    let rating: number | null = null;
    let rawScore: number | null = null;
    const rawRating = cleanStr(rec['Rating']);
    if (rawRating != null) {
      const value = Number(rawRating);
      if (Number.isFinite(value) && value >= 0) {
        rawScore = value;
        rating = scoreToRating(rawRating);
      }
    }

    return {
      line: idx + 2,
      title,
      platform: cleanStr(rec['Platform']),
      rawRating,
      notes: cleanStr(rec['Notes']),
      playtimeHours,
      timePlayedMinutes:
        playtimeHours != null ? Math.round(playtimeHours * 60) : null,
      rating,
      rawScore,
    };
  });
}

/** Stable idempotency key for the check-in created by a CSV row. */
function checkinEventId(title: string): string {
  return `ggbl:${crypto.createHash('sha1').update(normalizeTitle(title)).digest('hex')}`;
}

// ============================================================================
// Local DB state (loaded once, matched in memory — no per-row lookups)
// ============================================================================

interface LocalGame {
  id: string;
  title: string;
  external_source: string | null;
  external_id: string | null;
  /** Latest non-null time_played_minutes across the item's check-ins. */
  time_played_minutes: number | null;
}

/**
 * Load all game media items with their latest stored time total, indexed by
 * normalized title and by (external_source, external_id).
 */
async function loadLocalGames(): Promise<{
  byExactKey: Map<string, LocalGame>;
  byExternal: Map<string, LocalGame>;
  all: LocalGame[];
}> {
  const res = await pool.query<LocalGame>(
    `SELECT mi.id, mi.title, mi.external_source, mi.external_id,
            mc.time_played_minutes
     FROM media_items mi
     LEFT JOIN LATERAL (
       SELECT time_played_minutes
       FROM media_checkins
       WHERE media_item_id = mi.id AND time_played_minutes IS NOT NULL
       ORDER BY checked_in_at DESC, id DESC
       LIMIT 1
     ) mc ON true
     WHERE mi.user_id = $1 AND mi.media_type = 'game'`,
    [USER_ID]
  );

  const all = res.rows;
  const byExactKey = new Map<string, LocalGame>();
  const byExternal = new Map<string, LocalGame>();
  for (const game of all) {
    const key = normalizeTitle(game.title);
    if (!byExactKey.has(key)) byExactKey.set(key, game);
    if (game.external_source && game.external_id) {
      byExternal.set(`${game.external_source}:${game.external_id}`, game);
    }
  }
  return { byExactKey, byExternal, all };
}

/**
 * Match a CSV title against existing local games: exact normalized title, or
 * a same-game edition qualifier ("… Steam Edition"). Everything else counts
 * as a different game.
 */
function matchLocalGame(
  title: string,
  byExactKey: Map<string, LocalGame>,
  all: LocalGame[]
): LocalGame | null {
  const key = normalizeTitle(title);
  const exact = byExactKey.get(key);
  if (exact) return exact;
  return all.find((g) => titleRelation(key, normalizeTitle(g.title)) === 'edition') ?? null;
}

/** Set of normalized titles that already have a check-in from a prior import. */
async function loadImportedTitles(): Promise<Set<string>> {
  const res = await pool.query(
    `SELECT external_event_id FROM media_checkins
     WHERE user_id = $1 AND external_event_id LIKE 'ggbl:%'`,
    [USER_ID]
  );
  const imported = new Set<string>();
  for (const row of res.rows) {
    // Inverse of checkinEventId is not computable (sha1); instead we re-hash
    // nothing here — the caller compares event ids directly. Keep the raw ids.
    imported.add(row.external_event_id as string);
  }
  return imported;
}

// ============================================================================
// TGDB
// ============================================================================

async function fetchRemainingAllowance(apiKey: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${TGDB_API_LIMIT_URL}?apikey=${encodeURIComponent(apiKey)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { remaining_monthly_allowance?: number };
      return Number.isFinite(json.remaining_monthly_allowance)
        ? json.remaining_monthly_allowance!
        : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

interface TgdbLookup {
  /** null => no usable TGDB match (API failed, rate-limited, or no results). */
  match: TgdbGameResult | null;
  failed: boolean;
}

/**
 * Pick the TGDB result for a CSV title: exact normalized title, then a
 * same-game edition qualifier. Anything else is left unmatched (the game is
 * created local-only) so a wrong external_id is never stored.
 */
function pickBestTgdbMatch(
  results: TgdbGameResult[] | null,
  row: GameCsvRow
): TgdbGameResult | null {
  if (!results || results.length === 0) return null;
  const target = normalizeTitle(row.title);

  // Exact, then a same-game edition qualifier. Anything else is left
  // unmatched so the game is created local-only rather than risking a wrong
  // external_id (TGDB matches can't be reviewed in --dry-run).
  return results.find(
    (r) => titleRelation(target, normalizeTitle(r.title)) === 'exact' ||
           titleRelation(target, normalizeTitle(r.title)) === 'edition'
  ) ?? null;
}

/**
 * Sequential, delayed, degrading TGDB lookup. Returns line -> result.
 * Stops making calls after repeated consecutive failures (rate cap).
 */
async function lookupGames(
  rows: GameCsvRow[],
  apiKey: string
): Promise<Map<number, TgdbLookup>> {
  const results = new Map<number, TgdbLookup>();
  let consecutiveFailures = 0;
  let aborted = false;

  for (const row of rows) {
    if (aborted) {
      results.set(row.line, { match: null, failed: true });
      continue;
    }
    try {
      const found = await tgdb.searchGames(apiKey, row.title);
      if (!found) {
        // 403 (rate cap) or network failure; withDegradation logged it.
        consecutiveFailures++;
        if (consecutiveFailures >= TGDB_MAX_CONSECUTIVE_FAILURES) {
          console.warn(
            `  ! ${consecutiveFailures} consecutive TGDB failures — stopping TGDB lookups; ` +
              `remaining games will be local-only (re-run later to enrich).`
          );
          aborted = true;
        }
        results.set(row.line, { match: null, failed: true });
      } else {
        consecutiveFailures = 0;
        results.set(row.line, {
          match: pickBestTgdbMatch(found, row),
          failed: false,
        });
      }
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= TGDB_MAX_CONSECUTIVE_FAILURES) aborted = true;
      results.set(row.line, { match: null, failed: true });
    }
    if (!aborted) {
      await new Promise((resolve) => setTimeout(resolve, TGDB_DELAY_MS));
    }
  }

  return results;
}

// ============================================================================
// Dry run (offline: DB reads only, no TGDB calls, no writes)
// ============================================================================

async function runDryRun(rows: GameCsvRow[]): Promise<void> {
  const { byExactKey, all } = await loadLocalGames();
  const importedEventIds = await loadImportedTitles();

  let matchedLocal = 0;
  let newGames = 0;
  let alreadyImported = 0;

  console.log('');
  console.log('=== DRY RUN (no TGDB calls, no writes) ===');
  console.log('');
  console.log(
    pad('CSV title', 50) + pad('status', 18) + pad('matched local game', 38) +
      'rating      time played'
  );
  console.log('-'.repeat(128));

  for (const row of rows) {
    const local = matchLocalGame(row.title, byExactKey, all);

    // A row is "already imported" when a ggbl: check-in for this exact title
    // exists from a prior run of this script.
    const isImported = importedEventIds.has(checkinEventId(row.title));

    let status: string;
    let matchLabel: string;
    if (isImported) {
      status = 'ALREADY IMPORTED';
      matchLabel = local ? local.title : '—';
      alreadyImported++;
    } else if (local) {
      status = local.external_source ? 'matches TGDB local' : 'matches manual';
      matchLabel = local.title;
      matchedLocal++;
    } else {
      status = 'NEW';
      matchLabel = '(TGDB lookup at import time)';
      newGames++;
    }

    const existingTotal =
      local?.time_played_minutes != null ? Number(local.time_played_minutes) : null;

    let timeLabel: string;
    if (row.timePlayedMinutes == null) {
      timeLabel = 'no time in CSV';
    } else if (existingTotal == null) {
      timeLabel = `new total ${fmtHours(row.timePlayedMinutes)}`;
    } else if (row.timePlayedMinutes > existingTotal) {
      timeLabel = `increase ${fmtHours(existingTotal)} → ${fmtHours(row.timePlayedMinutes)}`;
    } else {
      timeLabel = `no change (kept ${fmtHours(existingTotal)})`;
    }

    const ratingLabel =
      row.rawScore != null ? `${row.rating}★ (${row.rawScore}/10)` : '—';

    console.log(
      pad(truncate(row.title, 50), 50) +
        pad(status, 18) +
        pad(truncate(matchLabel, 38), 38) +
        pad(ratingLabel, 12) +
        timeLabel
    );
  }

  console.log('-'.repeat(128));
  console.log(
    `${rows.length} rows · ${alreadyImported} already imported (skipped) · ` +
      `${matchedLocal} match existing local games · ${newGames} new (TGDB lookup at import time)`
  );
  console.log('');
  console.log('If this looks right, re-run without --dry-run to import.');
}

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return `${Math.round(h * 100) / 100}h`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s + ' ' : s + ' '.repeat(width - s.length);
}

function truncate(s: string, width: number): string {
  return s.length > width ? s.slice(0, width - 1) + '…' : s;
}

// ============================================================================
// Real import
// ============================================================================

interface ImportStats {
  checkinsCreated: number;
  checkinsSkipped: number;
  itemsCreated: number;
  itemsEnriched: number;
  timeRaised: number;
  tgdbMatches: number;
  tgdbFailed: number;
}

async function runImport(rows: GameCsvRow[]): Promise<ImportStats> {
  const stats: ImportStats = {
    checkinsCreated: 0,
    checkinsSkipped: 0,
    itemsCreated: 0,
    itemsEnriched: 0,
    timeRaised: 0,
    tgdbMatches: 0,
    tgdbFailed: 0,
  };

  // TGDB API key + up-front allowance check.
  const keyRes = await pool.query(
    'SELECT tgdb_api_key FROM user_settings WHERE user_id = $1',
    [USER_ID]
  );
  const apiKey = keyRes.rows[0]?.tgdb_api_key || null;

  // Local state snapshot (item lookup + idempotency) — matches in memory so
  // the per-row work stays inside a single DB transaction.
  const { byExactKey, byExternal, all } = await loadLocalGames();
  // Items created earlier in THIS run, keyed the same way as byExternal, so
  // two CSV rows resolving to the same TGDB id never double-insert.
  const createdExternal = new Map<string, LocalGame>();

  let lookups = new Map<number, TgdbLookup>();
  if (apiKey) {
    const allowance = await fetchRemainingAllowance(apiKey);
    if (allowance != null) {
      console.log(`TGDB remaining monthly allowance: ${allowance}`);
      if (allowance < rows.length) {
        console.warn(
          `  ! Allowance (${allowance}) is lower than the row count (${rows.length}); ` +
            `some games may end up local-only. Re-running later will enrich them.`
        );
      }
    } else {
      console.log('Could not check TGDB allowance; proceeding.');
    }
    console.log(
      `Looking up ${rows.length} games in TGDB (sequential, ${TGDB_DELAY_MS}ms apart)…`
    );
    lookups = await lookupGames(rows, apiKey);
    console.log('');
  } else {
    console.warn('No TGDB API key in user_settings — all games will be local-only.');
  }

  const importTime = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const lookup = lookups.get(row.line);
      const match = lookup?.match ?? null;
      if (match) stats.tgdbMatches++;
      if (lookup?.failed) stats.tgdbFailed++;

      const eventId = checkinEventId(row.title);

      // Idempotency: a ggbl: check-in for this title means an earlier run of
      // this script already imported the row — nothing more to do.
      const existing = await client.query(
        `SELECT id FROM media_checkins WHERE user_id = $1 AND external_event_id = $2`,
        [USER_ID, eventId]
      );
      if (existing.rows.length > 0) {
        stats.checkinsSkipped++;
        continue;
      }

      // Find-or-create the media item.
      const local = matchLocalGame(row.title, byExactKey, all);
      // An existing item that already claims this TGDB id (from the preloaded
      // snapshot or created earlier in this run). Reusing it is what keeps
      // the (external_source, external_id) unique index happy.
      const externalHolder = match
        ? byExternal.get(`tgdb:${match.externalId}`) ??
          createdExternal.get(`tgdb:${match.externalId}`) ??
          null
        : null;
      let mediaItemId: string;
      // When the TGDB id is already claimed by a DIFFERENT item (in the
      // snapshot or created earlier in this run), attach to that item instead
      // of the title match — reusing it is what keeps the (external_source,
      // external_id) unique index happy.
      const reuseExternal =
        match && externalHolder && (!local || externalHolder.id !== local.id)
          ? externalHolder
          : null;

      if (reuseExternal) {
        mediaItemId = reuseExternal.id;
      } else if (local) {
        mediaItemId = local.id;
        // Enrich a local-only item with TGDB data, filling nulls only so
        // manually set values are never clobbered.
        if (match && !local.external_source) {
          await client.query(
            `UPDATE media_items
             SET external_source = 'tgdb',
                 external_id = COALESCE(external_id, $2),
                 release_year = COALESCE(release_year, $3),
                 image_url = COALESCE(image_url, $4),
                 external_url = COALESCE(external_url, $5),
                 platform = COALESCE(platform, $6),
                 updated_at = NOW()
             WHERE id = $1`,
            [
              mediaItemId,
              match.externalId,
              match.releaseYear,
              match.imageUrl,
              match.externalUrl,
              match.platform ?? row.platform,
            ]
          );
          stats.itemsEnriched++;
        }
      } else {
        const ins = await client.query(
          `INSERT INTO media_items
             (user_id, media_type, external_source, external_id, title,
              release_year, image_url, external_url, platform)
           VALUES ($1, 'game', $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            USER_ID,
            match ? 'tgdb' : null,
            match?.externalId ?? null,
            match?.title ?? row.title,
            match?.releaseYear ?? null,
            match?.imageUrl ?? null,
            match?.externalUrl ?? null,
            match?.platform ?? row.platform ?? null,
          ]
        );
        mediaItemId = ins.rows[0].id as string;
        stats.itemsCreated++;
        if (match) {
          createdExternal.set(`tgdb:${match.externalId}`, {
            id: mediaItemId,
            title: match.title ?? row.title,
            external_source: 'tgdb',
            external_id: match.externalId,
            time_played_minutes: null,
          });
        }
      }

      // Time played: read the current stored total BEFORE inserting so the
      // new row does not mask it, then store max(current, imported).
      const totalRes = await client.query(
        `SELECT time_played_minutes FROM media_checkins
         WHERE media_item_id = $1 AND time_played_minutes IS NOT NULL
         ORDER BY checked_in_at DESC, id DESC LIMIT 1`,
        [mediaItemId]
      );
      const currentTotal =
        totalRes.rows[0]?.time_played_minutes != null
          ? Number(totalRes.rows[0].time_played_minutes)
          : null;

      const storedTime =
        row.timePlayedMinutes != null
          ? Math.max(currentTotal ?? 0, row.timePlayedMinutes)
          : null;
      if (storedTime != null && (currentTotal == null || storedTime > currentTotal)) {
        stats.timeRaised++;
      }

      await client.query(
        `INSERT INTO media_checkins
           (user_id, media_item_id, checkin_type, rating, raw_score, notes,
            checked_in_at, checkin_timezone, external_event_id, time_played_minutes)
         VALUES ($1, $2, 'completed', $3, $4, $5, $6::timestamptz, 'UTC', $7, $8)`,
        [
          USER_ID,
          mediaItemId,
          row.rating,
          row.rawScore,
          row.notes,
          importTime,
          eventId,
          storedTime,
        ]
      );
      stats.checkinsCreated++;

      const src = match
        ? `TGDB ${match.externalId}`
        : lookup?.failed
          ? 'local-only (TGDB failed)'
          : 'local-only';
      const timeNote =
        storedTime != null && currentTotal != null && storedTime > currentTotal
          ? `  time ${fmtHours(currentTotal)} → ${fmtHours(storedTime)}`
          : '';
      console.log(`  ✓ line ${row.line}: ${row.title} [${src}]${timeNote}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return stats;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const csvPath = args.find((a) => !a.startsWith('--')) ?? DEFAULT_CSV;

  const resolved = path.isAbsolute(csvPath) ? csvPath : path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`CSV not found: ${resolved}`);
    process.exit(1);
  }
  const csv = fs.readFileSync(resolved, 'utf-8');

  let rows: GameCsvRow[];
  try {
    rows = parseGamesCsv(csv);
  } catch (err: any) {
    console.error(`Failed to parse CSV: ${err.message}`);
    process.exit(1);
  }
  console.log(`Parsed ${rows.length} game rows from ${resolved}`);

  if (dryRun) {
    await runDryRun(rows);
  } else {
    console.log(`Importing ${rows.length} games (checked in at ${new Date().toISOString()})…`);
    console.log('');
    const stats = await runImport(rows);
    console.log('');
    console.log('=== IMPORT COMPLETE ===');
    console.log(`  check-ins created:    ${stats.checkinsCreated}`);
    console.log(`  check-ins skipped:    ${stats.checkinsSkipped} (already imported)`);
    console.log(`  media items created:  ${stats.itemsCreated}`);
    console.log(`  media items enriched: ${stats.itemsEnriched}`);
    console.log(`  time totals raised:   ${stats.timeRaised}`);
    console.log(`  TGDB matches:         ${stats.tgdbMatches}`);
    console.log(`  TGDB failures:        ${stats.tgdbFailed}${stats.tgdbFailed ? ' (re-run later to enrich those games)' : ''}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
