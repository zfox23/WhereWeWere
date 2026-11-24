-- ============================================================================
-- Steam integration for the Media plugin.
--
-- A sync reads the user's owned Steam games (with playtime) and merges the
-- playtime into media_items.time_played_minutes, never lowering it.
-- ============================================================================

-- The Steam app a game is linked to. One app links to at most one game.
ALTER TABLE media_items ADD COLUMN steam_appid INTEGER;
CREATE UNIQUE INDEX idx_media_items_steam_appid ON media_items(user_id, steam_appid)
    WHERE steam_appid IS NOT NULL;

-- One row per owned Steam game: the playtime seen at the last sync (to
-- compute how much was played since, for auto check-ins) and the review state.
--   matched   linked to media_item_id
--   unmatched waiting in the review list
--   ignored   the user dismissed it; syncs never re-match it
CREATE TABLE media_steam_games (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appid INTEGER NOT NULL,
    name TEXT NOT NULL,
    playtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (playtime_minutes >= 0),
    last_played_at TIMESTAMPTZ,
    icon_url TEXT,
    status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('matched', 'unmatched', 'ignored')),
    media_item_id UUID REFERENCES media_items(id) ON DELETE SET NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, appid)
);

CREATE INDEX idx_media_steam_games_status ON media_steam_games(user_id, status);

-- Per-user sync bookkeeping for the settings UI and the duplicate check.
CREATE TABLE media_steam_sync_state (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_synced_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT,
    last_summary JSONB
);
