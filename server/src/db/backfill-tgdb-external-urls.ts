// ============================================================================
// One-off backfill: rewrite media_items.external_url for TGDB-sourced games
// from the old format ("https://www.thegamesdb.net/game/<id>") to the correct
// format ("https://thegamesdb.net/game.php?id=<id>"), rebuilding it from the
// stored external_id.
//
// Only rows whose external_url is NULL or matches the old "/game/<id>" path
// shape (with or without the www subdomain) are touched, so any manually set
// URL is left alone. Safe to re-run (idempotent).
//
// Usage (from server/):
//   npm run backfill:tgdb-external-urls
// ============================================================================

import { pool } from './index';

async function backfillTgdbExternalUrls() {
  const affected = await pool.query(
    `SELECT COUNT(*) AS n FROM media_items
     WHERE external_source = 'tgdb'
       AND external_id IS NOT NULL
       AND (external_url IS NULL
            OR external_url ~ '^https://(www\\.)?thegamesdb\\.net/game/[0-9]+/?$')`
  );
  const count = Number(affected.rows[0].n);

  if (count === 0) {
    console.log('No TGDB game items need their external_url fixed.');
    return;
  }

  const result = await pool.query(
    `UPDATE media_items
     SET external_url = 'https://thegamesdb.net/game.php?id=' || external_id,
         updated_at = NOW()
     WHERE external_source = 'tgdb'
       AND external_id IS NOT NULL
       AND (external_url IS NULL
            OR external_url ~ '^https://(www\\.)?thegamesdb\\.net/game/[0-9]+/?$')`
  );

  console.log(`Fixed external_url on ${result.rowCount ?? 0} TGDB game items.`);
}

backfillTgdbExternalUrls()
  .catch((err) => {
    console.error('TGDB external_url backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
