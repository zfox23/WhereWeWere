import { Router, Request, Response } from 'express';
import { pool } from '../db';
import {
  parseYamtrackCsv,
  planYamtrackImport,
  countPlans,
  type YamtrackPlanItem,
} from '../services/yamtrack';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Shared execution of the import plan. Upserts media items and inserts
 * check-ins inside a transaction. Idempotent:
 *   - media_items: deduped by (user_id, media_type, external_source, external_id)
 *   - media_checkins: ON CONFLICT (user_id, external_event_id) DO NOTHING
 * Returns per-plan outcomes with the stored ids where applicable.
 */
export async function executeYamtrackImport(plans: YamtrackPlanItem[]): Promise<{
  results: YamtrackPlanItem[];
  imported_checkins: number;
  created_media_items: number;
  duplicates_skipped: number;
}> {
  const client = await pool.connect();
  let importedCheckins = 0;
  let createdMediaItems = 0;
  let duplicatesSkipped = 0;

  const results: YamtrackPlanItem[] = plans.map((p) => ({ ...p }));

  try {
    await client.query('BEGIN');

    for (let i = 0; i < results.length; i++) {
      const plan = results[i];
      const row = plan.row;

      if (plan.disposition === 'skipped' || plan.disposition === 'duplicate') {
        duplicatesSkipped += plan.disposition === 'duplicate' ? 1 : 0;
        continue;
      }

      if (!plan.media_type) continue;

      // Upsert the media item.
      const { id: mediaItemId, created } = await upsertMediaItemWithClient(client, {
        media_type: plan.media_type,
        external_source: plan.external_source,
        external_id: plan.external_id,
        title: row.title,
        author: null,
        release_year: null,
        image_url: row.image || null,
        external_url: plan.external_source === 'tmdb'
          ? plan.media_type === 'movie'
            ? `https://www.themoviedb.org/movie/${plan.external_id}`
            : `https://www.themoviedb.org/tv/${plan.external_id}`
          : plan.external_source === 'tgdb'
            ? `https://www.thegamesdb.net/game/${plan.external_id}`
            : plan.external_source === 'hardcover'
              ? `https://hardcover.app/books/${plan.external_id}`
              : null,
      });
      plan.media_item_id = mediaItemId;
      // Count only genuinely new media_items rows, not upserts of existing ones.
      if (created) createdMediaItems += 1;

      // Insert the check-in if the plan calls for one.
      if ((plan.disposition === 'create_checkin' || plan.disposition === 'create_episode_checkin') && plan.checked_in_at) {
        // Capture the current total *before* inserting so the new row does
        // not mask the prior value in the max computation.
        const totalBefore = plan.time_played_minutes != null
          ? await currentTotalPlayed(client, mediaItemId)
          : null;
        const ins = await client.query(
          `INSERT INTO media_checkins
             (user_id, media_item_id, season_number, episode_number,
              checkin_type, rating, raw_score, notes, checked_in_at, checkin_timezone, external_event_id,
              time_played_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, 'UTC', $10, $11)
           ON CONFLICT (user_id, external_event_id) WHERE external_event_id IS NOT NULL
           DO UPDATE SET
             time_played_minutes = CASE
               WHEN $11 IS NULL THEN media_checkins.time_played_minutes
               WHEN media_checkins.time_played_minutes IS NULL THEN $11
               ELSE GREATEST(media_checkins.time_played_minutes, $11)
             END,
             updated_at = media_checkins.updated_at
           RETURNING id, checked_in_at, (xmax = 0) AS inserted`,
          [
            USER_ID,
            mediaItemId,
            plan.season_number,
            plan.episode_number,
            plan.checkin_type || 'completed',
            plan.rating,
            plan.raw_score,
            row.notes || null,
            plan.checked_in_at,
            plan.external_event_id,
            plan.time_played_minutes,
          ]
        );
        const insertedRow = ins.rows.find((r: any) => r.inserted === true);
        if (insertedRow) {
          plan.imported_checkin_id = insertedRow.id;
          importedCheckins += 1;
        } else if (ins.rowCount && ins.rowCount > 0) {
          // Existed already: refresh the stored id for result links.
          plan.imported_checkin_id = ins.rows[0].id;
        } else {
          plan.imported_checkin_id = null;
          plan.disposition = 'duplicate';
          plan.reason = 'Check-in already exists (same external event id)';
          duplicatesSkipped += 1;
        }

        // Time-played rule: the stored total is the max of the pre-import
        // total and the imported value — times are never summed.
        if (plan.time_played_minutes != null && plan.imported_checkin_id) {
          await applyMaxTimePlayed(client, mediaItemId, plan.time_played_minutes, totalBefore);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { results, imported_checkins: importedCheckins, created_media_items: createdMediaItems, duplicates_skipped: duplicatesSkipped };
}

/** Latest non-null time_played_minutes for a media item (the stored total). */
async function currentTotalPlayed(
  client: import('pg').PoolClient,
  mediaItemId: string
): Promise<number | null> {
  const res = await client.query(
    `SELECT time_played_minutes FROM media_checkins
     WHERE media_item_id = $1 AND time_played_minutes IS NOT NULL
     ORDER BY checked_in_at DESC, id DESC
     LIMIT 1`,
    [mediaItemId]
  );
  return res.rows[0]?.time_played_minutes != null ? Number(res.rows[0].time_played_minutes) : null;
}

/**
 * Apply the "never decrease the total" rule to time played. `currentTotal`
 * must be the total read *before* the imported check-in was inserted.
 * The effective total max(current, imported) is written to the most recent
 * check-in (the row the UI reads as the current total), which is the
 * imported row in both the inserted and conflict cases.
 */
async function applyMaxTimePlayed(
  client: import('pg').PoolClient,
  mediaItemId: string,
  importedMinutes: number,
  currentTotal: number | null
): Promise<void> {
  const effective = Math.max(currentTotal ?? 0, importedMinutes);
  if (effective === (currentTotal ?? 0) && currentTotal != null) return;

  await client.query(
    `WITH ranked AS (
       SELECT id, time_played_minutes,
              ROW_NUMBER() OVER (ORDER BY checked_in_at DESC, id DESC) AS rn
       FROM media_checkins
       WHERE media_item_id = $1
     )
     UPDATE media_checkins mc
     SET time_played_minutes = $2, updated_at = NOW()
     FROM ranked
     WHERE mc.id = ranked.id
       AND ranked.rn = 1
       AND (mc.time_played_minutes IS NULL OR mc.time_played_minutes < $2)`,
    [mediaItemId, effective]
  );
}

/**
 * Find-or-create a media item within the caller's transaction.
 * Mirrors upsertMediaItem but takes an explicit client.
 */
async function upsertMediaItemWithClient(
  client: import('pg').PoolClient,
  input: {
    media_type: string;
    external_source: string | null;
    external_id: string | null;
    title: string;
    author: string | null;
    release_year: number | null;
    image_url: string | null;
    external_url: string | null;
  }
): Promise<{ id: string; created: boolean }> {
  if (input.external_source && input.external_id) {
    const existing = await client.query(
      `SELECT id FROM media_items
       WHERE user_id = $1 AND media_type = $2 AND external_source = $3 AND external_id = $4`,
      [USER_ID, input.media_type, input.external_source, input.external_id]
    );
    if (existing.rows.length > 0) {
      return { id: existing.rows[0].id as string, created: false };
    }
  }

  const inserted = await client.query(
    `INSERT INTO media_items (user_id, media_type, external_source, external_id, title, author, release_year, image_url, external_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, media_type, external_source, external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL
     DO UPDATE SET updated_at = media_items.updated_at
     RETURNING id`,
    [USER_ID, input.media_type, input.external_source, input.external_id, input.title, input.author, input.release_year, input.image_url, input.external_url]
  );
  return { id: inserted.rows[0].id as string, created: true };
}

// POST /preview - parse + classify the CSV without writing anything
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csv.trim()) {
      return res.status(400).json({ error: 'csv (string) is required' });
    }
    let plans: YamtrackPlanItem[];
    try {
      plans = planYamtrackImport(parseYamtrackCsv(csv));
    } catch (err) {
      console.error('Error parsing Yamtrack CSV:', err);
      return res.status(400).json({ error: `Failed to parse CSV: ${err instanceof Error ? err.message : 'unknown error'}` });
    }
    res.json({
      counts: countPlans(plans),
      plans: plans.map((p) => ({
        line: p.row.line,
        media_id: p.row.media_id,
        source: p.row.source,
        media_type: p.row.media_type,
        title: p.row.title,
        season_number: p.row.season_number,
        episode_number: p.row.episode_number,
        status: p.row.status,
        score: p.row.score,
        start_date: p.row.start_date,
        end_date: p.row.end_date,
        checked_in_at: p.checked_in_at,
        disposition: p.disposition,
        reason: p.reason,
        checkin_type: p.checkin_type,
        rating: p.rating,
        raw_score: p.raw_score,
        duplicate_of_line: p.duplicate_of_line,
      })),
    });
  } catch (err) {
    console.error('Error previewing Yamtrack import:', err);
    res.status(500).json({ error: 'Failed to preview Yamtrack import' });
  }
});

// POST /import - parse, classify, and transactionally import the CSV
router.post('/import', async (req: Request, res: Response) => {
  try {
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csv.trim()) {
      return res.status(400).json({ error: 'csv (string) is required' });
    }
    let plans: YamtrackPlanItem[];
    try {
      plans = planYamtrackImport(parseYamtrackCsv(csv));
    } catch (err) {
      console.error('Error parsing Yamtrack CSV:', err);
      return res.status(400).json({ error: `Failed to parse CSV: ${err instanceof Error ? err.message : 'unknown error'}` });
    }

    const outcome = await executeYamtrackImport(plans);
    res.json({
      counts: { ...countPlans(outcome.results), imported_checkins: outcome.imported_checkins, duplicates_skipped: outcome.duplicates_skipped },
      plans: outcome.results.map((p) => ({
        line: p.row.line,
        media_id: p.row.media_id,
        source: p.row.source,
        media_type: p.row.media_type,
        title: p.row.title,
        season_number: p.row.season_number,
        episode_number: p.row.episode_number,
        status: p.row.status,
        score: p.row.score,
        start_date: p.row.start_date,
        end_date: p.row.end_date,
        checked_in_at: p.checked_in_at,
        disposition: p.disposition,
        reason: p.reason,
        checkin_type: p.checkin_type,
        rating: p.rating,
        raw_score: p.raw_score,
        time_played_minutes: p.time_played_minutes,
        duplicate_of_line: p.duplicate_of_line,
        media_item_id: p.media_item_id,
        imported_checkin_id: p.imported_checkin_id,
      })),
    });
  } catch (err) {
    console.error('Error importing Yamtrack data:', err);
    res.status(500).json({ error: 'Failed to import Yamtrack data' });
  }
});

export const importYamtrackRouter = router;
