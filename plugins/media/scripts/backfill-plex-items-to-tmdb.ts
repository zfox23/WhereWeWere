// ============================================================================
// One-off backfill: re-key local-only movie/tv_show media_items rows (created
// by the Plex webhook before it resolved TMDB ids) to TMDB.
//
//   - Each local-only (external_source IS NULL) movie/show is resolved by
//     exact normalized-title TMDB search ("Bluey (2018)" => "Bluey" + year).
//   - No exact match => left untouched and reported for manual review.
//   - API failure/null => left untouched; re-run later.
//   - If another row already owns the TMDB id, the local row is merged into
//     it (check-ins, cached episodes and list membership move; the local row
//     is deleted). Otherwise the row is re-keyed and its poster/year/url
//     filled (COALESCE: existing values are never clobbered).
//
// Idempotent. Take a backup before the first real run.
//
// Usage (from server/), naming the account whose items to re-key:
//   npm run backfill:plex-items-to-tmdb -- --user zach --dry-run   # plan only
//   npm run backfill:plex-items-to-tmdb -- --user zach             # apply
// ============================================================================

import { pool } from '../../../server/src/db';
import { tmdb } from '../services/tmdb';
import { normalizeTitle } from '../services/titleMatch';
import { resolvePlexShow, splitTitleYear, type ResolvedTmdbItem } from '../services/plexResolve';
import { currentUserId, runAsUser } from '../../../server/src/auth/context';
import { requireScriptUser } from '../../../server/src/scripts/scriptUser';

interface Row {
  id: string;
  media_type: 'movie' | 'tv_show';
  title: string;
}

async function loadTmdbKey(): Promise<string | null> {
  const res = await pool.query(
    `SELECT value FROM plugin_settings WHERE user_id = $1 AND plugin_id = 'media' AND key = 'tmdb_api_key'`,
    [currentUserId()]
  );
  const v = res.rows[0]?.value;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

async function resolveMovie(apiKey: string, title: string): Promise<ResolvedTmdbItem | null | 'failed'> {
  const results = await tmdb.searchMovies(apiKey, title);
  if (!results) return 'failed';
  const key = normalizeTitle(title);
  return results.find((r) => normalizeTitle(r.title) === key) ?? null;
}

async function mergeChildRows(client: import('pg').PoolClient, toId: string, awayId: string): Promise<void> {
  await client.query(`UPDATE media_checkins SET media_item_id = $1 WHERE media_item_id = $2`, [toId, awayId]);
  await client.query(
    `DELETE FROM media_tv_episodes e USING media_tv_episodes kept
     WHERE e.media_item_id = $2 AND kept.media_item_id = $1
       AND kept.season_number = e.season_number AND kept.episode_number = e.episode_number`,
    [toId, awayId]
  );
  await client.query(`UPDATE media_tv_episodes SET media_item_id = $1 WHERE media_item_id = $2`, [toId, awayId]);
  await client.query(
    `DELETE FROM media_list_items l USING media_list_items kept
     WHERE l.media_item_id = $2 AND kept.media_item_id = $1 AND kept.list_id = l.list_id`,
    [toId, awayId]
  );
  await client.query(`UPDATE media_list_items SET media_item_id = $1 WHERE media_item_id = $2`, [toId, awayId]);
}

const USAGE = 'Usage: npm run backfill:plex-items-to-tmdb -- --user <username> [--dry-run]';

async function main() {
  const { user, rest } = await requireScriptUser(process.argv.slice(2), USAGE);
  console.log(`Re-keying Plex items for user ${user.username}.`);
  await runAsUser(user.id, () => run(rest.includes('--dry-run')));
}

async function run(dryRun: boolean) {
  const apiKey = await loadTmdbKey();
  if (!apiKey) {
    console.error('No TMDB API key configured (Settings > Media).');
    await pool.end();
    process.exit(1);
  }

  const rows = (await pool.query<Row>(
    `SELECT id, media_type, title FROM media_items
     WHERE user_id = $1 AND media_type IN ('movie', 'tv_show') AND external_source IS NULL
     ORDER BY created_at, id`,
    [currentUserId()]
  )).rows;
  console.log(`Loaded ${rows.length} local-only movie/show rows.${dryRun ? ' (dry run)' : ''}`);

  const counts = { rekeyed: 0, merged: 0, unresolved: 0, failed: 0 };
  for (const row of rows) {
    const { title } = splitTitleYear(row.title);
    const found = row.media_type === 'movie'
      ? await resolveMovie(apiKey, title)
      : await resolvePlexShow(apiKey, { tmdb: null, tvdb: null, imdb: null }, row.title);
    if (found === 'failed') { counts.failed++; console.log(`  ? ${row.title}: TMDB lookup failed, left untouched`); continue; }
    if (!found) { counts.unresolved++; console.log(`  - ${row.title}: no exact TMDB match, left for manual review`); continue; }

    const owner = (await pool.query(
      `SELECT id FROM media_items WHERE user_id = $1 AND media_type = $2 AND external_source = 'tmdb' AND external_id = $3`,
      [currentUserId(), row.media_type, found.externalId]
    )).rows[0]?.id as string | undefined;

    if (owner) {
      counts.merged++;
      console.log(`  M ${row.title} -> merge into existing TMDB ${found.externalId} (${found.title})`);
    } else {
      counts.rekeyed++;
      console.log(`  R ${row.title} -> TMDB ${found.externalId} (${found.title}, ${found.releaseYear ?? '?'}, poster: ${found.imageUrl ? 'yes' : 'no'})`);
    }
    if (dryRun) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (owner) {
        await mergeChildRows(client, owner, row.id);
        await client.query(
          `UPDATE media_items SET release_year = COALESCE(release_year, $2), image_url = COALESCE(image_url, $3),
             external_url = COALESCE(external_url, $4), updated_at = NOW() WHERE id = $1 AND user_id = $5`,
          [owner, found.releaseYear, found.imageUrl, found.externalUrl, currentUserId()]
        );
        await client.query('DELETE FROM media_items WHERE id = $1 AND user_id = $2', [row.id, currentUserId()]);
      } else {
        await client.query(
          `UPDATE media_items SET external_source = 'tmdb', external_id = $2, title = $3,
             release_year = COALESCE(release_year, $4), image_url = COALESCE(image_url, $5),
             external_url = $6, updated_at = NOW() WHERE id = $1 AND user_id = $7`,
          [row.id, found.externalId, found.title, found.releaseYear, found.imageUrl, found.externalUrl, currentUserId()]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ! ${row.title}: rolled back`, err);
    } finally {
      client.release();
    }
  }

  console.log(`\nRe-keyed: ${counts.rekeyed}  merged: ${counts.merged}  unresolved: ${counts.unresolved}  api-failed: ${counts.failed}`);
  await pool.end();
}

main().catch(async (err) => { console.error(err); await pool.end(); process.exit(1); });
