-- ============================================================================
-- Music plugin: Spotify.
--
-- Each user brings their own Spotify app (Client ID and Secret) and signs in
-- with it. Credentials and tokens live here, not in plugin_settings, so they
-- never travel in backups.
--
-- Playlists are a copy of the user's Spotify library, refreshed by a sync.
-- Their tracks are matched to plays by song key (the same identity the
-- library uses), so a track counts the plays of that song however it was
-- scrobbled.
-- ============================================================================

CREATE TABLE IF NOT EXISTS music_spotify_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  -- The signed-in Spotify account (NULL until connected).
  spotify_user_id TEXT,
  display_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  connected_at TIMESTAMPTZ,
  -- A sign-in in progress: the state Spotify must send back, and the redirect
  -- URL it was started with (the token exchange must repeat it).
  oauth_state TEXT,
  oauth_redirect_uri TEXT,
  oauth_started_at TIMESTAMPTZ,
  -- Playlist sync bookkeeping.
  last_synced_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  last_summary JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per playlist in the user's Spotify library, in Spotify's order.
CREATE TABLE IF NOT EXISTS music_spotify_playlists (
  user_id UUID NOT NULL REFERENCES music_spotify_accounts(user_id) ON DELETE CASCADE,
  spotify_id TEXT NOT NULL,
  position INT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT,
  owner_name TEXT,
  image_url TEXT,
  collaborative BOOLEAN NOT NULL DEFAULT false,
  public BOOLEAN,
  snapshot_id TEXT,
  total_tracks INT,
  -- Spotify only lists the tracks of playlists the user owns or collaborates
  -- on (for Development Mode apps); others keep their metadata only.
  tracks_available BOOLEAN NOT NULL DEFAULT false,
  -- The snapshot the stored tracks were read at; a different snapshot_id means re-read.
  tracks_snapshot_id TEXT,
  -- Newest "date added" among its tracks: Spotify has no last-modified date.
  last_modified_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, spotify_id)
);

CREATE TABLE IF NOT EXISTS music_spotify_playlist_tracks (
  user_id UUID NOT NULL,
  playlist_id TEXT NOT NULL,
  position INT NOT NULL,
  -- NULL for local files.
  spotify_id TEXT,
  title TEXT NOT NULL,
  artists TEXT[] NOT NULL DEFAULT '{}',
  album TEXT,
  duration_ms INT,
  added_at TIMESTAMPTZ,
  is_local BOOLEAN NOT NULL DEFAULT false,
  song_key TEXT GENERATED ALWAYS AS (music_song_key(title, artists)) STORED,
  PRIMARY KEY (user_id, playlist_id, position),
  FOREIGN KEY (user_id, playlist_id) REFERENCES music_spotify_playlists(user_id, spotify_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_music_spotify_playlist_tracks_song
  ON music_spotify_playlist_tracks(user_id, song_key);

-- Which Spotify track, album or artist a song (song_key), album (album_key)
-- or artist (lower(btrim(name))) is. spotify_id NULL: searched, no confident match.
CREATE TABLE IF NOT EXISTS music_spotify_links (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('song', 'album', 'artist')),
  item_key TEXT NOT NULL,
  spotify_id TEXT,
  looked_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind, item_key)
);

-- The Spotify playlist a list was exported to, so later exports update it.
CREATE TABLE IF NOT EXISTS music_spotify_exports (
  list_id UUID PRIMARY KEY REFERENCES music_lists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spotify_playlist_id TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  track_count INT NOT NULL DEFAULT 0,
  -- Items that had no Spotify match at the last export: [{ kind, title, artists }].
  unmatched JSONB NOT NULL DEFAULT '[]'::jsonb
);
