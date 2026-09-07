-- ============================================================================
-- Media check-ins: movies, TV shows, video games, books, and board games.
--
-- media_items is the local media database. It doubles as the cache for
-- external API lookups (TMDB/TGDB/Hardcover) so repeated searches never hit
-- the network. Board games are always local-only (external_source NULL).
--
-- TV shows are entities; individual episodes live on the check-in row
-- (season_number/episode_number) rather than as separate entities.
-- ============================================================================

CREATE TABLE media_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv_show','game','book','board_game')),
    external_source TEXT CHECK (external_source IN ('tmdb','tgdb','hardcover')),
    external_id TEXT,
    title TEXT NOT NULL,
    author TEXT,
    release_year INTEGER,
    image_url TEXT,
    external_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dedupe API-sourced entities per user.
CREATE UNIQUE INDEX idx_media_items_external ON media_items(user_id, media_type, external_source, external_id)
    WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX idx_media_items_user_type ON media_items(user_id, media_type);
CREATE INDEX idx_media_items_title ON media_items(user_id, media_type, title);

-- Cached TMDB season/episode info for the episode picker.
CREATE TABLE media_tv_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season_number INT NOT NULL,
    episode_number INT NOT NULL,
    episode_title TEXT,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (media_item_id, season_number, episode_number)
);
CREATE INDEX idx_media_tv_episodes_item ON media_tv_episodes(media_item_id);

-- Check-in events.
CREATE TABLE media_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season_number INT,
    episode_number INT,
    episode_title TEXT,
    checkin_type TEXT NOT NULL CHECK (checkin_type IN ('completed','in_progress','dropped')),
    rating SMALLINT CHECK (rating >= 0 AND rating <= 4),
    raw_score NUMERIC(4,2),
    notes TEXT,
    checked_in_at TIMESTAMPTZ NOT NULL,
    checkin_timezone TEXT NOT NULL,
    external_event_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotent Yamtrack imports: one check-in per external event.
CREATE UNIQUE INDEX uq_media_checkins_external_event ON media_checkins(user_id, external_event_id)
    WHERE external_event_id IS NOT NULL;
CREATE INDEX idx_media_checkins_user_time ON media_checkins(user_id, checked_in_at DESC);
CREATE INDEX idx_media_checkins_media ON media_checkins(media_item_id, checked_in_at DESC);

CREATE TRIGGER trg_media_checkins_updated_at
    BEFORE UPDATE ON media_checkins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Lists.
CREATE TABLE media_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_media_lists_user ON media_lists(user_id);

CREATE TRIGGER trg_media_lists_updated_at
    BEFORE UPDATE ON media_lists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE media_list_items (
    list_id UUID NOT NULL REFERENCES media_lists(id) ON DELETE CASCADE,
    media_item_id UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    position INT NOT NULL DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (list_id, media_item_id)
);
CREATE INDEX idx_media_list_items_media ON media_list_items(media_item_id);

-- Integration API keys.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS tmdb_api_key VARCHAR(200);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS tgdb_api_key VARCHAR(200);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS hardcover_api_key VARCHAR(200);
