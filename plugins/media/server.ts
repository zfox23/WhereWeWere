/**
 * Media check-in type — server half.
 *
 * CUSTOM storage: Media keeps its pre-existing tables (media_items,
 * media_checkins, media_lists, media_list_items, media_tv_episodes,
 * plex_webhook_events) so the Yamtrack import, the Plex webhook, the
 * TMDB/TGDB/Hardcover integration, and timestamp reconciliation keep working
 * untouched. The framework uses this half for the unified timeline, backups,
 * start-over, and mounts the plugin-owned API routers.
 *
 * This plugin owns ALL media-specific API surface:
 *   - /media            search, items CRUD/sync, check-in CRUD, lists,
 *                       library, stats, TV season cache (ex-routes/media.ts)
 *   - /webhook/plex     the Plex scrobble webhook (ex-routes/webhook-plex.ts)
 *
 * Its provider API keys (tmdb/tgdb/hardcover) and the plex_usernames filter
 * live in the generic plugin_settings table (declared in settingsKeys; the
 * 044 migration moved them out of user_settings).
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query, pool } from '../../server/src/db';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { allPlugins } from '../../server/src/plugins/registry';
import type {
  CheckinTypeServerPlugin,
  PluginTimelineContext,
  PluginReconciliationRow,
  PluginLlmRow,
} from 'wwp-shared';
import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';

import { tmdb } from './services/tmdb';
import { tgdb, type TgdbGameResult } from './services/tgdb';
import { normalizeTitle, titleRelation } from './services/titleMatch';
import { hardcover } from './services/hardcover';
import {
  normalizeCompanions,
  getCompanions,
  getCompanionsByCheckin,
  insertCompanions,
  setCompanions,
  deleteCompanionsForCheckins,
  companionNamesSql,
} from '../../server/src/services/companions';

const router = Router();

/** media_type -> URL segment for detail pages (reconciliation links etc.). */
const MEDIA_ROUTE_SEGMENTS: Record<string, string> = {
  movie: 'movie',
  tv_show: 'tv',
  game: 'game',
  book: 'book',
  board_game: 'board-game',
};

const MEDIA_TYPES = new Set(['movie', 'tv_show', 'game', 'book', 'board_game']);
const CHECKIN_TYPES = new Set(['completed', 'in_progress', 'started', 'dropped']);
const EPISODE_CACHE_MAX_AGE_DAYS = 30;

interface SettingsKeys {
  tmdb_api_key: string | null;
  tgdb_api_key: string | null;
  hardcover_api_key: string | null;
}

/**
 * Provider API keys live in plugin_settings (declared in settingsKeys; the
 * 044 migration moved them out of user_settings). plugin_settings stores
 * values as jsonb; string keys decode back to plain strings.
 */
async function getApiKeys(): Promise<SettingsKeys> {
  const result = await query(
    `SELECT key, value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'media'
        AND key IN ('tmdb_api_key', 'tgdb_api_key', 'hardcover_api_key')`,
    [USER_ID]
  );
  const values: Record<string, string | null> = {};
  for (const row of result.rows) {
    const v = row.value;
    values[row.key] = typeof v === 'string' && v.length > 0 ? v : null;
  }
  return {
    tmdb_api_key: values.tmdb_api_key ?? null,
    tgdb_api_key: values.tgdb_api_key ?? null,
    hardcover_api_key: values.hardcover_api_key ?? null,
  };
}

/** The Plex username filter (plugin_settings); null means "track all". */
async function getPlexUsernames(): Promise<string | null> {
  const result = await query(
    `SELECT value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'media' AND key = 'plex_usernames'`,
    [USER_ID]
  );
  const v = result.rows[0]?.value;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Detail path for a media check-in (used by timestamp reconciliation):
 * /media/<segment>/<itemId>/<slug>, matching the client's detail routes.
 */
export function buildMediaDetailPath(
  mediaType: string,
  mediaItemId: string,
  mediaTitle: string | null,
): string {
  const segment = MEDIA_ROUTE_SEGMENTS[mediaType] || 'movie';
  const slug = mediaTitle ? slugifyTitle(mediaTitle) : '';
  return `/media/${segment}/${mediaItemId}/${slug}`;
}

/** Mirror of the client-side slugify (client/src/utils/slugify.ts). */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// LLM life-summary line formatting
// ---------------------------------------------------------------------------

/** media_type -> prompt label (matches the client's manifest labels). */
const MEDIA_LLM_TYPE_LABELS: Record<string, string> = {
  movie: 'movie',
  tv_show: 'TV show',
  game: 'game',
  book: 'book',
  board_game: 'board game',
};

/** checkin_type -> prompt verb/label. */
const MEDIA_LLM_CHECKIN_LABELS: Record<string, string> = {
  completed: 'completed',
  in_progress: 'in progress',
  started: 'started',
  dropped: 'dropped',
};

function formatLlmWhen(iso: string | Date, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
}

/** e.g. 90 -> "1h 30m", 45 -> "45m". */
function formatLlmMinutes(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  if (rest === 0) return `${h}h`;
  return `${h}h ${rest}m`;
}


/**
 * Find-or-create a media item within the caller's transaction (core
 * importers run on a shared client).
 *
 * Mirrors upsertMediaItem, but takes an explicit client so it can run
 * inside the caller's transaction.
 *
 * Local-only items (no external_source/external_id — e.g. Yamtrack games,
 * which carry IGDB ids we must not store as TGDB ids, and board games) are
 * deduped by strict title match instead: exact normalized title, or a
 * same-game edition qualifier. Everything else counts as a different item,
 * so re-imports never create duplicate rows (same rules as the games-CSV
 * importer).
 */
export async function upsertMediaItemWithClient(
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
  } else {
    // Local-only: find an existing item of the same type by strict title.
    const siblings = await client.query(
      `SELECT id, title FROM media_items
       WHERE user_id = $1 AND media_type = $2 AND external_source IS NULL`,
      [USER_ID, input.media_type]
    );
    const key = normalizeTitle(input.title);
    const match = siblings.rows.find(
      (r) => titleRelation(key, normalizeTitle(r.title as string)) !== 'none'
    );
    if (match) {
      return { id: match.id as string, created: false };
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

export function toIntOrNull(value: unknown): number | null {
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
  /** Game: TGDB synopsis. */
  overview: string | null;
  /** Game: ESRB-style content rating, e.g. "E - Everyone". */
  content_rating: string | null;
  /** Game: minimum player count. */
  players: number | null;
  /** Game: co-op support ("Yes"/"No"). */
  coop: string | null;
  genres: string[] | null;
  developers: string[] | null;
  publishers: string[] | null;
  page_count: number | null;
  series_name: string | null;
  series_position: number | null;
  series_count: number | null;
  local_id: string | null;
  last_checkin_at: string | null;
  last_checkin_type: string | null;
  /** Item-level rating (media_items.rating), null when never set. */
  rating: number | null;
  /** Item-level status for games (completed/in_progress/started/dropped). */
  status: string | null;
  /** Display rating: item rating if set, else the latest check-in's rating. */
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
            mi.overview, mi.content_rating, mi.players, mi.coop, mi.genres, mi.developers, mi.publishers,
            mi.page_count, mi.series_name, mi.series_position, mi.series_count,
            mi.rating, mi.status,
            mc_latest.last_checkin_at, mc_latest.last_checkin_type, mc_latest.latest_checkin_rating
     FROM media_items mi
     LEFT JOIN LATERAL (
       SELECT MAX(mc.checked_in_at) AS last_checkin_at,
              (ARRAY_AGG(mc.checkin_type ORDER BY mc.checked_in_at DESC, mc.created_at DESC))[1] AS last_checkin_type,
              (ARRAY_AGG(mc.rating ORDER BY mc.checked_in_at DESC, mc.created_at DESC) FILTER (WHERE mc.rating IS NOT NULL))[1] AS latest_checkin_rating
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
    overview: r.overview || null,
    content_rating: r.content_rating || null,
    players: r.players != null ? Number(r.players) : null,
    coop: r.coop || null,
    genres: r.genres?.length ? r.genres : null,
    developers: r.developers?.length ? r.developers : null,
    publishers: r.publishers?.length ? r.publishers : null,
    page_count: r.page_count ?? null,
    series_name: r.series_name || null,
    series_position: r.series_position ?? null,
    series_count: r.series_count ?? null,
    local_id: r.id,
    last_checkin_at: r.last_checkin_at,
    last_checkin_type: r.last_checkin_type,
    rating: r.rating != null ? Number(r.rating) : null,
    status: r.status || null,
    my_rating: r.rating != null
      ? Number(r.rating)
      : r.latest_checkin_rating != null ? Number(r.latest_checkin_rating) : null,
  }));

  let degraded = false;
  let external: { external_source: string; rows: { externalId: string; title: string; releaseYear: number | null; imageUrl: string | null; externalUrl: string; author?: string | null; platform?: string | null; overview?: string | null; contentRating?: string | null; players?: number | null; coop?: string | null; genres?: string[] | null; developers?: string[] | null; publishers?: string[] | null; pageCount?: number | null; seriesName?: string | null; seriesPosition?: number | null; seriesCount?: number | null }[] } | null = null;

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
      external = { external_source: 'tgdb', rows: found.map((f) => ({ externalId: f.externalId, title: f.title, releaseYear: f.releaseYear, imageUrl: f.imageUrl, externalUrl: f.externalUrl, platform: f.platform, overview: f.overview, contentRating: f.contentRating, players: f.players, coop: f.coop, genres: f.genres, developers: f.developers, publishers: f.publishers })) };
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
        overview: row.overview ?? null,
        content_rating: row.contentRating ?? null,
        players: row.players ?? null,
        coop: row.coop ?? null,
        genres: row.genres ?? null,
        developers: row.developers ?? null,
        publishers: row.publishers ?? null,
        page_count: row.pageCount ?? null,
        series_name: row.seriesName || null,
        series_position: row.seriesPosition ?? null,
        series_count: row.seriesCount ?? null,
        local_id: null,
        last_checkin_at: null,
        last_checkin_type: null,
        rating: null,
        status: null,
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
      'SELECT id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform, overview, content_rating, players, coop, genres, developers, publishers, page_count, series_name, series_position, series_count, rating, raw_score, notes, time_played_minutes, status, created_at FROM media_items WHERE id = $1',
      [id]
    );
    res.status(201).json(item.rows[0]);
  } catch (err) {
    console.error('Error creating media item:', err);
    res.status(500).json({ error: 'Failed to create media item' });
  }
});

/** media_type -> external source name stored in external_source (null = no provider). */
const SOURCE_BY_TYPE: Record<string, string | null> = {
  movie: 'tmdb',
  tv_show: 'tmdb',
  game: 'tgdb',
  book: 'hardcover',
  board_game: null,
};

// PUT /items/:id - update editable metadata fields on an existing item
router.put('/items/:id', async (req: Request, res: Response) => {
  try {
    const itemResult = await query(
      `SELECT id, media_type FROM media_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, USER_ID]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }
    const mediaType: string = itemResult.rows[0].media_type;
    const allowedSource = SOURCE_BY_TYPE[mediaType] || null;

    const { title, author, release_year, image_url, external_url, platform, overview, content_rating, players, coop, genres, developers, publishers, page_count, series_name, series_position, series_count, rating, raw_score, notes, time_played_minutes, status } = req.body;
    let external_id: unknown = req.body.external_id;

    // Board games are local-only: external fields are not applicable.
    if (mediaType === 'board_game' && external_id !== undefined) {
      return res.status(400).json({ error: 'Board games are local-only and have no external provider' });
    }

    // Setting an external_id derives the external_source from the media type.
    // If another item already claims that source+id, refuse rather than
    // merge check-ins into the wrong item.
    let externalSource: string | null = null;
    if (external_id !== undefined && external_id !== null) {
      const extId = String(external_id).trim();
      if (!extId) {
        external_id = null;
      } else {
        externalSource = allowedSource;
        if (!externalSource) {
          return res.status(400).json({ error: 'This media type has no external provider' });
        }
        const conflict = await query(
          `SELECT id FROM media_items
           WHERE user_id = $1 AND media_type = $2 AND external_source = $3 AND external_id = $4 AND id <> $5`,
          [USER_ID, mediaType, externalSource, extId, req.params.id]
        );
        if (conflict.rows.length > 0) {
          return res.status(409).json({ error: 'Another item already has this external ID' });
        }
        external_id = extId;
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (title !== undefined) {
      const t = typeof title === 'string' ? title.trim() : '';
      if (!t) return res.status(400).json({ error: 'title must be a non-empty string' });
      add('title', t);
    }
    if (author !== undefined) add('author', author ? String(author).trim() || null : null);
    if (release_year !== undefined) add('release_year', toIntOrNull(release_year));
    if (image_url !== undefined) add('image_url', image_url ? String(image_url).trim() || null : null);
    if (external_url !== undefined) add('external_url', external_url ? String(external_url).trim() || null : null);
    if (platform !== undefined && mediaType === 'game') {
      add('platform', platform ? String(platform).trim() || null : null);
    }
    // TGDB-sourced game metadata (sync applies these; also editable directly).
    if (mediaType === 'game') {
      if (overview !== undefined) add('overview', overview ? String(overview).trim() || null : null);
      if (content_rating !== undefined) add('content_rating', content_rating ? String(content_rating).trim() || null : null);
      if (coop !== undefined) add('coop', coop ? String(coop).trim() || null : null);
      if (players !== undefined) {
        const v = typeof players === 'number' && Number.isInteger(players) && players > 0 ? players : null;
        if (v == null && players != null) return res.status(400).json({ error: 'players must be a positive integer' });
        add('players', v);
      }
      const toNameArray = (value: unknown, label: string): string[] | null | undefined => {
        if (value == null) return null;
        if (!Array.isArray(value)) {
          res.status(400).json({ error: `${label} must be an array of strings` });
          return undefined;
        }
        const names = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '');
        if (value.length > 0 && names.length === 0) return null;
        if (names.length > 10 || names.some((n) => n.length > 100)) {
          res.status(400).json({ error: `${label} must be an array of short strings` });
          return undefined;
        }
        return names.length > 0 ? names : null;
      };
      for (const [column, value, label] of [
        ['genres', genres, 'genres'],
        ['developers', developers, 'developers'],
        ['publishers', publishers, 'publishers'],
      ] as const) {
        if (value !== undefined) {
          const arr = toNameArray(value, label);
          if (arr === undefined) return; // 400 already sent
          add(column, arr);
        }
      }
    }
    if (mediaType === 'book') {
      if (page_count !== undefined) add('page_count', toIntOrNull(page_count));
      if (series_name !== undefined) add('series_name', series_name ? String(series_name).trim() || null : null);
      if (series_position !== undefined) add('series_position', toIntOrNull(series_position));
      if (series_count !== undefined) add('series_count', toIntOrNull(series_count));
    }
    // Item-level user metadata: set directly on the media item (independent
    // of check-ins). Manual edits may lower time_played_minutes — the
    // never-decrease rule applies only to imports.
    if (rating !== undefined) {
      const v = typeof rating === 'number' && Number.isInteger(rating) && rating >= 0 && rating <= 4 ? rating : null;
      if (v == null && rating != null) return res.status(400).json({ error: 'rating must be an integer 0-4' });
      add('rating', v);
    }
    if (raw_score !== undefined) {
      const v = raw_score != null && raw_score !== '' ? Number(raw_score) : null;
      if (v != null && !Number.isFinite(v)) return res.status(400).json({ error: 'raw_score must be a number' });
      add('raw_score', v);
    }
    if (notes !== undefined) add('notes', typeof notes === 'string' && notes.trim() ? notes : null);
    if (time_played_minutes !== undefined) {
      const v = typeof time_played_minutes === 'number' && Number.isFinite(time_played_minutes) && time_played_minutes >= 0
        ? Math.round(time_played_minutes) : null;
      if (v == null && time_played_minutes != null) return res.status(400).json({ error: 'time_played_minutes must be a non-negative number' });
      add('time_played_minutes', v);
    }
    if (status !== undefined) {
      const v = typeof status === 'string' && CHECKIN_TYPES.has(status) ? status : null;
      if (v == null && status != null) return res.status(400).json({ error: 'status must be one of completed, in_progress, started, dropped' });
      add('status', v);
    }
    if (external_id !== undefined) {
      add('external_source', external_id ? externalSource : null);
      add('external_id', external_id ? String(external_id) : null);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    sets.push('updated_at = NOW()');

    params.push(req.params.id, USER_ID);
    await query(
      `UPDATE media_items SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND user_id = $${params.length}`,
      params
    );
    // Return the full item with aggregates (same shape as GET /items/:id) so
    // clients don't need a follow-up fetch after every update.
    const item = await query(
      `SELECT id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform,
              overview, content_rating, players, coop, genres, developers, publishers,
              page_count, series_name, series_position, series_count, rating, raw_score, notes,
              time_played_minutes, status, created_at
       FROM media_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, USER_ID]
    );
    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }
    const statsResult = await query(
      `SELECT MAX(checked_in_at) AS last_checkin_at,
              COUNT(*) AS checkin_count,
              (ARRAY_AGG(rating ORDER BY checked_in_at DESC, id DESC) FILTER (WHERE rating IS NOT NULL))[1] AS latest_checkin_rating,
              COUNT(*) FILTER (WHERE checkin_type = 'completed') AS completed_count
       FROM media_checkins WHERE media_item_id = $1`,
      [req.params.id]
    );
    const s = statsResult.rows[0];
    const it = item.rows[0];
    res.json({
      ...it,
      last_checkin_at: s.last_checkin_at,
      checkin_count: Number(s.checkin_count),
      my_rating: it.rating != null
        ? Number(it.rating)
        : s.latest_checkin_rating != null ? Number(s.latest_checkin_rating) : null,
      completed_count: Number(s.completed_count),
    });
  } catch (err) {
    console.error('Error updating media item:', err);
    res.status(500).json({ error: 'Failed to update media item' });
  }
});

/**
 * Re-key a local-only game by title: find a strict TGDB title match (exact or
 * edition qualifier) that no other local row already owns, and adopt its id +
 * metadata in place. This is what makes Yamtrack-imported games (which store
 * no external id) self-heal on their first sync. Returns the adopted TGDB
 * record, or null when no usable match exists.
 */
async function rekeyGameByTitle(itemId: string, title: string, platform?: string | null): Promise<TgdbGameResult | null> {
  const keys = await getApiKeys();
  if (!keys.tgdb_api_key) return null;
  // Narrow the name search to the item's platform so the right version of a
  // multi-platform title is matched; searchGames falls back to unfiltered
  // when the platform can't be resolved or yields nothing.
  const found = await tgdb.searchGames(keys.tgdb_api_key, title, platform);
  if (!found) return null;
  const target = normalizeTitle(title);
  for (const candidate of found) {
    if (titleRelation(target, normalizeTitle(candidate.title)) === 'none') continue;
    // Another local row may already own this TGDB id (partial unique index on
    // user/type/source/id); skip to the next strict match instead of
    // violating the constraint.
    const owner = await query(
      `SELECT id FROM media_items
       WHERE user_id = $1 AND media_type = 'game' AND external_source = 'tgdb' AND external_id = $2 AND id <> $3`,
      [USER_ID, candidate.externalId, itemId]
    );
    if (owner.rows.length > 0) continue;
    await query(
      `UPDATE media_items
       SET external_source = 'tgdb',
           external_id = $2,
           external_url = $3,
           release_year = COALESCE($4, release_year),
           image_url = COALESCE($5, image_url),
           platform = COALESCE($6, platform),
           overview = COALESCE(overview, $7),
           content_rating = COALESCE(content_rating, $8),
           players = COALESCE(players, $9),
           coop = COALESCE(coop, $10),
           genres = COALESCE(genres, $11),
           developers = COALESCE(developers, $12),
           publishers = COALESCE(publishers, $13),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $14`,
     [itemId, candidate.externalId, `https://thegamesdb.net/game.php?id=${candidate.externalId}`,
      candidate.releaseYear, candidate.imageUrl, candidate.platform,
      candidate.overview, candidate.contentRating, candidate.players, candidate.coop,
      candidate.genres, candidate.developers, candidate.publishers, USER_ID]
   );
    return candidate;
  }
  return null;
}

/** Fetch the latest metadata for an item from its provider. Never writes (except the game title re-key above). */
async function fetchSyncMetadata(item: {
  media_type: string;
  external_id: string;
  title: string;
}): Promise<{ provider: string; found: boolean; metadata: Record<string, string | number | null | string[]> } | null> {
  const keys = await getApiKeys();
  switch (item.media_type) {
    case 'movie': {
      const d = await tmdb.getMovieDetails(keys.tmdb_api_key, item.external_id);
      if (!d) return null;
      // TMDB ids are the lookup key; the web URL is deterministic from it.
      return { provider: 'TMDB', found: true, metadata: { title: d.title, release_year: d.releaseYear, image_url: d.imageUrl, external_id: item.external_id, external_url: `https://www.themoviedb.org/movie/${item.external_id}` } };
    }
    case 'tv_show': {
      const d = await tmdb.getTvShowDetails(keys.tmdb_api_key, item.external_id);
      if (!d) return null;
      return { provider: 'TMDB', found: true, metadata: { title: d.title, release_year: d.releaseYear, image_url: d.imageUrl, external_id: item.external_id, external_url: `https://www.themoviedb.org/tv/${item.external_id}` } };
    }
    case 'game': {
      const d = await tgdb.getGameDetails(keys.tgdb_api_key, item.external_id);
      if (!d) return null;
      return {
        provider: 'TGDB',
        found: true,
        metadata: {
          title: d.title,
          release_year: d.releaseYear,
          image_url: d.imageUrl,
          external_id: d.externalId,
          external_url: d.externalUrl,
          platform: d.platform,
          overview: d.overview,
          content_rating: d.contentRating,
          players: d.players,
          coop: d.coop,
          genres: d.genres,
          developers: d.developers,
          publishers: d.publishers,
        },
      };
    }
    case 'book': {
      const d = await hardcover.getBookByExternalId(keys.hardcover_api_key, item.external_id, item.title);
      if (!d) return null;
      return {
        provider: 'Hardcover',
        found: true,
        metadata: {
          title: d.title,
          author: d.author,
          release_year: d.releaseYear,
          image_url: d.imageUrl,
          external_id: d.externalId,
          external_url: d.externalUrl,
          page_count: d.pageCount,
          series_name: d.seriesName,
          series_position: d.seriesPosition,
          series_count: d.seriesCount,
        },
      };
    }
    default:
      return null;
  }
}

// POST /items/:id/sync - fetch fresh provider metadata; the client diffs and
// the user accepts changes explicitly via PUT /items/:id
router.post('/items/:id/sync', async (req: Request, res: Response) => {
  try {
    const itemResult = await query(
      `SELECT id, media_type, external_source, external_id, title, platform FROM media_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, USER_ID]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }
    const item = itemResult.rows[0];
    if (item.media_type === 'board_game') {
      return res.status(400).json({ error: 'Board games are local-only and have no provider to sync from' });
    }
    if (!item.external_id) {
      if (item.media_type === 'game') {
        // Local-only games (e.g. imported from Yamtrack, whose IGDB ids we
        // must not store) self-heal: resolve them by title against TGDB.
        const match = await rekeyGameByTitle(item.id, item.title, item.platform);
        if (!match) {
          return res.status(404).json({ error: 'Could not find this game in TGDB by title (it may be missing from the database).' });
        }
        return res.json({
          provider: 'TGDB',
          found: true,
          rekeyed: true,
          metadata: {
            title: match.title,
            release_year: match.releaseYear,
            image_url: match.imageUrl,
            external_id: match.externalId,
            external_url: match.externalUrl,
            platform: match.platform,
            overview: match.overview,
            content_rating: match.contentRating,
            players: match.players,
            coop: match.coop,
            genres: match.genres,
            developers: match.developers,
            publishers: match.publishers,
          },
        });
      }
      return res.status(400).json({ error: 'This item has no external ID. Set one in edit mode first.' });
    }
    const result = await fetchSyncMetadata(item);
    if (!result) {
      const keys = await getApiKeys();
      const hasKey = item.media_type === 'book'
        ? !!keys.hardcover_api_key
        : item.media_type === 'game'
          ? !!keys.tgdb_api_key
          : !!keys.tmdb_api_key;
      if (!hasKey) {
        return res.status(400).json({ error: 'API key for this provider is not configured' });
      }
      return res.status(404).json({ error: 'Provider could not find this item (it may have been removed)' });
    }
    res.json(result);
  } catch (err) {
    console.error('Error syncing media item:', err);
    res.status(500).json({ error: 'Failed to sync metadata' });
  }
});

// GET /items/:id - item with aggregate stats
router.get('/items/:id', async (req: Request, res: Response) => {
  try {
    const itemResult = await query(
      `SELECT id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, platform,
              overview, content_rating, players, coop, genres, developers, publishers,
              page_count, series_name, series_position, series_count, rating, raw_score, notes,
              time_played_minutes, status, created_at
       FROM media_items WHERE id = $1 AND user_id = $2`,
      [req.params.id, USER_ID]
    );
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Media item not found' });
    }

    const statsResult = await query(
      `SELECT MAX(checked_in_at) AS last_checkin_at,
              COUNT(*) AS checkin_count,
              (ARRAY_AGG(rating ORDER BY checked_in_at DESC, id DESC) FILTER (WHERE rating IS NOT NULL))[1] AS latest_checkin_rating,
              COUNT(*) FILTER (WHERE checkin_type = 'completed') AS completed_count
       FROM media_checkins WHERE media_item_id = $1`,
      [req.params.id]
    );
    const s = statsResult.rows[0];
    const it = itemResult.rows[0];

    res.json({
      ...it,
      last_checkin_at: s.last_checkin_at,
      checkin_count: Number(s.checkin_count),
      my_rating: it.rating != null
        ? Number(it.rating)
        : s.latest_checkin_rating != null ? Number(s.latest_checkin_rating) : null,
      completed_count: Number(s.completed_count),
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
    const byCheckin = await getCompanionsByCheckin(
      'media',
      result.rows.map((r) => r.id as string),
    );
    res.json(result.rows.map((r) => ({ ...r, companions: byCheckin.get(r.id) ?? [] })));
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
      time_played_minutes, companions,
    } = req.body;

    if (!checkin_type || !CHECKIN_TYPES.has(checkin_type)) {
      return res.status(400).json({ error: 'checkin_type must be one of completed, in_progress, started, dropped' });
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

    // Per-session time played context on the check-in row (item-level total
    // time lives on media_items and is edited on the detail page).
    const submittedTime =
      typeof time_played_minutes === 'number' && Number.isFinite(time_played_minutes) && time_played_minutes >= 0
        ? Math.round(time_played_minutes)
        : null;

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
        submittedTime,
      ]
    );
    // People "with" on the check-in (shared core companion table).
    const companionNames = normalizeCompanions(companions);
    if (companionNames.length > 0) {
      await insertCompanions('media', result.rows[0].id as string, companionNames);
    }
    res.status(201).json({ ...result.rows[0], companions: companionNames });
  } catch (err) {
    console.error('Error creating media check-in:', err);
    res.status(500).json({ error: 'Failed to create media check-in' });
  }
});

// PUT /checkins/:id - update a media check-in
//
// Semantics: partial update. Every field that is *present* in the body is
// written (null explicitly clears it); omitted fields keep their stored value.
// The edit UI sends a full draft (all fields present), so nothing is stale.
router.put('/checkins/:id', async (req: Request, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      sets.push(clause);
    };

    if (body.season_number !== undefined) {
      const v = typeof body.season_number === 'number' && Number.isInteger(body.season_number) && body.season_number > 0
        ? body.season_number : null;
      add('season_number = $' + (params.length + 1), v);
    }
    if (body.episode_number !== undefined) {
      const v = typeof body.episode_number === 'number' && Number.isInteger(body.episode_number) && body.episode_number > 0
        ? body.episode_number : null;
      add('episode_number = $' + (params.length + 1), v);
    }
    if (body.episode_title !== undefined) {
      add('episode_title = $' + (params.length + 1), typeof body.episode_title === 'string' && body.episode_title.trim() ? body.episode_title : null);
    }
    if (body.checkin_type !== undefined) {
      const v = typeof body.checkin_type === 'string' && CHECKIN_TYPES.has(body.checkin_type) ? body.checkin_type : null;
      if (v == null) return res.status(400).json({ error: 'checkin_type must be one of completed, in_progress, started, dropped' });
      add('checkin_type = $' + (params.length + 1), v);
    }
    if (body.rating !== undefined) {
      const v = typeof body.rating === 'number' && Number.isInteger(body.rating) && body.rating >= 0 && body.rating <= 4 ? body.rating : null;
      if (v == null && body.rating != null) return res.status(400).json({ error: 'rating must be an integer 0-4' });
      add('rating = $' + (params.length + 1), v);
    }
    if (body.raw_score !== undefined) {
      const v = body.raw_score != null && body.raw_score !== '' ? Number(body.raw_score) : null;
      if (v != null && !Number.isFinite(v)) return res.status(400).json({ error: 'raw_score must be a number' });
      add('raw_score = $' + (params.length + 1), v);
    }
    if (body.notes !== undefined) {
      add('notes = $' + (params.length + 1), typeof body.notes === 'string' && body.notes.trim() ? body.notes : null);
    }
    if (body.checked_in_at !== undefined) {
      const v = body.checked_in_at ? new Date(body.checked_in_at as string) : null;
      if (body.checked_in_at && (v == null || Number.isNaN(v.getTime()))) {
        return res.status(400).json({ error: 'checked_in_at must be a valid ISO timestamp' });
      }
      add('checked_in_at = $' + (params.length + 1) + (v ? '::timestamptz' : ''), v);
    }
    if (body.timezone !== undefined) {
      const v = typeof body.timezone === 'string' && body.timezone ? body.timezone : null;
      add('checkin_timezone = $' + (params.length + 1), v);
    }
    if (body.time_played_minutes !== undefined) {
      const v = typeof body.time_played_minutes === 'number' && Number.isFinite(body.time_played_minutes) && body.time_played_minutes >= 0
        ? Math.round(body.time_played_minutes) : null;
      add('time_played_minutes = $' + (params.length + 1), v);
    }

    if (sets.length === 0) {
      const existing = await query('SELECT * FROM media_checkins WHERE id = $1 AND user_id = $2', [req.params.id, USER_ID]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Media check-in not found' });
      return res.json({ ...existing.rows[0], companions: await getCompanions('media', String(req.params.id)) });
    }

    const idIdx = params.length + 1;
    const userIdx = idIdx + 1;
    params.push(req.params.id, USER_ID);
    const result = await query(
      `UPDATE media_checkins
       SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $${idIdx} AND user_id = $${userIdx}
       RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media check-in not found' });
    }
    // Companions use full-replacement semantics when the key is present.
    const companions = body.companions !== undefined
      ? await setCompanions('media', String(req.params.id), body.companions)
      : await getCompanions('media', String(req.params.id));
    res.json({ ...result.rows[0], companions });
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
    // The shared companion table has no FK into media_checkins; clean up explicitly.
    await deleteCompanionsForCheckins('media', [result.rows[0].id as string]);
    res.json({ message: 'Media check-in deleted', id: result.rows[0].id });
  } catch (err) {
    console.error('Error deleting media check-in:', err);
    res.status(500).json({ error: 'Failed to delete media check-in' });
  }
});

// POST /items/bulk-delete - delete multiple media items along with all of
// their check-ins and list memberships. With dryRun: true it only reports
// how many rows would be affected (used to build the confirmation dialog).
router.post('/items/bulk-delete', async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')
    : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array of media item ids' });
  }
  if (ids.length > 500) {
    return res.status(400).json({ error: 'Too many items to delete at once' });
  }
  const dryRun = req.body?.dryRun === true;

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');
    const found = await client.query(
      'SELECT COUNT(*)::int AS n FROM media_items WHERE user_id = $1 AND id = ANY($2)',
      [USER_ID, ids]
    );
    const checkins = await client.query(
      'SELECT COUNT(*)::int AS n FROM media_checkins WHERE user_id = $1 AND media_item_id = ANY($2)',
      [USER_ID, ids]
    );
    const memberships = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM media_list_items mli
       JOIN media_items mi ON mi.id = mli.media_item_id
       WHERE mi.user_id = $1 AND mi.id = ANY($2)`,
      [USER_ID, ids]
    );

    if (!dryRun) {
      // Pull the items out of every list, then delete them. Check-ins and
      // episode rows cascade off media_items.
      await client.query(
        `DELETE FROM media_list_items
         WHERE media_item_id IN (SELECT id FROM media_items WHERE user_id = $1 AND id = ANY($2))`,
        [USER_ID, ids]
      );
      // Companion rows ride on the check-ins; remove them before the check-ins go.
      await client.query(
        `DELETE FROM companions
         WHERE checkin_type = 'media'
           AND checkin_id IN (SELECT id FROM media_checkins
                              WHERE user_id = $1 AND media_item_id = ANY($2))`,
        [USER_ID, ids]
      );
      await client.query(
        'DELETE FROM media_items WHERE user_id = $1 AND id = ANY($2)',
        [USER_ID, ids]
      );
      await client.query('COMMIT');
    }

    res.json({
      deleted_items: found.rows[0].n as number,
      deleted_checkins: checkins.rows[0].n as number,
      deleted_list_memberships: memberships.rows[0].n as number,
    });
  } catch (err) {
    if (!dryRun) await client.query('ROLLBACK');
    console.error('Error bulk-deleting media items:', err);
    res.status(500).json({ error: 'Failed to delete media items' });
  } finally {
    client.release();
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
  prefetchedSeasons?: import('./services/tmdb').TmdbSeasonInfo[] | null
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

    // With no date range (period "all"), items without any check-ins are
    // included too; with a date range only items checked in during it appear.
    const includeUncheckedItems = !from && !to;

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
    const userCondition = includeUncheckedItems ? 'mi.user_id = $1' : 'mc.user_id = $1';
    const where = `WHERE ${userCondition} AND mi.media_type = ANY($2) ${dateConditions.length ? `AND ${dateConditions.join(' AND ')}` : ''}`;
    const join = includeUncheckedItems
      ? `LEFT JOIN media_checkins mc ON mc.media_item_id = mi.id AND mc.user_id = $1`
      : `JOIN media_checkins mc ON mc.media_item_id = mi.id`;

    const result = await query(
      `SELECT mi.id, mi.media_type, mi.title, mi.author, mi.image_url,
              mi.rating, mi.raw_score, mi.notes, mi.time_played_minutes, mi.status,
              (ARRAY_AGG(mc.rating ORDER BY mc.checked_in_at DESC, mc.id DESC) FILTER (WHERE mc.rating IS NOT NULL))[1] AS latest_checkin_rating,
              (ARRAY_AGG(mc.checked_in_at ORDER BY mc.checked_in_at DESC, mc.id DESC))[1] AS last_checkin_at,
              (ARRAY_AGG(mc.checkin_timezone ORDER BY mc.checked_in_at DESC, mc.id DESC))[1] AS last_checkin_timezone,
              (ARRAY_AGG(mc.checkin_type ORDER BY mc.checked_in_at DESC, mc.id DESC))[1] AS last_checkin_type,
              COUNT(*) FILTER (WHERE mc.checkin_type = 'completed') AS completed_count
       FROM media_items mi
       ${join}
       ${where}
       GROUP BY mi.id, mi.media_type, mi.title, mi.author, mi.image_url,
                mi.rating, mi.raw_score, mi.notes, mi.time_played_minutes, mi.status
       ORDER BY last_checkin_at DESC NULLS LAST`,
      params
    );

    res.json(result.rows.map((r) => ({
      id: r.id,
      media_type: r.media_type,
      title: r.title,
      author: r.author,
      image_url: r.image_url,
      rating: r.rating != null ? Number(r.rating) : null,
      raw_score: r.raw_score != null ? Number(r.raw_score) : null,
      notes: r.notes || null,
      time_played_minutes: r.time_played_minutes != null ? Number(r.time_played_minutes) : null,
      status: r.status || null,
      // Display rating: item rating if set, else the latest check-in's rating.
      latest_rating: r.rating != null
        ? Number(r.rating)
        : r.latest_checkin_rating != null ? Number(r.latest_checkin_rating) : null,
      last_checkin_at: r.last_checkin_at,
      last_checkin_timezone: r.last_checkin_timezone,
      last_checkin_type: r.last_checkin_type,
      completed_count: Number(r.completed_count),
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
              COALESCE(mi.rating, latest_mc.rating) AS rating,
              COUNT(*) FILTER (WHERE mc.checkin_type = 'completed') AS completed_count
       FROM media_checkins mc
       JOIN media_items mi ON mc.media_item_id = mi.id
       LEFT JOIN LATERAL (
         SELECT mc2.rating FROM media_checkins mc2
         WHERE mc2.media_item_id = mi.id AND mc2.rating IS NOT NULL
         ORDER BY mc2.checked_in_at DESC, mc2.id DESC LIMIT 1
       ) latest_mc ON true
       ${where}
       GROUP BY mi.id, mi.media_type, mi.title, mi.image_url, mi.author, latest_mc.rating
       HAVING COALESCE(mi.rating, latest_mc.rating) >= 3
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
                'image_url', mi.image_url, 'author', mi.author,
                'added_at', mli.added_at
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

// ---------------------------------------------------------------------------
// Plugin-owned API: /api/v1/webhook/plex
// (moved from server/src/routes/webhook-plex.ts; behavior unchanged — the
// webhook URL is user-configured in the Plex app and must stay stable)
// ---------------------------------------------------------------------------

const plexWebhookRouter = Router();

// Plex posts webhook payloads as multipart/form-data (a JSON part, sometimes
// with an attached JPEG poster). Memory storage keeps this simple; we only
// ever read the JSON part and ignore the binary poster.
const plexUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Infer the user's local timezone at the given reference time by examining
 * the most recent check-in timezone at or before the reference time, falling
 * back to 'UTC'. Same strategy as the Sleep as Android webhook: the loop
 * below asks every registered plugin (including this one, via its
 * latestTimezoneAsOf hook) for the timezone of its most recent check-in.
 */
async function inferPlexTimezone(referenceTime: Date): Promise<string> {
  for (const plugin of allPlugins()) {
    const hook = plugin.server.latestTimezoneAsOf;
    if (!hook) continue;
    const result = await query(hook().sql, [referenceTime.toISOString(), USER_ID]);
    const timezone = result.rows[0]?.timezone;
    if (timezone) {
      return timezone as string;
    }
  }

  return 'UTC';
}

/**
 * Split the stored plex_usernames filter into a normalized set of
 * lowercase, trimmed usernames. An empty/missing filter means "track all".
 */
function parseUsernameFilter(raw: string | null | undefined): Set<string> | null {
  if (!raw) return null;
  const names = raw
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0);
  return names.length > 0 ? new Set(names) : null;
}

interface PlexScrobble {
  mediaType: 'movie' | 'tv_show';
  title: string;
  externalSource: string | null;
  externalId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
}

/**
 * Extract the media check-in data from a Plex media.scrobble Metadata object.
 *
 * Movies map straight to a movie; episodes map to a tv_show (WhereWeWere
 * stores episodes as fields on the check-in row, not as entities). A
 * "tmdb://<id>" guid gives us an external identity to dedupe against; any
 * other guid scheme (plex://, hulu://, etc.) falls back to a title-only
 * local item.
 */
function extractScrobble(metadata: Record<string, unknown> | null | undefined): PlexScrobble | null {
  if (!metadata) return null;
  const type = metadata.type;
  const title =
    typeof metadata.title === 'string' && metadata.title.trim()
      ? metadata.title
      : null;
  if (!title) return null;

  const guid = typeof metadata.guid === 'string' ? metadata.guid : null;
  let externalSource: string | null = null;
  let externalId: string | null = null;
  if (guid && guid.startsWith('tmdb://')) {
    const id = guid.slice('tmdb://'.length);
    if (/^\d+$/.test(id)) {
      externalSource = 'tmdb';
      externalId = id;
    }
  }

  if (type === 'movie') {
    return {
      mediaType: 'movie',
      title,
      externalSource,
      externalId,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
    };
  }

  if (type === 'episode') {
    const seasonNumber =
      typeof metadata.parentIndex === 'number' && Number.isFinite(metadata.parentIndex)
        ? metadata.parentIndex
        : null;
    const episodeNumber =
      typeof metadata.index === 'number' && Number.isFinite(metadata.index)
        ? metadata.index
        : null;
    const episodeTitle =
      typeof metadata.title === 'string' && metadata.title.trim()
        ? metadata.title
        : null;
    const showTitle =
      typeof metadata.grandparentTitle === 'string' && metadata.grandparentTitle.trim()
        ? metadata.grandparentTitle
        : title;
    return {
      mediaType: 'tv_show',
      title: showTitle,
      externalSource,
      externalId,
      seasonNumber,
      episodeNumber,
      episodeTitle,
    };
  }

  return null;
}

// POST / - receive a Plex webhook event
plexWebhookRouter.post('/', plexUpload.any(), async (req: Request, res: Response) => {
  try {
    // Plex sends the JSON payload as a multipart part; accept a plain JSON
    // body too so the endpoint is easy to test with curl/supertest.
    let body: Record<string, unknown> | null = null;
    const files = (req.files ?? []) as Express.Multer.File[];
    const file = files.find(
      (f) => f.fieldname === 'payload' || f.fieldname === 'json' || f.originalname.toLowerCase().endsWith('.json')
    );
    if (file) {
      body = JSON.parse(file.buffer.toString('utf8'));
    } else if (req.is('application/json')) {
      body = (req.body as Record<string, unknown>) || {};
    }

    const event = body?.event;
    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid event field' });
    }

    const account = (body?.Account ?? {}) as Record<string, unknown>;
    const plexUsername = typeof account.title === 'string' ? account.title : null;

    // Log every event so the UI can display a received count.
    await query(
      `INSERT INTO plex_webhook_events (user_id, event, plex_username, raw_body)
       VALUES ($1, $2, $3, $4)`,
      [USER_ID, event, plexUsername, body]
    );

    if (event === 'media.scrobble') {
      // Username filter: only track media viewed by one of the configured
      // Plex users. An empty filter tracks everyone.
      const filter = parseUsernameFilter(await getPlexUsernames());
      if (filter && (!plexUsername || !filter.has(plexUsername.toLowerCase()))) {
        return res.json({ ok: true, skipped: 'username_filter' });
      }

      const scrobble = extractScrobble((body?.Metadata ?? null) as Record<string, unknown> | null);
      if (!scrobble) {
        return res.json({ ok: true, skipped: 'unsupported_metadata' });
      }

      const itemId = await upsertMediaItem({
        media_type: scrobble.mediaType,
        external_source: scrobble.externalSource,
        external_id: scrobble.externalId,
        title: scrobble.title,
      });

      const now = new Date();
      const timezone = await inferPlexTimezone(now);

      // A new check-in is created for every scrobble (no dedupe).
      await query(
        `INSERT INTO media_checkins
           (user_id, media_item_id, season_number, episode_number, episode_title,
            checkin_type, checked_in_at, checkin_timezone)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7)`,
        [
          USER_ID,
          itemId,
          scrobble.seasonNumber,
          scrobble.episodeNumber,
          scrobble.episodeTitle,
          now.toISOString(),
          timezone,
        ]
      );
    }
    // All other events are logged but require no media mutation.

    res.json({ ok: true });
  } catch (err) {
    console.error('Plex webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /stats - count of events received for this user
plexWebhookRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM plex_webhook_events WHERE user_id = $1',
      [USER_ID]
    );
    res.json({ count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    console.error('Plex webhook stats error:', err);
    res.status(500).json({ error: 'Failed to get webhook stats' });
  }
});

// ---------------------------------------------------------------------------
// Plugin contract (framework hooks)
// ---------------------------------------------------------------------------

/**
 * Coercion helpers (moved from the core backup route's media import loops):
 * values that violate column constraints are dropped rather than failing the
 * whole restore.
 */
function backupToStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function backupToIntOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function backupToStatusOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === 'completed' || v === 'in_progress' || v === 'started' || v === 'dropped' ? v : null;
}

function backupToStringArrayOrNull(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const names = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter((v) => v !== '');
  return names.length > 0 ? names : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Shared INSERT for media check-in rows (backup import + legacy restore). */
const MEDIA_CHECKIN_INSERT_SQL = `
  INSERT INTO media_checkins (
     id, user_id, media_item_id,
     season_number, episode_number, episode_title,
     checkin_type, rating, raw_score, notes,
     time_played_minutes,
     checked_in_at, checkin_timezone, external_event_id,
     created_at, updated_at
   )
   VALUES (
     $1, $2, $3,
     $4, $5, $6,
     $7, $8, $9, $10,
     $11,
     COALESCE($12::timestamptz, NOW()), $13, $14,
     COALESCE($15::timestamptz, NOW()),
     COALESCE($16::timestamptz, NOW())
   )
   ON CONFLICT (id) DO NOTHING`;

function mediaCheckinInsertParams(
  user_id: string,
  row: Record<string, unknown>,
): unknown[] {
  return [
    row.id,
    user_id,
    row.media_item_id,
    row.season_number != null ? Number(row.season_number) : null,
    row.episode_number != null ? Number(row.episode_number) : null,
    backupToStringOrNull(row.episode_title),
    row.checkin_type,
    row.rating != null ? Number(row.rating) : null,
    row.raw_score != null ? String(row.raw_score) : null,
    backupToStringOrNull(row.notes),
    backupToIntOrNull(row.time_played_minutes),
    row.checked_in_at || null,
    // Parity with the pre-plugin core import: a missing label is stored as UTC.
    backupToStringOrNull(row.checkin_timezone) || 'UTC',
    backupToStringOrNull(row.external_event_id),
    row.created_at || null,
    row.updated_at || null,
  ];
}

/** Shared INSERT for media_items rows (backup import + legacy restore). */
const MEDIA_ITEM_INSERT_SQL = `
  INSERT INTO media_items (
     id, user_id, media_type, external_source, external_id,
     title, author, release_year, image_url, external_url,
     platform, overview, content_rating, players, coop,
     genres, developers, publishers,
     page_count, series_name, series_position, series_count,
     rating, raw_score, notes, time_played_minutes, status,
     created_at, updated_at
   )
   VALUES (
     $1, $2, $3, $4, $5,
     $6, $7, $8, $9, $10,
     $11, $12, $13, $14, $15,
     $16, $17, $18, $19, $20,
     $21, $22, $23, $24, $25, $26, $27,
     COALESCE($28::timestamptz, NOW()), COALESCE($29::timestamptz, NOW())
   )
   ON CONFLICT (id) DO NOTHING`;

function mediaItemInsertParams(user_id: string, row: Record<string, unknown>): unknown[] {
  return [
    row.id,
    user_id,
    row.media_type,
    backupToStringOrNull(row.external_source),
    backupToStringOrNull(row.external_id),
    row.title,
    backupToStringOrNull(row.author),
    row.release_year != null ? Number(row.release_year) : null,
    backupToStringOrNull(row.image_url),
    backupToStringOrNull(row.external_url),
    backupToStringOrNull(row.platform),
    backupToStringOrNull(row.overview),
    backupToStringOrNull(row.content_rating),
    row.players != null && Number(row.players) > 0 ? Math.round(Number(row.players)) : null,
    backupToStringOrNull(row.coop),
    backupToStringArrayOrNull(row.genres),
    backupToStringArrayOrNull(row.developers),
    backupToStringArrayOrNull(row.publishers),
    backupToIntOrNull(row.page_count),
    backupToStringOrNull(row.series_name),
    backupToIntOrNull(row.series_position),
    backupToIntOrNull(row.series_count),
    row.rating != null ? Number(row.rating) : null,
    row.raw_score != null ? String(row.raw_score) : null,
    backupToStringOrNull(row.notes),
    backupToIntOrNull(row.time_played_minutes),
    backupToStatusOrNull(row.status),
    row.created_at || null,
    row.updated_at || null,
  ];
}

/**
 * detailPath for the reconcile hook: the framework calls it synchronously
 * with only the check-in id, so loadCheckins populates this cache with the
 * item-based path (/media/<segment>/<itemId>/<slug>) for every row it sees.
 */
const reconcileDetailPaths = new Map<string, string>();

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: [
    { mount: '/media', router },
    { mount: '/webhook/plex', router: plexWebhookRouter },
  ],

  // ------------------------------------------------------------------
  // Unified timeline (branch moved verbatim from the core timeline route's
  // hard-coded 'media' branch; media_subtype scoping now arrives via
  // this plugin's declared filterParams).
  // ------------------------------------------------------------------
  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'media'`,
        id: 'mmc.id',
        user_id: 'mmc.user_id',
        notes: 'mmc.notes',
        checked_in_at: 'mmc.checked_in_at',
        created_at: 'mmc.created_at',
        media_type: 'mi.media_type',
        media_item_id: 'mi.id',
        media_title: 'mi.title',
        media_image_url: 'mi.image_url',
        media_author: 'mi.author',
        media_rating: 'mmc.rating',
        media_checkin_type: 'mmc.checkin_type',
        media_season_number: 'mmc.season_number',
        media_episode_number: 'mmc.episode_number',
        media_episode_title: 'mmc.episode_title',
        media_timezone: 'mmc.checkin_timezone',
        timezone: 'mmc.checkin_timezone',
        companions: `(${companionNamesSql('media', 'mmc.id')})`,
      })}
      FROM media_checkins mmc
      JOIN media_items mi ON mmc.media_item_id = mi.id
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'mmc',
      timestampColumn: 'checked_in_at',
      timezoneColumn: 'checkin_timezone',
      search: (c, q) =>
        c.push(`(mi.title ILIKE '%' || ? || '%' OR mmc.notes ILIKE '%' || ? || '%')`, q, q),
    });
    if (ctx.filterParams.media_subtype) {
      const subtypes = ctx.filterParams.media_subtype
        .split(',')
        .map((s) => s.trim())
        .filter((s) => MEDIA_TYPES.has(s));
      if (subtypes.length > 0) {
        conds.push('mi.media_type = ANY(?::text[])', subtypes);
      }
    }
    return conds.build();
  },

  // ------------------------------------------------------------------
  // Backup: media_items are the 'primary' payload (check-ins and list items
  // reference them), media_checkins rides along as an extra table, then
  // lists, then list memberships. media_tv_episodes is a provider cache and
  // is NOT backed up (matching pre-plugin behavior).
  //
  // Note on parameter alignment: the framework feeds extra-table inserts
  // Object.values(row) in the SELECT's column order, so each select below
  // lists user_id exactly where the insert expects it.
  // ------------------------------------------------------------------
  extraBackupTables: [
    {
      table: 'mediaCheckins',
      select: `SELECT id, user_id, media_item_id,
                season_number, episode_number, episode_title,
                checkin_type, rating, raw_score, notes, time_played_minutes,
                checked_in_at, checkin_timezone, external_event_id,
                created_at, updated_at
         FROM media_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
      insert: MEDIA_CHECKIN_INSERT_SQL,
      userIdFirst: false,
    },
    {
      // Companion rows for this user's media check-ins (shared core table;
      // restored after the check-ins they reference).
      table: 'mediaCheckinCompanions',
      select: `SELECT cc.checkin_id, cc.name
               FROM companions cc
               JOIN media_checkins mc ON mc.id = cc.checkin_id
               WHERE cc.checkin_type = 'media' AND mc.user_id = $1
               ORDER BY cc.checkin_id, cc.name`,
      insert: `INSERT INTO companions (checkin_type, checkin_id, name)
               VALUES ('media', $1, $2)
               ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING`,
      userIdFirst: false,
    },
    {
      table: 'mediaLists',
      select: `SELECT id, user_id, name, created_at, updated_at
               FROM media_lists WHERE user_id = $1 ORDER BY created_at`,
      insert: `INSERT INTO media_lists (id, user_id, name, created_at, updated_at)
               VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
               ON CONFLICT (id) DO NOTHING`,
      userIdFirst: false,
    },
    {
      table: 'mediaListItems',
      select: `SELECT mli.list_id, mli.media_item_id, mli.position, mli.added_at
               FROM media_list_items mli
               JOIN media_lists ml ON ml.id = mli.list_id
               WHERE ml.user_id = $1 ORDER BY ml.created_at, mli.position`,
      insert: `INSERT INTO media_list_items (list_id, media_item_id, position, added_at)
               VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
               ON CONFLICT (list_id, media_item_id) DO NOTHING`,
      userIdFirst: false,
    },
  ],

  // FK order: items (primary) -> check-ins -> check-in companions -> lists -> list memberships
  backupOrder: ['primary', 'mediaCheckins', 'mediaCheckinCompanions', 'mediaLists', 'mediaListItems'],

  // Old backups (no plugins payload) keep media rows under these top-level
  // keys; when a plugins.media payload is present the core skips these.
  legacyBackupKeys: ['mediaItems', 'mediaCheckins', 'mediaLists', 'mediaListItems'],

  backupExport: async ({ user_id }) => {
    const result = await query(
      `SELECT id, media_type, external_source, external_id,
              title, author, release_year, image_url, external_url,
              platform, overview, content_rating, players, coop,
              genres, developers, publishers,
              page_count, series_name, series_position, series_count,
              rating, raw_score, notes, time_played_minutes, status,
              created_at, updated_at
       FROM media_items WHERE user_id = $1
       ORDER BY created_at ASC, title ASC`,
      [user_id],
    );
    return result.rows;
  },

  backupImport: async ({ user_id, client: txClient }, payload) => {
    const rows = asRecordArray(payload);
    let inserted = 0;
    // Use the framework's transaction client when provided so restore stays
    // atomic; open our own connection only when running standalone.
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    try {
      for (const row of rows) {
        if (!row?.id || !row.media_type || !row.title) continue;
        const result = await client.query(MEDIA_ITEM_INSERT_SQL, mediaItemInsertParams(user_id, row));
        if ((result.rowCount ?? 0) > 0) inserted++;
      }
    } finally {
      if (ownsClient) client.release();
    }
    return inserted;
  },

  /**
   * Legacy backup restore (backups without a plugins.media payload keep
   * media rows under the top-level mediaItems / mediaCheckins / mediaLists /
   * mediaListItems keys). Mirrors the pre-plugin core import loops exactly,
   * including per-row validation and the FK ordering (items -> check-ins ->
   * lists -> list memberships).
   */
  restoreLegacyBackup: async ({ user_id, client: txClient }, data) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    const counts: Record<string, { inserted: number; skipped: number }> = {
      mediaItems: { inserted: 0, skipped: 0 },
      mediaCheckins: { inserted: 0, skipped: 0 },
      mediaLists: { inserted: 0, skipped: 0 },
      mediaListItems: { inserted: 0, skipped: 0 },
    };

    for (const item of asRecordArray(data.mediaItems)) {
      if (!item?.id || !item.media_type || !item.title) {
        counts.mediaItems.skipped += 1;
        continue;
      }
      const result = await run(MEDIA_ITEM_INSERT_SQL, mediaItemInsertParams(user_id, item));
      (result.rowCount ?? 0) === 1 ? counts.mediaItems.inserted += 1 : counts.mediaItems.skipped += 1;
    }

    for (const checkin of asRecordArray(data.mediaCheckins)) {
      if (!checkin?.id || !checkin.media_item_id) {
        counts.mediaCheckins.skipped += 1;
        continue;
      }
      const result = await run(MEDIA_CHECKIN_INSERT_SQL, mediaCheckinInsertParams(user_id, checkin));
      (result.rowCount ?? 0) === 1 ? counts.mediaCheckins.inserted += 1 : counts.mediaCheckins.skipped += 1;
    }

    for (const list of asRecordArray(data.mediaLists)) {
      if (!list?.id || !list.name) {
        counts.mediaLists.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO media_lists (id, user_id, name, created_at, updated_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), COALESCE($5::timestamptz, NOW()))
         ON CONFLICT (id) DO NOTHING`,
        [list.id, user_id, list.name, list.created_at || null, list.updated_at || null],
      );
      (result.rowCount ?? 0) === 1 ? counts.mediaLists.inserted += 1 : counts.mediaLists.skipped += 1;
    }

    for (const listItem of asRecordArray(data.mediaListItems)) {
      if (!listItem?.list_id || !listItem.media_item_id) {
        counts.mediaListItems.skipped += 1;
        continue;
      }
      const result = await run(
        `INSERT INTO media_list_items (list_id, media_item_id, position, added_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()))
         ON CONFLICT (list_id, media_item_id) DO NOTHING`,
        [listItem.list_id, listItem.media_item_id, Number(listItem.position) || 0, listItem.added_at || null],
      );
      (result.rowCount ?? 0) === 1 ? counts.mediaListItems.inserted += 1 : counts.mediaListItems.skipped += 1;
    }

    return counts;
  },

  // Start-over: delete all locally stored media (check-ins, list items,
  // cached episodes, items, lists, and the Plex event log). plugin_settings
  // rows are wiped by the framework itself.
  deleteUserData: async ({ user_id, client: txClient }) => {
    const client = txClient ?? null;
    const run = (sql: string, values: unknown[]) =>
      client ? client.query(sql, values) : query(sql, values);
    let deleted = 0;
    // Companion rows for this user's media check-ins (shared core table).
    {
      const result = await run(
        `DELETE FROM companions WHERE checkin_type = 'media' AND checkin_id IN (SELECT id FROM media_checkins WHERE user_id = $1) RETURNING id`,
        [user_id],
      );
      deleted += result.rowCount ?? 0;
    }
    for (const sql of [
      'DELETE FROM media_checkins WHERE user_id = $1 RETURNING id',
      'DELETE FROM media_list_items WHERE list_id IN (SELECT id FROM media_lists WHERE user_id = $1) RETURNING list_id',
      'DELETE FROM media_tv_episodes WHERE media_item_id IN (SELECT id FROM media_items WHERE user_id = $1) RETURNING id',
      'DELETE FROM media_items WHERE user_id = $1 RETURNING id',
      'DELETE FROM media_lists WHERE user_id = $1 RETURNING id',
      'DELETE FROM plex_webhook_events WHERE user_id = $1 RETURNING id',
    ]) {
      const result = await run(sql, [user_id]);
      deleted += result.rowCount ?? 0;
    }
    return deleted;
  },

  settingsKeys: [
    { name: 'tmdb_api_key', type: 'string', label: 'TMDB API key' },
    { name: 'tgdb_api_key', type: 'string', label: 'TheGamesDB API key' },
    { name: 'hardcover_api_key', type: 'string', label: 'Hardcover API key' },
    { name: 'plex_usernames', type: 'string', label: 'Plex usernames to track' },
  ],

  // Old backups still carry these in settings.*; restoring them writes the
  // values into plugin_settings instead of the (now removed) user_settings
  // columns.
  legacySettingsKeys: ['tmdb_api_key', 'tgdb_api_key', 'hardcover_api_key', 'plex_usernames'],

  // ------------------------------------------------------------------
  // Cross-cutting service hooks
  // ------------------------------------------------------------------

  // Photo/scrobble anchor timestamps for Immich and Maloja enrichment.
  resolveTimestamps: () => ({
    sql: 'SELECT id, checked_in_at FROM media_checkins WHERE id = ANY($1::uuid[])',
  }),

  // "This day in previous years" reflection branch. Emits the shared
  // reflection envelope (matching the location/mood/sleep branches) so the
  // UNION in /stats/reflections lines up; the media payload lives in `data`
  // for the plugin's reflection card.
  reflectionBranch: () => ({
    sql: `
      SELECT
        'media' AS type,
        mc.id,
        mc.checked_in_at,
        mc.notes AS note,
        NULL::uuid AS venue_id,
        NULL::text AS venue_name,
        NULL::text AS city,
        NULL::text AS country,
        NULL::double precision AS latitude,
        NULL::double precision AS longitude,
        NULL::text AS venue_category,
        NULL::text AS venue_timezone,
        EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.checkin_timezone, 'UTC'))::int AS reflection_year,
        (
          EXTRACT(YEAR FROM $2::date)::int
          - EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.checkin_timezone, 'UTC'))::int
        )::int AS years_ago,
        json_build_object(
          'media_type', mi.media_type,
          'media_item_id', mi.id,
          'media_title', mi.title,
          'media_image_url', mi.image_url,
          'media_author', mi.author,
          'rating', mc.rating,
          'checkin_type', mc.checkin_type,
          'season_number', mc.season_number,
          'episode_number', mc.episode_number,
          'episode_title', mc.episode_title,
          'time_played_minutes', mc.time_played_minutes,
          'checkin_timezone', mc.checkin_timezone
        )::jsonb AS data
      FROM media_checkins mc
      JOIN media_items mi ON mc.media_item_id = mi.id
      WHERE mc.user_id = $1
        AND TO_CHAR(mc.checked_in_at AT TIME ZONE COALESCE(mc.checkin_timezone, 'UTC'), 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM mc.checked_in_at AT TIME ZONE COALESCE(mc.checkin_timezone, 'UTC'))
            < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  // LLM life summary contribution.
  llm: {
    label: 'media check-ins',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT mc.checked_in_at, mc.checkin_timezone AS timezone,
                json_build_object(
                  'media_type', mi.media_type,
                  'title', mi.title,
                  'author', mi.author,
                  'checkin_type', mc.checkin_type,
                  'rating', mc.rating,
                  'season_number', mc.season_number,
                  'episode_number', mc.episode_number,
                  'episode_title', mc.episode_title,
                  'time_played_minutes', mc.time_played_minutes,
                  'note', mc.notes
                )::jsonb AS data
         FROM media_checkins mc
         JOIN media_items mi ON mc.media_item_id = mi.id
         WHERE mc.user_id = $1
           AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.checkin_timezone, 'UTC'))::date >= $2::date
           AND (mc.checked_in_at AT TIME ZONE COALESCE(mc.checkin_timezone, 'UTC'))::date <= $3::date
         ORDER BY mc.checked_in_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row: PluginLlmRow) => {
      const d = row.data as {
        media_type: string;
        title: string;
        author: string | null;
        checkin_type: string;
        rating: number | null;
        season_number: number | null;
        episode_number: number | null;
        episode_title: string | null;
        time_played_minutes: number | null;
        note: string | null;
      };
      const when = formatLlmWhen(row.checked_in_at, row.timezone);
      const status = MEDIA_LLM_CHECKIN_LABELS[d.checkin_type] ?? d.checkin_type;
      const typeLabel = MEDIA_LLM_TYPE_LABELS[d.media_type] ?? d.media_type;
      const author = d.author ? ` by ${d.author}` : '';
      const episode =
        d.season_number != null && d.episode_number != null
          ? ` S${d.season_number}E${d.episode_number}${d.episode_title ? ` "${d.episode_title}"` : ''}`
          : '';
      const rating = d.rating != null ? ` (${d.rating}/5)` : '';
      const time =
        d.time_played_minutes != null && d.time_played_minutes > 0
          ? ` · ${formatLlmMinutes(Number(d.time_played_minutes))}`
          : '';
      const note = d.note ? ` — note: "${d.note}"` : '';
      return [
        `- ${when} — ${status} ${typeLabel} "${d.title}"${author}${episode}${rating}${time}${note}`,
      ];
    },
  },

  // Timezone inference for integrations (the Plex webhook above loops every
  // plugin's hook; this one covers media check-ins).
  latestTimezoneAsOf: () => ({
    sql: `SELECT checkin_timezone AS timezone
          FROM media_checkins
          WHERE user_id = $2
            AND checkin_timezone IS NOT NULL
            AND checked_in_at <= $1
          ORDER BY checked_in_at DESC
          LIMIT 1`,
  }),

  // Timestamp reconciliation participation. Media-style scan (scanAll:
  // false): the framework only scans rows stored without a timezone or with
  // a UTC timezone (imports like Yamtrack and the Plex webhook write UTC),
  // but loadCheckins returns ALL rows so the valid-timezone ones still serve
  // as anchors for each other.
  reconcile: {
    anchorLabel: 'a media check-in',
    scanAll: false,
    detailPath: (id) => reconcileDetailPaths.get(id) ?? `/media-checkins/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT mc.id, mc.checked_in_at, mc.checkin_timezone AS original_timezone,
                mi.media_type, mi.id AS media_item_id, mi.title AS media_title
         FROM media_checkins mc
         JOIN media_items mi ON mc.media_item_id = mi.id
         WHERE mc.user_id = $1
         ORDER BY mc.checked_in_at ASC`,
        [user_id],
      );
      // The framework's row type has no place for the extra columns; they
      // are only needed to build the item-based detail path. Populate the
      // detailPath cache and keep the rows in scan order.
      reconcileDetailPaths.clear();
      for (const row of result.rows as Record<string, unknown>[]) {
        reconcileDetailPaths.set(
          String(row.id),
          buildMediaDetailPath(String(row.media_type), String(row.media_item_id), row.media_title == null ? null : String(row.media_title)),
        );
      }
      return result.rows as PluginReconciliationRow[];
    },
    apply: async (id, suggested_timezone) => {
      // Label-only: the stored instant is the true moment; reconciliation
      // only corrects the stored timezone label.
      const result = await query(
        `UPDATE media_checkins
         SET checkin_timezone = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, suggested_timezone],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },
};

