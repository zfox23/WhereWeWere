-- ============================================================================
-- Music plugin: genres.
--
-- Genres come from MusicBrainz for albums (their release group) and artists,
-- and can be corrected by the user. A play takes its album's genres, or, when
-- the album has none (or the play has no album), its first artist's.
--
-- One row per album (`item_key` = music_scrobbles.album_key) or artist
-- (`item_key` = lower(btrim(name))). `status` is the catalog lookup's outcome,
-- NULL while only a user edit exists. `user_genres` replaces the catalog's
-- genres when set (an empty array means "none"), and survives re-lookups.
-- ============================================================================

CREATE TABLE IF NOT EXISTS music_genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('album', 'artist')),
  item_key TEXT NOT NULL,
  status TEXT CHECK (status IN ('matched', 'not_found')),
  mbid TEXT,
  catalog_genres TEXT[] NOT NULL DEFAULT '{}',
  user_genres TEXT[],
  genres TEXT[] GENERATED ALWAYS AS (COALESCE(user_genres, catalog_genres)) STORED,
  looked_up_at TIMESTAMPTZ,
  UNIQUE (user_id, kind, item_key)
);
