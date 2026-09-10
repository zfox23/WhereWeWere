import { Router, Request, Response } from 'express';
import { query, pool } from '../db';
import { tmdb } from '../services/tmdb';
import { tgdb } from '../services/tgdb';
import { hardcover } from '../services/hardcover';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

const MEDIA_TYPES = new Set(['movie', 'tv_show', 'game', 'book', 'board_game']);
const CHECKIN_TYPES = new Set(['completed', 'in_progress', 'dropped']);
const EPISODE_CACHE_MAX_AGE_DAYS = 30;

interface SettingsKeys {
  tmdb_api_key: string | null;
  tgdb_api_key: string | null;
  hardcover_api_key: string | null;
}

async function getApiKeys(): Promise<SettingsKeys> {
  const result = await query(
    `SELECT tmdb_api_key, tgdb_api_key, hardcover_api_key FROM user_settings WHERE user_id = $1`,
    [USER_ID]
  );
  return {
    tmdb_api_key: result.rows[0]?.tmdb_api_key || null,
    tgdb_api_key: result.rows[0]?.tgdb_api_key || null,
    hardcover_api_key: result.rows[0]?.hardcover_api_key || null,
  };
}

function toIntOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

export interface MediaItemInput {
  media_type: string;
  external_source?: string | null;
  external_id?: string | null;
  title: string;
  author?: string | null;
  release_year?: number | null;
  image_url?: string | null;
  external_url?: string | null;
  platform?: string | null;
  /** Book: page count of the default physical edition. */
  page_count?: number | null;
  /** Book: series name, if applicable. */
  series_name?: string | null;
  /** Book: this book's position within its series. */
  series_position?: number | null;
  /** Book: total number of books in its series. */
  series_count?: number | null;
}

/**
 * Find-or-create a media item. API-sourced items are deduped via the
 * partial unique index on (user_id, media_type, external_source, external_id).
 */
export async function upsertMediaItem(input: MediaItemInput): Promise<string> {
  if (!MEDIA_TYPES.has(input.media_type)) {
    throw new Error(`Invalid media_type: ${input.media_type}`);
  }

  if (input.external_source && input.external_id) {
    const existing = await query(
      `SELECT id FROM media_items
       WHERE user_id = $1 AND media_type = $2 AND external_source = $3 AND external_id = $4`,
      [USER_ID, input.media_type, input.external_source, input.external_id]
    );
    if (existing.rows.length > 0) {
      // Refresh mutable metadata in case the API returned newer info.
      // Page count/series columns backfill from null but never clobber existing values.
      await query(
        `UPDATE media_items
         SET title = $2,
             author = COALESCE($3, author),
             release_year = COALESCE($4, release_year),
             image_url = COALESCE($5, image_url),
             external_url = COALESCE($6, external_url),
             platform = COALESCE($7, platform),
             page_count = COALESCE($8, page_count),
             series_name = COALESCE($9, series_name),
             series_position = COALESCE($10, series_position),
             series_count = COALESCE($11, series_count),
             updated_at = NOW()
         WHERE id = $1`,
        [existing.rows[0].id, input.title, input.author || null, input.release_year || null, input.image_url || null, input.external_url || null, input.platform || null, input.page_count ?? null, input.series_name || null, input.series_position ?? null, input.series_count ?? null]
      );
      return existing.rows[0].id as string;
    }
  }

  const inserted = await query(
    `INSERT INTO media_items (user_id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform, page_count, series_name, series_position, series_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (user_id, media_type, external_source, external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL
     DO UPDATE SET updated_at = media_items.updated_at
     RETURNING id`,
    [USER_ID, input.media_type, input.external_source || null, input.external_id || null, input.title, input.author || null, input.release_year || null, input.image_url || null, input.external_url || null, input.platform || null, input.page_count ?? null, input.series_name || null, input.series_position ?? null, input.series_count ?? null]
  );
  return inserted.rows[0].id as string;
}

interface SearchHit {
  source: 'local' | string;
  external_source: string | null;
  external_id: string | null;
  title: string;
  author: string | null;
  release_year: number | null;
  image_url: string | null;
  external_url: string | null;
  platform: string | null;
  page_count: number | null;
  series_name: string | null;
  series_position: number | null;
  series_count: number | null;
  local_id: string | null;
  last_checkin_at: string | null;
  last_checkin_type: string | null;
  my_rating: number | null;
}

/**
 * Backfill page count / series info on existing local hardcover rows when the
 * fresh external results carry values the local row is missing.
 */
async function backfillBookMetadata(
  localRows: { id: string; external_id: string | null; page_count: number | null; series_name: string | null; series_position: number | null; series_count: number | null }[],
  fresh: { externalId: string; pageCount: number | null; seriesName: string | null; seriesPosition: number | null; seriesCount: number | null }[]
): Promise<void> {
  const byExternalId = new Map(localRows.map((r) => [r.external_id as string, r]));
  for (const row of fresh) {
    const local = byExternalId.get(row.externalId);
    if (!local) continue;
    const page_count = local.page_count != null ? null : row.pageCount;
    const series_name = local.series_name != null ? null : row.seriesName;
    const series_position = local.series_position != null ? null : row.seriesPosition;
    const series_count = local.series_count != null ? null : row.seriesCount;
    if (page_count == null && series_name == null && series_position == null && series_count == null) continue;
    await query(
      `UPDATE media_items
       SET page_count = COALESCE($2, page_count),
           series_name = COALESCE($3, series_name),
           series_position = COALESCE($4, series_position),
           series_count = COALESCE($5, series_count),
           updated_at = NOW()
       WHERE id = $1`,
      [local.id, page_count, series_name, series_position, series_count]
    );
  }
}

/**
 * Merge local media_items with (possibly cached) external API search results.
 * Local rows are always present; external rows already known locally are not
 * duplicated. A `degraded` flag is set when an external API is unavailable.
 */
async function searchMedia(type: string, q: string): Promise<{ results: SearchHit[]; degraded: boolean }> {
  const keys = await getApiKeys();
  const localRows = await query(
    `SELECT mi.id, mi.title, mi.author, mi.release_year, mi.image_url, mi.external_url,
            mi.external_source, mi.external_id, mi.platform,
            mi.page_count, mi.series_name, mi.series_position, mi.series_count,
            mc_latest.last_checkin_at, mc_latest.last_checkin_type, mc_latest.my_rating
     FROM media_items mi
     LEFT JOIN LATERAL (
       SELECT MAX(mc.checked_in_at) AS last_checkin_at,
              (ARRAY_AGG(mc.checkin_type ORDER BY mc.checked_in_at DESC))[1] AS last_checkin_type,
              (ARRAY_AGG(mc.rating ORDER BY mc.checked_in_at DESC) FILTER (WHERE mc.rating IS NOT NULL))[1] AS my_rating
       FROM media_checkins mc
       WHERE mc.media_item_id = mi.id
     ) mc_latest ON true
     WHERE mi.user_id = $1 AND mi.media_type = $2
       AND (mi.title ILIKE '%' || $3 || '%' OR to_tsvector('english', mi.title) @@ plainto_tsquery('english', $3))
     ORDER BY mi.title
     LIMIT 50`,
    [USER_ID, type, q]
  );

  const knownExternal = new Set<string>(
    localRows.rows.filter((r) => r.external_url).map((r) => r.external_url as string)
  );

  const results: SearchHit[] = localRows.rows.map((r) => ({
    source: 'local',
    // Local rows still expose their external identity when they were
    // originally created from an API (e.g. "hardcover" in the search table).
    external_source: r.external_source || null,
    external_id: r.external_id || null,
    title: r.title,
    author: r.author,
    release_year: r.release_year,
    image_url: r.image_url,
    external_url: r.external_url,
    platform: r.platform || null,
    page_count: r.page_count ?? null,
    series_name: r.series_name || null,
    series_position: r.series_position ?? null,
    series_count: r.series_count ?? null,
    local_id: r.id,
    last_checkin_at: r.last_checkin_at,
    last_checkin_type: r.last_checkin_type,
    my_rating: r.my_rating != null ? Number(r.my_rating) : null,
  }));

  let degraded = false;
  let external: { external_source: string; rows: { externalId: string; title: string; releaseYear: number | null; imageUrl: string | null; externalUrl: string; author?: string | null; platform?: string | null; pageCount?: number | null; seriesName?: string | null; seriesPosition?: number | null; seriesCount?: number | null }[] } | null = null;

  if (type === 'movie' || type === 'tv_show') {
    const found = type === 'movie'
      ? await tmdb.searchMovies(keys.tmdb_api_key, q)
      : await tmdb.searchTv(keys.tmdb_api_key, q);
    if (!found) {
      degraded = true;
    } else {
      external = {
        external_source: 'tmdb',
        rows: found.map((f) => ({ externalId: f.externalId, title: f.title, releaseYear: f.releaseYear, imageUrl: f.imageUrl, externalUrl: f.externalUrl })),
      };
    }
  } else if (type === 'game') {
    const found = await tgdb.searchGames(keys.tgdb_api_key, q);
    if (!found) {
      degraded = true;
    } else {
      external = { external_source: 'tgdb', rows: found.map((f) => ({ externalId: f.externalId, title: f.title, releaseYear: f.releaseYear, imageUrl: f.imageUrl, externalUrl: f.externalUrl, platform: f.platform })) };
    }
  } else if (type === 'book') {
    const found = await hardcover.searchBooks(keys.hardcover_api_key, q);
    if (!found) {
      degraded = true;
    } else {
      external = {
        external_source: 'hardcover',
        rows: found.map((f) => ({
          externalId: f.externalId,
          title: f.title,
          releaseYear: f.releaseYear,
          imageUrl: f.imageUrl,
          externalUrl: f.externalUrl,
          author: f.author,
          pageCount: f.pageCount,
          seriesName: f.seriesName,
          seriesPosition: f.seriesPosition,
          seriesCount: f.seriesCount,
        })),
      };
      // Backfill page count / series info on books already saved locally so
      // the detail page picks it up without a new check-in.
      await backfillBookMetadata(
        localRows.rows.filter((r) => r.external_source === 'hardcover'),
        found
      );
    }
  }

  if (external) {
    for (const row of external.rows) {
      if (knownExternal.has(row.externalUrl)) continue;
      results.push({
        source: external.external_source,
        external_source: external.external_source,
        external_id: row.externalId,
        title: row.title,
        author: row.author || null,
        release_year: row.releaseYear,
        image_url: row.imageUrl,
        external_url: row.externalUrl,
        platform: row.platform || null,
        page_count: row.pageCount ?? null,
        series_name: row.seriesName || null,
        series_position: row.seriesPosition ?? null,
        series_count: row.seriesCount ?? null,
        local_id: null,
        last_checkin_at: null,
        last_checkin_type: null,
        my_rating: null,
      });
    }
  }

  return { results, degraded };
}

// GET /search?type=movie|tv_show|game|book|board_game&q=...
router.get('/search', async (req: Request, res: Response) => {
  try {
    const type = String(req.query.type || '');
    const q = String(req.query.q || '').trim();
    if (!MEDIA_TYPES.has(type) || !q) {
      return res.status(400).json({ error: 'type and q are required' });
    }
    const { results, degraded } = await searchMedia(type, q);
    res.json({ results, degraded });
  } catch (err) {
    console.error('Error searching media:', err);
    res.status(500).json({ error: 'Failed to search media' });
  }
});

// POST /items - create a custom (local) media item, or upsert an API-sourced one
router.post('/items', async (req: Request, res: Response) => {
  try {
    const { media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform, page_count, series_name, series_position, series_count } = req.body;
    if (!title || !media_type) {
      return res.status(400).json({ error: 'media_type and title are required' });
    }
    const id = await upsertMediaItem({
      media_type,
      external_source: external_source || null,
      external_id: external_id || null,
      title,
      author: author || null,
      release_year: release_year ?? null,
      image_url: image_url || null,
      external_url: external_url || null,
      platform: platform || null,
      page_count: toIntOrNull(page_count),
      series_name: series_name || null,
      series_position: toIntOrNull(series_position),
      series_count: toIntOrNull(series_count),
    });
    const item = await query(
      'SELECT id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform, page_count, series_name, series_position, series_count, created_at FROM media_items WHERE id = $1',
      [id]
    );
    res.status(201).json(item.rows[0]);
  } catch (err) {
    console.error('Error creating media item:', err);
    res.status(500).json({ error: 'Failed to create media item' });
  }
});

// GET /items/:id - item with aggregate stats
router.get('/items/:id', async (req: Request, res: Response) => {
  try {
    const itemResult = await query(
      `SELECT id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform,
              page_count, series_name, series_position, series_count, created_at
       FROM media_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, USER_ID]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }

    const statsResult = await query(
      `SELECT MAX(checked_in_at) AS last_checkin_at,
              COUNT(*) AS checkin_count,
              (ARRAY_AGG(rating ORDER BY checked_in_at DESC) FILTER (WHERE rating IS NOT NULL))[1] AS my_rating,
              COUNT(*) FILTER (WHERE checkin_type = 'completed') AS completed_count,
              (ARRAY_AGG(time_played_minutes ORDER BY checked_in_at DESC, id DESC)
                 FILTER (WHERE time_played_minutes IS NOT NULL))[1] AS total_time_played_minutes
       FROM media_checkins WHERE media_item_id = $1`,
      [req.params.id]
    );
    const s = statsResult.rows[0];

    res.json({
      ...itemResult.rows[0],
      last_checkin_at: s.last_checkin_at,
      checkin_count: Number(s.checkin_count),
      my_rating: s.my_rating != null ? Number(s.my_rating) : null,
      completed_count: Number(s.completed_count),
      total_time_played_minutes: s.total_time_played_minutes != null ? Number(s.total_time_played_minutes) : null,
    });
  } catch (err) {
    console.error('Error getting media item:', err);
    res.status(500).json({ error: 'Failed to get media item' });
  }
});

// GET /items/:id/checkins - check-in table for the detail page
router.get('/items/:id/checkins', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT mc.id, mc.season_number, mc.episode_number, mc.episode_title, mc.checkin_type,
              mc.rating, mc.raw_score, mc.notes, mc.checked_in_at, mc.checkin_timezone,
              mc.time_played_minutes, mc.created_at, mc.updated_at
       FROM media_checkins mc
       WHERE mc.media_item_id = $1 AND mc.user_id = $2
       ORDER BY mc.checked_in_at DESC`,
      [req.params.id, USER_ID]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing media check-ins:', err);
    res.status(500).json({ error: 'Failed to list media check-ins' });
  }
});

// POST /items/:id/checkins - create a media check-in
router.post('/items/:id/checkins', async (req: Request, res: Response) => {
  try {
    const {
      season_number, episode_number, episode_title,
      checkin_type, rating, raw_score, notes, checked_in_at, timezone,
      time_played_minutes,
    } = req.body;

    if (!checkin_type || !CHECKIN_TYPES.has(checkin_type)) {
      return res.status(400).json({ error: 'checkin_type must be one of completed, in_progress, dropped' });
    }
    if (timezone && typeof timezone !== 'string') {
      return res.status(400).json({ error: 'timezone must be a string' });
    }
    const checkinTimezone = typeof timezone === 'string' && timezone ? timezone : 'UTC';

    const itemResult = await query(
      'SELECT id FROM media_items WHERE id = $1 AND user_id = $2',
      [req.params.id, USER_ID]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }

    // "Total time played" is a running total for games: new check-ins update
    // the total, they never lower it. Clamp the submitted value to the current
    // total (same rule the yamtrack importer applies via applyMaxTimePlayed).
    const submittedTime =
      typeof time_played_minutes === 'number' && Number.isFinite(time_played_minutes) && time_played_minutes >= 0
        ? Math.round(time_played_minutes)
        : null;

    let storedTime = submittedTime;
    if (submittedTime != null) {
      const latest = await query(
        `SELECT time_played_minutes FROM media_checkins
         WHERE media_item_id = $1 AND time_played_minutes IS NOT NULL
         ORDER BY checked_in_at DESC, id DESC LIMIT 1`,
        [req.params.id]
      );
      const existing = latest.rows[0]?.time_played_minutes;
      storedTime = Math.max(existing != null ? Number(existing) : 0, submittedTime);
    }

    const result = await query(
      `INSERT INTO media_checkins
         (user_id, media_item_id, season_number, episode_number, episode_title,
          checkin_type, rating, raw_score, notes, checked_in_at, checkin_timezone, time_played_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11, $12)
       RETURNING *`,
      [
        USER_ID, req.params.id,
        season_number ?? null, episode_number ?? null, episode_title || null,
        checkin_type,
        rating != null && Number.isInteger(rating) && rating >= 0 && rating <= 4 ? rating : null,
        raw_score != null && raw_score !== '' ? Number(raw_score) : null,
        notes || null,
        checked_in_at || null,
        checkinTimezone,
        storedTime,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating media check-in:', err);
    res.status(500).json({ error: 'Failed to create media check-in' });
  }
});

// PUT /checkins/:id - update a media check-in
//
// Semantics: partial, COALESCE-based update. Every field is only written when
// it is present in the body (with a valid value), so omitted fields keep their
// stored value. Setting a field back to null is intentionally unsupported via
// this endpoint (passing null/empty is treated the same as omitting it); edit
// UI that needs to clear fields will have to extend this contract.
router.put('/checkins/:id', async (req: Request, res: Response) => {
  try {
    const { checkin_type, rating, raw_score, notes, checked_in_at, timezone, time_played_minutes } = req.body;

    const result = await query(
      `UPDATE media_checkins
       SET checkin_type = COALESCE($2, checkin_type),
           rating = COALESCE($3, rating),
           raw_score = COALESCE($4, raw_score),
           notes = COALESCE($5, notes),
           checked_in_at = COALESCE($6::timestamptz, checked_in_at),
           checkin_timezone = COALESCE($7, checkin_timezone),
           time_played_minutes = COALESCE($9, time_played_minutes),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $8
       RETURNING *`,
      [
        req.params.id,
        checkin_type && CHECKIN_TYPES.has(checkin_type) ? checkin_type : null,
        rating != null && Number.isInteger(rating) && rating >= 0 && rating <= 4 ? rating : null,
        raw_score != null && raw_score !== '' ? Number(raw_score) : null,
        notes !== undefined ? (notes || null) : null,
        checked_in_at || null,
        typeof timezone === 'string' && timezone ? timezone : null,
        USER_ID,
        time_played_minutes !== undefined
          ? (typeof time_played_minutes === 'number' && Number.isFinite(time_played_minutes) && time_played_minutes >= 0
              ? Math.round(time_played_minutes)
              : null)
          : null,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media check-in not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating media check-in:', err);
    res.status(500).json({ error: 'Failed to update media check-in' });
  }
});

// DELETE /checkins/:id
router.delete('/checkins/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM media_checkins WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, USER_ID]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media check-in not found' });
    }
    res.json({ message: 'Media check-in deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('Error deleting media check-in:', err);
    res.status(500).json({ error: 'Failed to delete media check-in' });
  }
});

// GET /tv/:itemId/seasons - cached season list for the episode picker
router.get('/tv/:itemId/seasons', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const itemResult = await client.query(
      `SELECT mi.id, mi.external_source, mi.external_id,
              MAX(mte.cached_at) AS episodes_cached_at
       FROM media_items mi
       LEFT JOIN media_tv_episodes mte ON mte.media_item_id = mi.id
       WHERE mi.id = $1 AND mi.user_id = $2
       GROUP BY mi.id`,
      [req.params.itemId, USER_ID]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'TV show not found' });
    }
    const item = itemResult.rows[0];
    const cachedRows = await client.query(
      'SELECT DISTINCT season_number FROM media_tv_episodes WHERE media_item_id = $1 ORDER BY season_number',
      [item.id]
    );

    let seasons: { season_number: number; episodes: { episode_number: number; episode_title: string | null }[] }[];

    if (cachedRows.rows.length > 0) {
      const cachedAt: string | null = item.episodes_cached_at;
      const stale = !cachedAt ||
        (Date.now() - new Date(cachedAt).getTime()) > EPISODE_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

      if (!stale) {
        const epRows = await client.query(
          'SELECT season_number, episode_number, episode_title FROM media_tv_episodes WHERE media_item_id = $1 ORDER BY season_number, episode_number',
          [item.id]
        );
        seasons = buildSeasonList(epRows.rows);
      } else {
        // Re-fetch from TMDB (best effort) and merge.
        const keys = await getApiKeys();
        const fresh = item.external_source === 'tmdb' && item.external_id
          ? await tmdb.getShowSeasons(keys.tmdb_api_key, item.external_id)
          : null;
        if (fresh && fresh.length > 0) {
          await refreshEpisodesFromTmdb(client, item, keys, fresh);
          const epRows = await client.query(
            'SELECT season_number, episode_number, episode_title FROM media_tv_episodes WHERE media_item_id = $1 ORDER BY season_number, episode_number',
            [item.id]
          );
          seasons = buildSeasonList(epRows.rows);
        } else {
          // TMDB unavailable (or nothing fresh returned): serve the cached
          // episode rows as-is instead of zeroed placeholders, which
          // buildSeasonList would drop entirely (F3).
          const epRows = await client.query(
            'SELECT season_number, episode_number, episode_title FROM media_tv_episodes WHERE media_item_id = $1 ORDER BY season_number, episode_number',
            [item.id]
          );
          seasons = buildSeasonList(epRows.rows);
        }
      }
    } else {
      // No cached episodes: fetch from TMDB.
      const keys = await getApiKeys();
      if (item.external_source === 'tmdb' && item.external_id) {
        await refreshEpisodesFromTmdb(client, item, keys);
        const epRows = await client.query(
          'SELECT season_number, episode_number, episode_title FROM media_tv_episodes WHERE media_item_id = $1 ORDER BY season_number, episode_number',
          [item.id]
        );
        seasons = buildSeasonList(epRows.rows);
      } else {
        seasons = [];
      }
    }

    res.json({ seasons, cached: cachedRows.rows.length > 0 });
  } catch (err) {
    console.error('Error fetching TV seasons:', err);
    res.status(500).json({ error: 'Failed to fetch TV seasons' });
  } finally {
    client.release();
  }
});

function buildSeasonList(rows: { season_number: number; episode_number?: number; episode_title?: string | null }[]) {
  const map = new Map<number, { episode_number: number; episode_title: string | null }[]>();
  for (const row of rows) {
    if (!map.has(row.season_number)) map.set(row.season_number, []);
    const eps = map.get(row.season_number)!;
    if (row.episode_number != null && row.episode_number > 0) {
      eps.push({ episode_number: row.episode_number, episode_title: row.episode_title ?? null });
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([season_number, episodes]) => ({
      season_number,
      episodes: episodes.sort((a, b) => a.episode_number - b.episode_number),
    }));
}

/**
 * Fetch all seasons/episodes for a TMDB show and upsert into
 * media_tv_episodes. Skipped entirely when no TMDB key is available.
 */
async function refreshEpisodesFromTmdb(
  client: import('pg').PoolClient,
  item: { id: string; external_source: string | null; external_id: string | null },
  keys: SettingsKeys,
  prefetchedSeasons?: import('../services/tmdb').TmdbSeasonInfo[] | null
): Promise<void> {
  if (item.external_source !== 'tmdb' || !item.external_id || !keys.tmdb_api_key) return;

  // Use the caller's already-fetched seasons when available to avoid a
  // duplicate getShowSeasons round-trip (the stale path fetches them first
  // to decide whether a refresh is worth doing).
  const seasons = prefetchedSeasons ?? (await tmdb.getShowSeasons(keys.tmdb_api_key, item.external_id));
  if (!seasons) return;

  // Wrap the per-episode upserts in a transaction so a mid-refresh failure
  // cannot leave the cache with partial season data.
  await client.query('BEGIN');
  try {
    for (const season of seasons) {
      const episodes = await tmdb.getShowEpisodes(keys.tmdb_api_key, item.external_id, season.seasonNumber);
      if (!episodes) continue;
      for (const ep of episodes) {
        await client.query(
          `INSERT INTO media_tv_episodes (media_item_id, season_number, episode_number, episode_title, cached_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (media_item_id, season_number, episode_number)
           DO UPDATE SET episode_title = COALESCE($4, media_tv_episodes.episode_title), cached_at = NOW()`,
          [item.id, season.seasonNumber, ep.episodeNumber, ep.episodeTitle]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// GET /library?from=YYYY-MM-DD&to=YYYY-MM-DD&types=movie,tv_show
// Media library view: one row per media item with at least one check-in in range,
// including the latest rating, most recent check-in timestamp, and its type.
router.get('/library', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const typesParam = req.query.types as string | undefined;

    const requestedTypes = (typesParam ? typesParam.split(',') : [])
      .map((t) => t.trim())
      .filter((t) => MEDIA_TYPES.has(t));
    const mediaTypes = requestedTypes.length > 0 ? requestedTypes : [...MEDIA_TYPES];

    const params: unknown[] = [USER_ID, mediaTypes];
    const dateConditions: string[] = [];
    if (from) {
      dateConditions.push(`(mc.checked_in_at AT TIME ZONE mc.checkin_timezone)::date >= $${params.length + 1}::date`);
      params.push(from);
    }
    if (to) {
      dateConditions.push(`(mc.checked_in_at AT TIME ZONE mc.checkin_timezone)::date <= $${params.length + 1}::date`);
      params.push(to);
    }
    const where = `WHERE mc.user_id = $1 AND mi.media_type = ANY($2) ${dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : ''}`;

    const result = await query(
      `SELECT mi.id, mi.media_type, mi.title, mi.author, mi.image_url,
              (ARRAY_AGG(mc.rating ORDER BY mc.checked_in_at DESC) FILTER (WHERE mc.rating IS NOT NULL))[1] AS latest_rating,
              (ARRAY_AGG(mc.checked_in_at ORDER BY mc.checked_in_at DESC))[1] AS last_checkin_at,
              (ARRAY_AGG(mc.checkin_timezone ORDER BY mc.checked_in_at DESC))[1] AS last_checkin_timezone,
              (ARRAY_AGG(mc.checkin_type ORDER BY mc.checked_in_at DESC))[1] AS last_checkin_type
       FROM media_checkins mc
       JOIN media_items mi ON mc.media_item_id = mi.id
       ${where}
       GROUP BY mi.id, mi.media_type, mi.title, mi.author, mi.image_url
       ORDER BY last_checkin_at DESC`,
      params
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      media_type: r.media_type,
      title: r.title,
      author: r.author,
      image_url: r.image_url,
      latest_rating: r.latest_rating != null ? Number(r.latest_rating) : null,
      last_checkin_at: r.last_checkin_at,
      last_checkin_timezone: r.last_checkin_timezone,
      last_checkin_type: r.last_checkin_type,
    })));
  } catch (err) {
    console.error('Error getting media library:', err);
    res.status(500).json({ error: 'Failed to get media library' });
  }
});

// GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD - Profile Media stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const params: unknown[] = [USER_ID];
    const dateConditions: string[] = [];
    if (from) {
      dateConditions.push(`(mc.checked_in_at AT TIME ZONE mc.checkin_timezone)::date >= $${params.length + 1}::date`);
      params.push(from);
    }
    if (to) {
      dateConditions.push(`(mc.checked_in_at AT TIME ZONE mc.checkin_timezone)::date <= $${params.length + 1}::date`);
      params.push(to);
    }
    const where = `WHERE mc.user_id = $1 ${dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : ''}`;

    const countsResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE mi.media_type = 'tv_show' AND mc.checkin_type = 'completed') AS tv_episodes_completed,
         COUNT(*) FILTER (WHERE mi.media_type = 'movie' AND mc.checkin_type = 'completed') AS movies_watched,
         COUNT(*) FILTER (WHERE mi.media_type = 'book' AND mc.checkin_type = 'completed') AS books_completed,
         COUNT(*) FILTER (WHERE mi.media_type = 'game' AND mc.checkin_type = 'completed') AS games_completed,
         COUNT(*) FILTER (WHERE mi.media_type = 'board_game' AND mc.checkin_type = 'completed') AS board_games_completed
       FROM media_checkins mc
       JOIN media_items mi ON mc.media_item_id = mi.id
       ${where}`,
      params
    );
    const c = countsResult.rows[0];

    const topResult = await query(
      `SELECT mi.id, mi.media_type, mi.title, mi.image_url, mi.author,
              (ARRAY_AGG(mc.rating ORDER BY mc.checked_in_at DESC) FILTER (WHERE mc.rating IS NOT NULL))[1] AS rating,
              COUNT(*) FILTER (WHERE mc.checkin_type = 'completed') AS completed_count
       FROM media_checkins mc
       JOIN media_items mi ON mc.media_item_id = mi.id
       ${where}
         AND mc.rating IS NOT NULL
       GROUP BY mi.id, mi.media_type, mi.title, mi.image_url, mi.author
       HAVING (ARRAY_AGG(mc.rating ORDER BY mc.checked_in_at DESC) FILTER (WHERE mc.rating IS NOT NULL))[1] >= 3
       ORDER BY rating DESC, completed_count DESC
       LIMIT 10`,
      params
    );

    res.json({
      tv_episodes_completed: Number(c.tv_episodes_completed),
      movies_watched: Number(c.movies_watched),
      books_completed: Number(c.books_completed),
      games_completed: Number(c.games_completed),
      board_games_completed: Number(c.board_games_completed),
      top_media: topResult.rows.map((r) => ({
        id: r.id,
        media_type: r.media_type,
        title: r.title,
        image_url: r.image_url,
        author: r.author,
        rating: Number(r.rating),
        completed_count: Number(r.completed_count),
      })),
    });
  } catch (err) {
    console.error('Error getting media stats:', err);
    res.status(500).json({ error: 'Failed to get media stats' });
  }
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

// GET /lists
router.get('/lists', async (_req: Request, res: Response) => {
  try {
    const listsResult = await query(
      'SELECT id, name, created_at FROM media_lists WHERE user_id = $1 ORDER BY created_at',
      [USER_ID]
    );
    const itemsResult = await query(
      `SELECT l.id AS list_id, l.name,
              json_agg(json_build_object(
                'id', mi.id, 'media_type', mi.media_type, 'title', mi.title,
                'image_url', mi.image_url, 'author', mi.author
              ) ORDER BY mli.position, mli.added_at) AS items
       FROM media_lists l
       LEFT JOIN media_list_items mli ON mli.list_id = l.id
       LEFT JOIN media_items mi ON mli.media_item_id = mi.id
       WHERE l.user_id = $1
       GROUP BY l.id, l.name`,
      [USER_ID]
    );
    const itemsById = new Map(itemsResult.rows.map((r) => [r.list_id as string, r.items]));
    res.json(listsResult.rows.map((l) => ({ ...l, items: itemsById.get(l.id) || [] })));
  } catch (err) {
    console.error('Error listing media lists:', err);
    res.status(500).json({ error: 'Failed to list media lists' });
  }
});

// POST /lists
router.post('/lists', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await query(
      'INSERT INTO media_lists (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at',
      [USER_ID, name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating media list:', err);
    res.status(500).json({ error: 'Failed to create media list' });
  }
});

// PUT /lists/:id - rename
router.put('/lists/:id', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const result = await query(
      'UPDATE media_lists SET name = $2 WHERE id = $1 AND user_id = $3 RETURNING id, name, created_at',
      [req.params.id, name.trim(), USER_ID]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media list not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error renaming media list:', err);
    res.status(500).json({ error: 'Failed to rename media list' });
  }
});

// DELETE /lists/:id
router.delete('/lists/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'DELETE FROM media_lists WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, USER_ID]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media list not found' });
    }
    res.json({ message: 'Media list deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('Error deleting media list:', err);
    res.status(500).json({ error: 'Failed to delete media list' });
  }
});

// POST /lists/:id/items - add media item to a list
router.post('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const { media_item_id } = req.body;
    if (!media_item_id) {
      return res.status(400).json({ error: 'media_item_id is required' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const listResult = await client.query(
        'SELECT id FROM media_lists WHERE id = $1 AND user_id = $2',
        [req.params.id, USER_ID]
      );
      if (listResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Media list not found' });
      }
      const itemResult = await client.query(
        'SELECT id FROM media_items WHERE id = $1 AND user_id = $2',
        [media_item_id, USER_ID]
      );
      if (itemResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Media item not found' });
      }
      await client.query(
        `INSERT INTO media_list_items (list_id, media_item_id)
         VALUES ($1, $2)
         ON CONFLICT (list_id, media_item_id) DO NOTHING`,
        [req.params.id, media_item_id]
      );
      await client.query('COMMIT');
      res.status(201).json({ message: 'Added to list' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error adding to media list:', err);
    res.status(500).json({ error: 'Failed to add media item to list' });
  }
});

// DELETE /lists/:id/items/:itemId - remove media item from a list
router.delete('/lists/:id/items/:itemId', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `DELETE FROM media_list_items mli
       USING media_lists l
       WHERE mli.list_id = l.id AND l.id = $1 AND l.user_id = $2 AND mli.media_item_id = $3
       RETURNING mli.list_id`,
      [req.params.id, USER_ID, req.params.itemId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not in list' });
    }
    res.json({ message: 'Removed from list' });
  } catch (err) {
    console.error('Error removing from media list:', err);
    res.status(500).json({ error: 'Failed to remove media item from list' });
  }
});

export const mediaRouter = router;
