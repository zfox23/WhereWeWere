// ============================================================================
// One-off backfill: re-key game media_items rows to IGDB ids by title.
//
// IGDB is now the primary game metadata provider (Settings > Media). Rows
// currently keyed to TGDB (or still local-only) can be moved over here:
//
//   - Rows already external_source='igdb' are skipped.
//   - Every other game row is resolved by title via IGDB search, narrowed to
//     strict same-game title matches, then one candidate is picked with the
//     same preference as the on-demand re-key: the row's stored platform,
//     else the personal console history (PC, PS5, PS4, PS3, PS2, PS1, GBC),
//     else the first candidate arbitrarily.
//   - No strict title match => left untouched and reported for manual review.
//   - API failure/null => left untouched (a failure is NOT evidence of a
//     wrong ID); after 3 consecutive failures the run stops looking things
//     up and the rest are left for a re-run.
//   - Adopting an IGDB id already owned by another row: merge (move
//     check-ins, cached episodes, and list membership to the survivor; delete
//     the stale row) so the partial unique index on (user, type, source, id)
//     is never violated.
//
// Idempotent: a second run finds every row already igdb-sourced and changes
// nothing.
//
// A backup is recommended before the first real run (Settings page has a full
// backup export, or use pg_dump on the database).
//
// Usage (from server/):
//   npm run backfill:games-to-igdb -- --dry-run   # plan only, no writes
//   npm run backfill:games-to-igdb                # apply
// ============================================================================

import { pool } from '../../../server/src/db';
import { igdb, pickIgdbCandidate, type IgdbGameResult } from '../services/igdb';
import { DEFAULT_USER_ID as USER_ID } from '../../../server/src/constants';

/** Delay between consecutive IGDB API calls (limit: 4 req/s). */
const IGDB_DELAY_MS = 300;
/** Abort further IGDB calls after this many consecutive failures. */
const IGDB_MAX_CONSECUTIVE_FAILURES = 3;

interface GameRow {
  id: string;
  title: string;
  external_source: string | null;
  external_id: string | null;
  platform: string | null;
}

type Verdict = 'skipped' | 'rekeyed' | 'enriched' | 'merged' | 'unresolvable' | 'api-failed';

interface RowOutcome {
  row: GameRow;
  verdict: Verdict;
  adopted?: IgdbGameResult;
}

// ============================================================================
// DB helpers
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

async function loadGameRows(): Promise<GameRow[]> {
  const res = await pool.query<GameRow>(
    `SELECT id, title, external_source, external_id, platform
     FROM media_items WHERE user_id = $1 AND media_type = 'game'
       AND (external_source IS DISTINCT FROM 'igdb' OR external_id IS NULL)
     ORDER BY created_at, id`,
    [USER_ID]
  );
  return res.rows;
}

/**
 * Move all child rows (check-ins, cached episodes, list membership) from
 * `awayId` to `toId` inside the caller's transaction.
 */
async function mergeChildRows(client: import('pg').PoolClient, toId: string, awayId: string): Promise<void> {
  await client.query(
    `UPDATE media_checkins SET media_item_id = $1 WHERE media_item_id = $2`,
    [toId, awayId]
  );
  await client.query(
    `DELETE FROM media_tv_episodes e USING media_tv_episodes kept
     WHERE e.media_item_id = $2 AND kept.media_item_id = $1
       AND kept.season_number = e.season_number AND kept.episode_number = e.episode_number`,
    [toId, awayId]
  );
  await client.query(
    `UPDATE media_tv_episodes SET media_item_id = $1 WHERE media_item_id = $2`,
    [toId, awayId]
  );
  await client.query(
    `DELETE FROM media_list_items l USING media_list_items kept
     WHERE l.media_item_id = $2 AND kept.media_item_id = $1 AND kept.list_id = l.list_id`,
    [toId, awayId]
  );
  await client.query(
    `UPDATE media_list_items SET media_item_id = $1 WHERE media_item_id = $2`,
    [toId, awayId]
  );
}

/**
 * Write the re-key (+ metadata COALESCE-fill) for a row, deleting the merged
 * stale row when `mergeAwayRowId` is set. Runs inside the caller's
 * transaction.
 */
async function applyRekey(
  client: import('pg').PoolClient,
  row: GameRow,
  adopted: IgdbGameResult,
  mergeAwayRowId: string | null
): Promise<void> {
  if (mergeAwayRowId) {
    await mergeChildRows(client, row.id, mergeAwayRowId);
    await client.query('DELETE FROM media_items WHERE id = $1', [mergeAwayRowId]);
  }
  // Rows re-keyed from TGDB carry provider-derived values from the wrong
  // source, but we cannot know which were ever user-edited; the same
  // COALESCE(overview, …) shape as the on-demand re-key fills only what is
  // missing, and identity columns are always replaced.
  await client.query(
    `UPDATE media_items
     SET external_source = 'igdb',
         external_id = $2,
         external_url = $3,
         release_year = COALESCE($4, release_year),
         image_url = COALESCE(image_url, $5),
         platform = COALESCE($6, platform),
         overview = COALESCE(overview, $7),
         content_rating = COALESCE(content_rating, $8),
         players = COALESCE(players, $9),
         coop = COALESCE(coop, $10),
         genres = COALESCE(genres, $11),
         developers = COALESCE(developers, $12),
         publishers = COALESCE(publishers, $13),
         updated_at = NOW()
     WHERE id = $1`,
    [row.id, adopted.externalId, adopted.externalUrl, adopted.releaseYear, adopted.imageUrl,
     adopted.platform, adopted.overview, adopted.contentRating, adopted.players, adopted.coop,
     adopted.genres, adopted.developers, adopted.publishers]
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const creds = await loadIgdbCredentials();
  if (!creds) {
    console.error('No IGDB credentials configured. Set the Twitch Client ID / Client Secret in Settings > Media first.');
    await pool.end();
    process.exit(1);
  }

  const rows = await loadGameRows();
  console.log(`Loaded ${rows.length} game media_items rows to re-key to IGDB.`);
  if (rows.length === 0) {
    console.log('Nothing to do — every game is already IGDB-sourced.');
    await pool.end();
    return;
  }

  // In-memory registry of IGDB ids owned by a row (kept in sync as we
  // re-key) so two rows in the same run can never adopt the same id.
  const ownedIds = new Map<string, string>(); // igdb id -> local row id
  for (const r of rows) {
    if (r.external_source === 'igdb' && r.external_id) ownedIds.set(r.external_id, r.id);
  }

  const outcomes: RowOutcome[] = [];
  let consecutiveFailures = 0;
  let aborted = false;

  for (const row of rows) {
    if (aborted) {
      outcomes.push({ row, verdict: 'api-failed' });
      continue;
    }

    const candidates = await igdb.searchCandidates(creds.clientId, creds.clientSecret, row.title);
    if (!candidates) {
      consecutiveFailures++;
      if (consecutiveFailures >= IGDB_MAX_CONSECUTIVE_FAILURES) {
        console.warn(`  ! ${consecutiveFailures} consecutive IGDB failures — stopping lookups; remaining rows left untouched (re-run later).`);
        aborted = true;
      }
      outcomes.push({ row, verdict: 'api-failed' });
      continue;
    }
    consecutiveFailures = 0;

    if (candidates.length === 0) {
      outcomes.push({ row, verdict: 'unresolvable' });
      continue;
    }

    const pick = pickIgdbCandidate({ title: row.title, platform: row.platform }, candidates);
    if (!pick) {
      outcomes.push({ row, verdict: 'unresolvable' });
      continue;
    }

    // Another row already owns this IGDB id => merge into it (the survivor is
    // the earlier-created row, matching the TGDB backfill semantics).
    const owner = ownedIds.get(pick.result.externalId);
    if (owner != null && owner !== row.id) {
      outcomes.push({ row, verdict: 'merged', adopted: pick.result });
    } else {
      outcomes.push({ row, verdict: row.external_id ? 'rekeyed' : 'enriched', adopted: pick.result });
      ownedIds.set(pick.result.externalId, row.id);
    }

    if (!dryRun) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const outcome = outcomes[outcomes.length - 1];
        if (outcome.verdict === 'merged') {
          const survivorId = ownedIds.get(outcome.adopted!.externalId)!;
          await mergeChildRows(client, survivorId, row.id);
          await client.query('DELETE FROM media_items WHERE id = $1', [row.id]);
        } else {
          await applyRekey(client, row, outcome.adopted!, null);
          if (row.external_id) ownedIds.delete(row.external_id);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ! Failed to apply change for "${row.title}" (${row.id}): ${err instanceof Error ? err.message : err}`);
      } finally {
        client.release();
      }
    }

    await sleep(IGDB_DELAY_MS);
  }

  // Report
  const count = (v: Verdict) => outcomes.filter((o) => o.verdict === v).length;
  console.log('');
  console.log(`=== ${dryRun ? 'DRY RUN' : 'BACKFILL'} TO IGDB COMPLETE ===`);
  console.log(`  rows processed:   ${outcomes.length}`);
  console.log(`  re-keyed:         ${count('rekeyed')}`);
  console.log(`  enriched (new):   ${count('enriched')}`);
  console.log(`  merged:           ${count('merged')}`);
  console.log(`  unresolvable:     ${count('unresolvable')}`);
  console.log(`  api-failed:       ${count('api-failed')}${count('api-failed') ? ' (re-run later)' : ''}`);

  const unresolvable = outcomes.filter((o) => o.verdict === 'unresolvable');
  if (unresolvable.length > 0) {
    console.log('');
    console.log('Unresolvable rows (left untouched — review manually):');
    for (const o of unresolvable) {
      console.log(`  - "${o.row.title}" (id ${o.row.id})${o.row.external_id ? ` [current external_id: ${o.row.external_id}]` : ''}`);
    }
  }

  if (dryRun) {
    console.log('');
    console.log('Dry run: nothing was written. Re-run without --dry-run to apply.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Games-to-IGDB backfill failed:', err);
  process.exit(1);
});
