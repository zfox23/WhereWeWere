// ============================================================================
// One-off backfill: verify and re-key external_id on game media_items rows.
//
// Background: Yamtrack stores games keyed by IGDB id, and an older version of
// the importer stored that id under external_source='tgdb'. TGDB ids and IGDB
// ids are unrelated, so those rows link to the wrong TGDB page and corrupt
// metadata sync. This script re-keys them (and verifies the correctly-keyed
// games-CSV rows too) against TGDB by title.
//
// Per game media_items row:
//   - Has external_id: verify via TGDB ByGameID. Title exact/edition match
//     (same strict rules as the games-CSV importer) => keep. Mismatch =>
//     re-resolve by name search.
//   - No external_id: resolve by name search.
//   - API failure/null => leave the row untouched (a failure is NOT evidence
//     of a wrong ID) and count it.
//   - No strict title match found => leave untouched and report it for manual
//     review. Never guess.
//   - Adopting an id already owned by another row: merge (move check-ins,
//     cached episodes, and list membership to the survivor; delete the stale
//     row), so the partial unique index on (user, type, source, id) is never
//     violated.
//
// Idempotent: a second run finds every row verified and changes nothing.
//
// A backup is recommended before the first real run (Settings page has a full
// backup export, or use pg_dump on the database).
//
// Usage (from server/):
//   npm run backfill:games-external-ids -- --dry-run   # plan only, no writes
//   npm run backfill:games-external-ids                # apply
// ============================================================================

import { pool } from './index';
import { tgdb, type TgdbGameResult } from '../services/tgdb';
import {
  isVerifiedMatch,
  pickStrictTgdbMatch,
  planGameRow,
  tgdbExternalUrl,
  type GameRowPlan,
} from '../services/gamesRekey';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const TGDB_API_LIMIT_URL = 'https://api.thegamesdb.net/v1/API/Limit';
/** Delay between consecutive TGDB API calls. */
const TGDB_DELAY_MS = 500;
/** Abort further TGDB calls after this many consecutive failures. */
const TGDB_MAX_CONSECUTIVE_FAILURES = 3;

interface GameRow {
  id: string;
  title: string;
  external_id: string | null;
  release_year: number | null;
  image_url: string | null;
  external_url: string | null;
  platform: string | null;
}

interface RowPlan extends GameRowPlan {
  row: GameRow;
}

// ============================================================================
// DB + API execution
// ============================================================================

async function loadGameRows(): Promise<GameRow[]> {
  const res = await pool.query<GameRow>(
    `SELECT id, title, external_id, release_year, image_url, external_url, platform
     FROM media_items WHERE user_id = $1 AND media_type = 'game'
     ORDER BY created_at, id`,
    [USER_ID]
  );
  return res.rows;
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Apply a plan to the database inside the caller's transaction.
 * The re-key and the (optional) stale-row deletion happen atomically so the
 * partial unique index is never exposed to a duplicate.
 */
async function applyPlan(
  client: import('pg').PoolClient,
  plan: RowPlan,
  resolved: TgdbGameResult
): Promise<void> {
  const { row } = plan;
  const newId = plan.targetId!;

  if (plan.verdict === 'merged') {
    await mergeChildRows(client, row.id, plan.mergeAwayRowId!);
    await client.query('DELETE FROM media_items WHERE id = $1', [plan.mergeAwayRowId!]);
  }

  // Re-keyed/merged rows had their id (and any derived metadata) sourced from
  // the wrong provider, so TGDB values replace them. Enriched (previously
  // local-only) rows keep their existing values where TGDB has none. The
  // stored image (e.g. from the Yamtrack export) is kept when present — it is
  // not provider-derived.
  await client.query(
    `UPDATE media_items
     SET external_source = 'tgdb',
         external_id = $2,
         external_url = $3,
         release_year = COALESCE($4, release_year),
         image_url = COALESCE(image_url, $5),
         platform = COALESCE($6, platform),
         updated_at = NOW()
     WHERE id = $1`,
    [row.id, newId, tgdbExternalUrl(newId), resolved.releaseYear, resolved.imageUrl, resolved.platform]
  );
}

interface Stats {
  total: number;
  verified: number;
  rekeyed: number;
  enriched: number;
  merged: number;
  unresolvable: number;
  apiFailed: number;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const keyRes = await pool.query(
    'SELECT tgdb_api_key FROM user_settings WHERE user_id = $1',
    [USER_ID]
  );
  const apiKey: string | null = keyRes.rows[0]?.tgdb_api_key || null;
  if (!apiKey) {
    console.error('No tgdb_api_key configured. Set it in Settings (Integrations) first.');
    process.exit(1);
  }

  const rows = await loadGameRows();
  console.log(`Loaded ${rows.length} game media_items rows.`);
  if (rows.length === 0) {
    await pool.end();
    return;
  }

  const allowance = await fetchRemainingAllowance(apiKey);
  if (allowance != null) {
    console.log(`TGDB remaining monthly allowance: ${allowance}`);
    if (allowance < rows.length) {
      console.warn('Allowance may run out mid-run; remaining rows will be left untouched (re-run later).');
    }
  }

  const plans: RowPlan[] = [];
  const resolvedCache = new Map<string, TgdbGameResult>(); // row id -> adopted record
  const stats: Stats = {
    total: rows.length, verified: 0, rekeyed: 0, enriched: 0,
    merged: 0, unresolvable: 0, apiFailed: 0,
  };

  // In-memory registry of ids already owned by a row (kept in sync as we
  // re-key) so two rows in the same run can never adopt the same TGDB id.
  const ownedIds = new Map<string, string>(); // tgdb id -> local row id
  for (const r of rows) {
    if (r.external_id) ownedIds.set(r.external_id, r.id);
  }

  let consecutiveFailures = 0;
  let aborted = false;

  for (const row of rows) {
    let verifySucceeded = false;
    let fetched: TgdbGameResult | null = null;
    let resolveSucceeded = false;
    let resolved: TgdbGameResult | null = null;

    if (aborted) {
      plans.push({ row, verdict: 'api-failed', reason: 'Aborted after repeated TGDB failures', targetId: null, mergeAwayRowId: null });
      stats.apiFailed++;
      continue;
    }

    // 1. Verify the stored id, if any.
    if (row.external_id) {
      fetched = await tgdb.getGameDetails(apiKey, row.external_id);
      if (fetched) {
        verifySucceeded = true;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= TGDB_MAX_CONSECUTIVE_FAILURES) {
          console.warn(`  ! ${consecutiveFailures} consecutive TGDB failures — stopping lookups; remaining rows left untouched (re-run later).`);
          aborted = true;
        }
      }
    }

    // 2. Re-resolve by title when the row has no id, or when the stored id
    //    verified successfully but does not match the stored title. A verify
    //    FAILURE alone is NOT grounds to re-key: the row is left untouched
    //    (api-failed, re-run later).
    const mismatch = verifySucceeded && fetched != null && !isVerifiedMatch(row.title, fetched.title);
    const needsResolve = !row.external_id || mismatch;
    let planForRow: Omit<RowPlan, 'row'>;
    if (needsResolve) {
      const found = await tgdb.searchGames(apiKey, row.title);
      resolveSucceeded = found != null;
      if (!found) {
        consecutiveFailures++;
        if (consecutiveFailures >= TGDB_MAX_CONSECUTIVE_FAILURES) {
          console.warn(`  ! ${consecutiveFailures} consecutive TGDB failures — stopping lookups; remaining rows left untouched (re-run later).`);
          aborted = true;
        }
      } else {
        consecutiveFailures = 0;
        resolved = pickStrictTgdbMatch(found, row.title);
      }
    }

    planForRow = planGameRow(row, {
      verifySucceeded: row.external_id ? verifySucceeded : true,
      fetched,
      resolved,
      resolveSucceeded,
      ownerOfId: (id) => ownedIds.get(id) ?? null,
    });

    // The ownerOfId check inside planGameRow runs before this row's own id is
    // registered as owned; exclude self (a row can never own its own id twice).
    if (planForRow.mergeAwayRowId === row.id) {
      planForRow = { ...planForRow, verdict: planForRow.targetId ? 'rekeyed' : 'enriched', mergeAwayRowId: null };
    }

    plans.push({ ...planForRow, row });
    const verdict = planForRow.verdict;
    if (verdict === 'verified') stats.verified++;
    else if (verdict === 'rekeyed') stats.rekeyed++;
    else if (verdict === 'enriched') stats.enriched++;
    else if (verdict === 'merged') stats.merged++;
    else if (verdict === 'unresolvable') stats.unresolvable++;
    else stats.apiFailed++;

    if ((verdict === 'rekeyed' || verdict === 'enriched' || verdict === 'merged') && resolved) {
      resolvedCache.set(row.id, resolved);
      // Reserve the id in-memory even in dry-run so a later row in the same
      // run is planned to merge rather than collide.
      ownedIds.set(resolved.externalId, row.id);
    }

    if (!dryRun && (verdict === 'rekeyed' || verdict === 'enriched' || verdict === 'merged') && resolved) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await applyPlan(client, { ...planForRow, row }, resolved);
        await client.query('COMMIT');
        // Release ids that no longer exist in the DB after this write so a
        // later row resolving to them is not planned to merge into a row that
        // no longer owns them.
        if (verdict === 'rekeyed' && row.external_id) ownedIds.delete(row.external_id);
        if (verdict === 'merged') {
          const away = rows.find((r) => r.id === planForRow.mergeAwayRowId);
          if (away?.external_id) ownedIds.delete(away.external_id);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ! Failed to apply change for "${row.title}" (${row.id}): ${err instanceof Error ? err.message : err}`);
      } finally {
        client.release();
      }
    }

    if (!aborted) await sleep(TGDB_DELAY_MS);
  }

  // Report
  console.log('');
  console.log(`=== ${dryRun ? 'DRY RUN' : 'BACKFILL'} COMPLETE ===`);
  console.log(`  rows processed:   ${stats.total}`);
  console.log(`  verified ok:      ${stats.verified}`);
  console.log(`  re-keyed:         ${stats.rekeyed}`);
  console.log(`  enriched (new):   ${stats.enriched}`);
  console.log(`  merged:           ${stats.merged}`);
  console.log(`  unresolvable:     ${stats.unresolvable}`);
  console.log(`  api-failed:       ${stats.apiFailed}${stats.apiFailed ? ' (re-run later)' : ''}`);

  const unresolvable = plans.filter((p) => p.verdict === 'unresolvable');
  if (unresolvable.length > 0) {
    console.log('');
    console.log('Unresolvable rows (left untouched — review manually):');
    for (const p of unresolvable) {
      console.log(`  - "${p.row.title}" (id ${p.row.id})${p.row.external_id ? ` [wrong external_id: ${p.row.external_id}]` : ''}`);
    }
  }
  const failed = plans.filter((p) => p.verdict === 'api-failed');
  if (failed.length > 0) {
    console.log('');
    console.log(`API-failed rows (${failed.length}) — left untouched, re-run later.`);
  }

  if (dryRun) {
    console.log('');
    console.log('Dry run: nothing was written. Re-run without --dry-run to apply.');
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Games external-id backfill failed:', err);
  process.exit(1);
});
