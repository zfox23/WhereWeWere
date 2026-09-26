// ============================================================================
// One-off importer for a hand-maintained games CSV (columns:
//   Title, Genre, Platform, Rating, Notes, Playtime (Hours), Status).
//
// Usage (from server/):
//   npm run import:games -- --dry-run             # offline preview: no IGDB calls, no writes
//   npm run import:games                          # import the default CSV
//   npm run import:games -- --dry-run /path/file  # preview a different CSV
//   npm run import:games -- /path/to/file.csv     # import a different CSV
//
// Behavior:
//   - Genre is dropped (nothing in the schema stores it).
//   - NO check-ins are created. Rating, notes, time played, and status are
//     written directly on the media_items row (item-level metadata).
//   - Rating (0-10) is stored as raw_score (exact) and rating (0-4 stars,
//     via scoreToRating — same convention as Yamtrack imports).
//   - Time played is a cumulative total that NEVER decreases:
//     stored = max(current stored total, CSV hours * 60).
//   - Status (optional column: completed / in progress / dropped). When the
//     column or its value is absent, it defaults to 'completed' when the row
//     has a rating or playtime, else 'in_progress'.
//   - Metadata enrichment uses one IGDB search per game, sequential with a
//     delay between calls. After repeated consecutive failures further
//     calls stop and the remaining games are created local-only — re-running
//     the script later enriches them.
//   - Title matching is strict: a CSV row only joins an existing game item
//     on an EXACT normalized-title match (or a whitelisted edition qualifier
//     like "… Steam Edition"). Sequels, subtitles, and partial overlaps
//     ("Battlefield 2" vs "Battlefield 2042", "Half-Life 2: Episode One" vs
//     "Half-Life 2") are treated as different games — a new item is created
//     instead of folding data into the wrong one.
//   - Idempotent: media items are matched by normalized title against ALL
//     existing game items loaded into memory; the metadata UPDATE is safe to
//     re-run (only raises time played, re-enriches local-only items).
//
// A backup is recommended before the first real run: the Settings page has a
// full backup export, or use pg_dump on the database.
// ============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse } from 'csv-parse/sync';
import { pool } from '../../server/src/db';
import { igdb, pickIgdbCandidate, type IgdbGameResult } from '../services/igdb';
import { scoreToRating } from '../../server/src/services/yamtrack';
import { normalizeTitle, titleRelation } from '../services/titleMatch';

// Re-exported for any external consumers of this module's title helpers.
export { normalizeTitle, titleRelation };

import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';
/** Delay between consecutive IGDB API calls (limit: 4 req/s). */
const IGDB_DELAY_MS = 300;
/** Abort further IGDB calls after this many consecutive failures. */
const IGDB_MAX_CONSECUTIVE_FAILURES = 3;

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
  /** Raw Status column value (completed / in progress / dropped), if present. */
  rawStatus: string | null;
  playtimeHours: number | null;
  timePlayedMinutes: number | null;
  rating: number | null;
  rawScore: number | null;
  /** Resolved item status: explicit CSV value, else a default. */
  status: 'completed' | 'in_progress' | 'dropped';
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

    const rawStatus = cleanStr(rec['Status']);
    const normalizedStatus = rawStatus ? rawStatus.toLowerCase().replace(/[\s-]+/g, '_') : null;
    const status: GameCsvRow['status'] =
      normalizedStatus === 'completed' ? 'completed'
      : normalizedStatus === 'in_progress' ? 'in_progress'
      : normalizedStatus === 'dropped' ? 'dropped'
      : // No explicit status: a rated or played game is treated as completed.
        rating != null || playtimeHours != null ? 'completed' : 'in_progress';

    return {
      line: idx + 2,
      title,
      platform: cleanStr(rec['Platform']),
      rawRating,
      notes: cleanStr(rec['Notes']),
      rawStatus,
      playtimeHours,
      timePlayedMinutes:
        playtimeHours != null ? Math.round(playtimeHours * 60) : null,
      rating,
      rawScore,
      status,
    };
  });
}

// ============================================================================
// Local DB state (loaded once, matched in memory — no per-row lookups)
// ============================================================================

interface LocalGame {
  id: string;
  title: string;
  external_source: string | null;
  external_id: string | null;
  /** Item-level stored time total. */
  time_played_minutes: number | null;
}

/**
 * Load all game media items with their stored time total, indexed by
 * normalized title and by (external_source, external_id).
 */
async function loadLocalGames(): Promise<{
  byExactKey: Map<string, LocalGame>;
  byExternal: Map<string, LocalGame>;
  all: LocalGame[];
}> {
  const res = await pool.query<LocalGame>(
    `SELECT id, title, external_source, external_id, time_played_minutes
     FROM media_items
     WHERE user_id = $1 AND media_type = 'game'`,
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

// ============================================================================
// IGDB
// ============================================================================

async function loadIgdbCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  // Keys live in plugin_settings (jsonb values) — see the 044 migration.
  const res = await pool.query(
    `SELECT key, value FROM plugin_settings
     WHERE user_id = $1 AND plugin_id = 'media' AND key IN ('igdb_client_id', 'igdb_client_secret')`,
    [USER_ID]
  );
  const decode = (v: unknown): string | null => {
    const s = typeof v === 'string' ? v : v != null ? String(v) : '';
    return s.length > 0 ? s : null;
  };
  let clientId: string | null = null;
  let clientSecret: string | null = null;
  for (const row of res.rows) {
    const value = decode(row.value);
    if (row.key === 'igdb_client_id') clientId = value;
    if (row.key === 'igdb_client_secret') clientSecret = value;
  }
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

interface IgdbLookup {
  /** null => no usable IGDB match (API failed or no strict title match). */
  match: IgdbGameResult | null;
  failed: boolean;
}

/**
 * Pick the IGDB result for a CSV title. searchCandidates already returns
 * strict same-game title matches (exact ordered first) with each match's
 * full platform list; pickIgdbCandidate applies the stored-platform /
 * console-priority preference, so a wrong external_id is never stored.
 */
function pickBestIgdbMatch(
  candidates: { result: IgdbGameResult; platforms: string[] }[] | null,
  row: GameCsvRow
): IgdbGameResult | null {
  if (!candidates || candidates.length === 0) return null;
  return pickIgdbCandidate({ title: row.title, platform: row.platform }, candidates)?.result ?? null;
}

/**
 * Sequential, delayed, degrading IGDB lookup. Returns line -> result.
 * Stops making calls after repeated consecutive failures.
 */
async function lookupGames(
  rows: GameCsvRow[],
  creds: { clientId: string; clientSecret: string }
): Promise<Map<number, IgdbLookup>> {
  const results = new Map<number, IgdbLookup>();
  let consecutiveFailures = 0;
  let aborted = false;

  for (const row of rows) {
    if (aborted) {
      results.set(row.line, { match: null, failed: true });
      continue;
    }
    try {
      const found = await igdb.searchCandidates(creds.clientId, creds.clientSecret, row.title);
      if (!found) {
        // Network/credential failure; withDegradation logged it.
        consecutiveFailures++;
        if (consecutiveFailures >= IGDB_MAX_CONSECUTIVE_FAILURES) {
          console.warn(
            `  ! ${consecutiveFailures} consecutive IGDB failures — stopping IGDB lookups; ` +
              `remaining games will be local-only (re-run later to enrich).`
          );
          aborted = true;
        }
        results.set(row.line, { match: null, failed: true });
      } else {
        consecutiveFailures = 0;
        results.set(row.line, {
          match: pickBestIgdbMatch(found, row),
          failed: false,
        });
      }
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= IGDB_MAX_CONSECUTIVE_FAILURES) aborted = true;
      results.set(row.line, { match: null, failed: true });
    }
    if (!aborted) {
      await new Promise((resolve) => setTimeout(resolve, IGDB_DELAY_MS));
    }
  }

  return results;
}

// ============================================================================
// Dry run (offline: DB reads only, no IGDB calls, no writes)
// ============================================================================

async function runDryRun(rows: GameCsvRow[]): Promise<void> {
  const { byExactKey, all } = await loadLocalGames();

  let matchedLocal = 0;
  let newGames = 0;

  console.log('');
  console.log('=== DRY RUN (no IGDB calls, no writes) ===');
  console.log('');
  console.log(
    pad('CSV title', 50) + pad('match', 18) + pad('matched local game', 38) +
      'rating      time played   item status'
  );
  console.log('-'.repeat(128));

  for (const row of rows) {
    const local = matchLocalGame(row.title, byExactKey, all);

    let status: string;
    let matchLabel: string;
    if (local) {
      status = local.external_source ? 'matches linked local' : 'matches manual';
      matchLabel = local.title;
      matchedLocal++;
    } else {
      status = 'NEW';
      matchLabel = '(IGDB lookup at import time)';
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
        pad(timeLabel, 22) +
        row.status
    );
  }

  console.log('-'.repeat(128));
  console.log(
    `${rows.length} rows · ${matchedLocal} match existing local games · ${newGames} new (IGDB lookup at import time)`
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
  itemsUpdated: number;
  itemsCreated: number;
  itemsEnriched: number;
  timeRaised: number;
  igdbMatches: number;
  igdbFailed: number;
}

async function runImport(rows: GameCsvRow[]): Promise<ImportStats> {
  const stats: ImportStats = {
    itemsUpdated: 0,
    itemsCreated: 0,
    itemsEnriched: 0,
    timeRaised: 0,
    igdbMatches: 0,
    igdbFailed: 0,
  };

  // IGDB credentials (plugin_settings) — required for metadata enrichment.
  const creds = await loadIgdbCredentials();

  // Local state snapshot (item lookup + idempotency) — matches in memory so
  // the per-row work stays inside a single DB transaction.
  const { byExactKey, byExternal, all } = await loadLocalGames();
  // Items created earlier in THIS run, keyed the same way as byExternal, so
  // two CSV rows resolving to the same IGDB id never double-insert.
  const createdExternal = new Map<string, LocalGame>();

  let lookups = new Map<number, IgdbLookup>();
  if (creds) {
    console.log(`Looking up ${rows.length} games in IGDB (sequential, ${IGDB_DELAY_MS}ms apart)…`);
    lookups = await lookupGames(rows, creds);
    console.log('');
  } else {
    console.warn('No IGDB credentials configured (Settings > Media) — all games will be local-only.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      const lookup = lookups.get(row.line);
      const match = lookup?.match ?? null;
      if (match) stats.igdbMatches++;
      if (lookup?.failed) stats.igdbFailed++;

      // Find-or-create the media item.
      const local = matchLocalGame(row.title, byExactKey, all);
      // An existing item that already claims this IGDB id (from the preloaded
      // snapshot or created earlier in this run). Reusing it is what keeps
      // the (external_source, external_id) unique index happy.
      const externalHolder = match
        ? byExternal.get(`igdb:${match.externalId}`) ??
          createdExternal.get(`igdb:${match.externalId}`) ??
          null
        : null;
      let mediaItemId: string;
      // When the IGDB id is already claimed by a DIFFERENT item (in the
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
        // Enrich a local-only item with IGDB data, filling nulls only so
        // manually set values are never clobbered.
        if (match && !local.external_source) {
          await client.query(
            `UPDATE media_items
             SET external_source = 'igdb',
                 external_id = COALESCE(external_id, $2),
                 release_year = COALESCE(release_year, $3),
                 image_url = COALESCE(image_url, $4),
                 external_url = COALESCE(external_url, $5),
                 platform = COALESCE(platform, $6),
                 overview = COALESCE(overview, $7),
                 content_rating = COALESCE(content_rating, $8),
                 players = COALESCE(players, $9),
                 coop = COALESCE(coop, $10),
                 genres = COALESCE(genres, $11),
                 developers = COALESCE(developers, $12),
                 publishers = COALESCE(publishers, $13),
                 updated_at = NOW()
             WHERE id = $1`,
            [
              mediaItemId,
              match.externalId,
              match.releaseYear,
              match.imageUrl,
              match.externalUrl,
              match.platform ?? row.platform,
              match.overview,
              match.contentRating,
              match.players,
              match.coop,
              match.genres,
              match.developers,
              match.publishers,
            ]
          );
          stats.itemsEnriched++;
        }
      } else {
        const ins = await client.query(
          `INSERT INTO media_items
             (user_id, media_type, external_source, external_id, title,
              release_year, image_url, external_url, platform,
              overview, content_rating, players, coop, genres, developers, publishers)
          VALUES ($1, 'game', $2, $3, $4, $5, $6, $7, $8,
                  $9, $10, $11, $12, $13, $14, $15)
          RETURNING id`,
          [
            USER_ID,
            match ? 'igdb' : null,
            match?.externalId ?? null,
            match?.title ?? row.title,
            match?.releaseYear ?? null,
            match?.imageUrl ?? null,
            match?.externalUrl ?? null,
            match?.platform ?? row.platform ?? null,
            match?.overview ?? null,
            match?.contentRating ?? null,
            match?.players ?? null,
            match?.coop ?? null,
            match?.genres ?? null,
            match?.developers ?? null,
            match?.publishers ?? null,
          ]
        );
        mediaItemId = ins.rows[0].id as string;
        stats.itemsCreated++;
        if (match) {
          createdExternal.set(`igdb:${match.externalId}`, {
            id: mediaItemId,
            title: match.title ?? row.title,
            external_source: 'igdb',
            external_id: match.externalId,
            time_played_minutes: null,
          });
        }
      }

      // Write item-level metadata. Time played is a cumulative total that
      // NEVER decreases: stored = max(current stored total, CSV value).
      const currentTotal =
        local?.time_played_minutes != null ? Number(local.time_played_minutes)
        : reuseExternal?.time_played_minutes != null ? Number(reuseExternal.time_played_minutes)
        : null;
      const storedTime =
        row.timePlayedMinutes != null
          ? Math.max(currentTotal ?? 0, row.timePlayedMinutes)
          : null;
      if (storedTime != null && (currentTotal == null || storedTime > currentTotal)) {
        stats.timeRaised++;
      }

      await client.query(
        `UPDATE media_items
         SET rating = $2,
             raw_score = $3,
             notes = $4,
             status = $5,
             time_played_minutes = CASE
               WHEN $6::integer IS NOT NULL THEN GREATEST(COALESCE(time_played_minutes, 0), $6::integer)
               ELSE time_played_minutes
             END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $7`,
        [
          mediaItemId,
          row.rating,
          row.rawScore,
          row.notes,
          row.status,
          storedTime,
          USER_ID,
        ]
      );
      stats.itemsUpdated++;

      // Refresh the in-memory snapshot so a later CSV row for the same
      // item (different title spelling) sees the updated time total.
      const updated: LocalGame = {
        id: mediaItemId,
        title: local?.title ?? reuseExternal?.title ?? (match?.title ?? row.title),
        external_source: match ? 'igdb' : (local?.external_source ?? reuseExternal?.external_source ?? null),
        external_id: match?.externalId ?? local?.external_id ?? reuseExternal?.external_id ?? null,
        time_played_minutes: storedTime ?? currentTotal,
      };
      const key = normalizeTitle(updated.title);
      byExactKey.set(key, updated);
      if (match) {
        byExternal.set(`igdb:${match.externalId}`, updated);
      }

      const src = match
        ? `IGDB ${match.externalId}`
        : lookup?.failed
          ? 'local-only (IGDB failed)'
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
    console.log(`  media items updated:  ${stats.itemsUpdated} (item-level rating/notes/time/status)`);
    console.log(`  media items created:  ${stats.itemsCreated}`);
    console.log(`  media items enriched: ${stats.itemsEnriched}`);
    console.log(`  time totals raised:   ${stats.timeRaised}`);
    console.log(`  IGDB matches:         ${stats.igdbMatches}`);
    console.log(`  IGDB failures:        ${stats.igdbFailed}${stats.igdbFailed ? ' (re-run later to enrich those games)' : ''}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
