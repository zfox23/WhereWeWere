-- ============================================================================
-- Music plugin: album artwork and release info.
--
-- music_scrobbles.album_key identifies an album the way the artwork lookup
-- does (lower-cased album + first album artist, or first track artist). It is
-- generated so imports, restores and live pushes all agree.
--
-- music_albums is a rebuildable cache of lookups against public catalogs
-- (not part of backups): one row per album_key, with the matched release's
-- metadata and tracklist. Several keys can share one release (a soundtrack
-- imported with a different artist on each track), so art files are named
-- after the release, not the key.
-- ============================================================================

ALTER TABLE music_scrobbles
  ADD COLUMN IF NOT EXISTS album_key TEXT GENERATED ALWAYS AS (
    CASE WHEN album IS NULL OR btrim(album) = '' THEN NULL
         ELSE lower(btrim(album)) || '|' || lower(btrim(COALESCE(album_artists[1], artists[1], '')))
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_music_scrobbles_album_key
  ON music_scrobbles(user_id, album_key) WHERE album_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS music_albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('matched', 'not_found')),
  provider TEXT,
  external_id TEXT,
  title TEXT,
  artist TEXT,
  release_date TEXT,
  label TEXT,
  tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Source image URLs; the thumbnail is stored on disk, the large image is
  -- fetched and cached the first time it is opened.
  thumb_file TEXT,
  large_url TEXT,
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, album_key)
);

CREATE INDEX IF NOT EXISTS idx_music_albums_release
  ON music_albums(user_id, provider, external_id);
