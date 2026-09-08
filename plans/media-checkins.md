# Media Check-Ins — Architecture & Implementation Plan

## 1. Overview

Adds a new **Media** check-in type covering five subtypes: **movie, tv_show, game, book, board_game**.
Media check-ins appear on the Home timeline as cards, are filterable via a new Media filter,
have detail pages, support a 0-4 star rating + markdown notes + timezone-aware timestamps,
can be added to named lists, and include a Yamtrack CSV import.

Confirmed product decisions:
- TV row click → intermediate **episode picker** (season dropdown + episode list with TMDB-fetched titles) before navigating to the episode check-in page.
- Media Lists are managed in a **Lists section under the Media Profile tab**.
- Yamtrack import: **import everything** — `tv`/`season` rows create TV show entities (no check-in); `episode` rows become Completed episode check-ins timed at `end_date` (tz=UTC). Episode rows are duplicates only when `media_id`, season, episode, **and** `end_date` all match — the same episode with a different `end_date` is a rewatch and stays; movies/games/books with Completed/In progress/Dropped become check-ins timed at `end_date`; Planning/Paused rows create the media entity only. **`start_date` is ignored entirely for check-in time.** Every row's disposition is shown in the import table.
- Yamtrack 0-10 scores stored as-is in `raw_score`; 0-4 star `rating` derived: `10 → 4`, `7.5–9.99 → 3`, `5–7.49 → 2`, `2.5–4.99 → 1`, else `0`.

## 2. Data Model (migration `033_media_checkins.sql`)

```sql
-- Local media database: entities found via API search OR added custom.
-- Doubles as the local cache so repeated searches don't hit external APIs.
CREATE TABLE media_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv_show','game','book','board_game')),
    external_source TEXT CHECK (external_source IN ('tmdb','tgdb','hardcover')),  -- NULL for custom/board games
    external_id TEXT,
    title TEXT NOT NULL,
    author TEXT,              -- books
    release_year INTEGER,
    image_url TEXT,
    external_url TEXT,        -- link to TMDB/TGDB/Hardcover page
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || COALESCE(author,''))) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Dedupe API-sourced entities
CREATE UNIQUE INDEX idx_media_items_external ON media_items(user_id, media_type, external_source, external_id)
    WHERE external_source IS NOT NULL;
CREATE INDEX idx_media_items_title ON media_items(user_id, media_type, title);

-- Cached TMDB season/episode info for the episode picker (avoids repeated API calls)
CREATE TABLE media_tv_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,  -- the show
    season_number INT NOT NULL,
    episode_number INT NOT NULL,
    episode_title TEXT,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (media_item_id, season_number, episode_number)
);

-- Check-in events
CREATE TABLE media_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season_number INT,        -- tv only
    episode_number INT,       -- tv only
    episode_title TEXT,
    checkin_type TEXT NOT NULL CHECK (checkin_type IN ('completed','in_progress','dropped')),
    rating SMALLINT CHECK (rating BETWEEN 0 AND 4),
    raw_score NUMERIC(4,2),   -- Yamtrack 0-10
    notes TEXT,
    checked_in_at TIMESTAMPTZ NOT NULL,
    checkin_timezone TEXT NOT NULL,
    external_event_id TEXT,   -- dedupe key for Yamtrack import
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_media_checkins_external_event UNIQUE (user_id, external_event_id)
        WHERE external_event_id IS NOT NULL
);
CREATE INDEX idx_media_checkins_user_time ON media_checkins(user_id, checked_in_at DESC);
CREATE INDEX idx_media_checkins_media ON media_checkins(media_item_id, checked_in_at DESC);

-- Lists
CREATE TABLE media_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE media_list_items (
    list_id UUID NOT NULL REFERENCES media_lists(id) ON DELETE CASCADE,
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (list_id, media_item_id)
);

ALTER TABLE user_settings ADD COLUMN tmdb_api_key VARCHAR(200);
ALTER TABLE user_settings ADD COLUMN tgdb_api_key VARCHAR(200);
ALTER TABLE user_settings ADD COLUMN hardcover_api_key VARCHAR(200);
```

Design notes:
- **TV shows are entities; episodes live on the check-in row.** This matches the URL scheme
  (`/media-check-in/tv/<showID>/<slug>/<season>/<episode>`) and avoids thousands of episode
  entities — only watched episodes get rows.
- A board game is always `external_source IS NULL` (local-only per spec).
- Re-watches are separate rows (Yamtrack has multiple Avatar rows — all preserved).

## 3. Server

### 3.1 New services
| File | Responsibility |
|---|---|
| `server/src/services/mediaApi.ts` | Generic in-memory TTL cache (e.g. 1h) + per-key concurrency guard for all three APIs. Never call external API if the local DB already has the entity (dedupe by `external_source+external_id`). |
| `server/src/services/tmdb.ts` | `searchMovies(q)`, `searchTv(q)`, `getShowSeasons(tmdbId)`, `getShowEpisodes(tmdbId, season)` → upsert into `media_items` / `media_tv_episodes`. |
| `server/src/services/tgdb.ts` | `searchGames(q)`. Graceful degradation: if TGDB is unreachable/no key, return local-only results and a warning flag in the response. |
| `server/src/services/hardcover.ts` | `searchBooks(q)` via Hardcover API (Bearer token). Same graceful degradation. |

**API-overload protection:**
- Search results from external APIs are **not** persisted on search; only the chosen entity (and cached episodes) are upserted into the local DB.
- In-memory response cache keyed by `(source, endpoint, params)` with a 60-min TTL; single-flight (dedupe in-flight identical requests).
- Search merges: local `media_items` matches (tsvector/ILIKE) + external matches not already local, tagged `source: 'local' | 'tmdb' | ...`.

### 3.2 New routes (all under `server/src/routes/`)
- `media.ts` (mounted at `/api/v1/media`):
  - `GET /search?type=movie|tv_show|game|book|board_game&q=...` → merged results
  - `POST /items` → create custom item (Add Custom row)
  - `GET /items/:id` → item + aggregate stats (most recent check-in date, latest rating)
  - `GET /items/:id/checkins` → check-in table for detail page
  - `POST /items/:id/checkins` → create check-in (body: `season_number?, episode_number?, episode_title?, checkin_type, rating, raw_score?, notes, checked_in_at, timezone`); **server infers nothing** — client sends `Intl.DateTimeFormat().resolvedOptions().timeZone`
  - `PUT /checkins/:id`, `DELETE /checkins/:id`
  - `GET /tv/:itemId/seasons` → cached seasons/episodes (fetch from TMDB + cache on miss)
  - `GET /stats?from&to` → Profile Media stats
  - `GET /lists`, `POST /lists`, `PUT /lists/:id` (rename), `DELETE /lists/:id`
  - `POST /lists/:id/items`, `DELETE /lists/:id/items/:itemId`
  - `GET /tv/:itemId/seasons` upserts `media_tv_episodes` (cached; re-fetch only if cache is >30 days old and TMDB key present)
- `import-yamtrack.ts` (mounted at `/api/v1/import/yamtrack`):
  - `POST /preview` (CSV body) → parse + classify every row, return per-row disposition **without writing**
  - `POST /import` (CSV body) → transactional upsert of entities + check-ins; `ON CONFLICT DO NOTHING` on the unique constraints so re-imports never duplicate; returns the same per-row table, now with links to check-in detail pages
- `timeline.ts` → add a 5th `media` branch to the UNION (see §4), filter param `media_subtype` (comma list).
- `settings.ts` → add the three API keys to GET/PUT (stored in `user_settings` like existing keys).

### 3.3 Yamtrack row classification (preview + import share one classifier)
| Row shape | Disposition |
|---|---|
| `media_type = tv` or `season` | Upsert `tv_show` media_item (tmdb, `media_id`). No check-in. |
| `media_type = episode` | Duplicate only when `(media_id, source, season, episode, end_date)` all match (first occurrence wins). Insert Completed episode check-in, `checked_in_at = end_date`, `checkin_timezone='UTC'`. `external_event_id = sha1(media_id|source|episode|s|e|checked_in_at)`. Rows without `end_date` create the TV show entity only. |
| `movie/game/book` + status Completed / In progress / Dropped | Upsert media_item; insert check-in with mapped type, `end_date` as `checked_in_at` (tz=UTC), notes, score mapping. `external_event_id = sha1(media_id|source|type|end_date)`. Rows with no `end_date` → entity only. `start_date` is ignored. |
| `movie/game/book` + status Planning / Paused | Upsert media_item only. |
| Game rows from Yamtrack use `source = igdb` in the CSV but are stored with `external_source = 'tgdb'` (per spec, games are TGDB-sourced; `media_id` is kept as `external_id` for dedupe). | |

Score mapping: `10 → 4`, `7.5–9.99 → 3`, `5–7.49 → 2`, `2.5–4.99 → 1`, else `0`; `raw_score` always stored.

## 4. Timeline / Home

- `TimelineItem` gains `type: 'media'` with fields: `media_item_id`, `media_type`, `media_title`,
  `media_image_url`, `media_rating`, `media_checkin_type`, `media_season_number`, `media_episode_number`,
  `media_episode_title`, `media_slug`, `media_timezone`.
- New **MediaFilter** (`client/src/components/filters/MediaFilter.tsx`) mirroring `TrackFilter`:
  include toggle + five subtype checkboxes (movie / tv show / game / book / board game) → `media_subtype=movie,book`.
- New **MediaCard** (`client/src/components/MediaCard.tsx`) for the timeline: image, title
  (+ S/E for tv, author for books), check-in type badge, stars, notes preview, timestamp link.
- Submitting a check-in → navigate to the detail page (per spec).

## 5. Client routes & pages

```
/media-check-in/movie            → MediaCheckIn.tsx  (search screen)
/media-check-in/movie/:id/:slug  → MovieCheckInForm  (check-in form)
/media-check-in/tv-episode       → MediaTvSearch     (search screen)
/media-check-in/tv/:id/:slug     → TvEpisodePicker   (season dropdown + episode list)
/media-check-in/tv/:id/:slug/:season/:episode → TvEpisodeCheckInForm
/media-check-in/game             → MediaCheckIn.tsx  (game)
/media-check-in/game/:id/:slug   → GameCheckInForm
/media-check-in/book             → MediaCheckIn.tsx  (book)
/media-check-in/book/:id/:slug   → BookCheckInForm
/media-check-in/board-game       → MediaCheckIn.tsx  (board game, local-only search)
/media-check-in/board-game/:id/:slug → BoardGameCheckInForm

/media/movie/:id/:slug           → MediaDetail.tsx   (movie detail)
/media/tv/:id/:slug              → MediaDetail.tsx   (show detail)
/media/game/:id/:slug            → MediaDetail.tsx
/media/book/:id/:slug            → MediaDetail.tsx
/media/board-game/:id/:slug      → MediaDetail.tsx
```

- `client/src/pages/media/` — shared `MediaSearchPage` (search field + results table + Add Custom row),
  `MediaCheckInFormPage` (title, image, 0-4 `ScorePicker`, datetime-local input defaulting to now,
  type dropdown, `Notes.md` textarea reusing the markdown note rendering, submit → detail page),
  `TvEpisodePickerPage`, `MediaDetailPage` (info, **Add to Timeline** button → relevant check-in form,
  **Add to List** button → modal with list picker + create-new, check-in table whose Date cells
  link to `/?from=YYYY-MM-DD&to=YYYY-MM-DD` in a new tab).
- `Slugify` util for URL-safe titles; routes match on `:id` only (slug ignored server-side but kept for readability).
- Check-in pages infer device timezone client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone`
  and send it with `checked_in_at`; server stores it verbatim (pattern consistent with `checkin_timezone`).
- Home FAB gets a Media check-in entry (or expand to the 5 subtypes).
- `Settings` → Integrations tab: three new blocks (TMDB, TGDB, Hardcover) with API key inputs +
  "Get a key" links to the service sites.
- `Settings` → Data tab: new `YamtrackImportSection` (upload CSV → preview table with per-row
  disposition → confirm → import table with links to check-in detail pages; re-import is idempotent).
- Profile: new **Media** tab → `MediaTab` with `PeriodRangeSelector` (same control as other tabs),
  stats (TV episodes completed, movies watched, books completed, games completed, board games
  completed, top-rated media list), and the **Lists** section (create/rename/delete lists,
  add/remove items with thumbnails).
- "Add Custom" row at the bottom of each search results table: expands an inline form
  (title, author for books, year, optional image URL) → `POST /media/items` → navigate to its form.

## 6. Search merge & cache behavior (no external API overload)

```
User searches "Blade Runner"
  ├── local: SELECT * FROM media_items WHERE type='movie' AND search_vector @@ ...
  ├── local history: SELECT max(checked_in_at), rating FROM media_checkins joined
  │                  (drives "last watched" + "my rating" columns)
  └── external (only if tmdb key set):
        ├── in-memory cache hit (60 min TTL)? → use it
        └── miss → GET tmdb /search/movie?query=... (single-flight)
Results merged: local rows first (flagged), then unseen external rows.
Clicking a row upserts the external entity into media_items (once).
Episode picker fetches seasons/episodes from TMDB, cached in media_tv_episodes (30-day staleness).
```

## 7. Test plan
- Server: unit tests for the Yamtrack classifier (all row shapes, duplicates, score mapping,
  idempotent re-import); integration test for `POST /media/items` + check-ins + timeline `media`
  branch + `media_subtype` filter; service tests with mocked fetch for tmdb/tgdb/hardcover
  (cache hit, single-flight, graceful degradation).
- Client: tests for `ScorePicker`, episode picker flow (mock API), MediaFilter state,
  YamtrackImportSection preview → import flow.
