-- ============================================================================
-- Music plugin: locally stored scrobbles (fed by multi-scrobbler and file
-- imports) and the listening sessions they are grouped into for the Home
-- timeline.
--
-- music_scrobbles is idempotent on (user, played_at, title, artists) so a
-- live push and an overlapping import never double-count a play.
-- music_sessions is derived data (rebuilt from scrobbles whenever the gap or
-- timezone setting changes), materialized so the timeline never has to run
-- window functions over the whole history.
-- ============================================================================

CREATE TABLE IF NOT EXISTS music_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  track_count INT NOT NULL,
  listened_seconds INT NOT NULL DEFAULT 0,
  top_artists JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_sessions_user_ended
  ON music_sessions(user_id, ended_at DESC);

CREATE TABLE IF NOT EXISTS music_scrobbles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  artists TEXT[] NOT NULL,
  album TEXT,
  album_artists TEXT[] NOT NULL DEFAULT '{}',
  track_length INT,
  listened_for INT,
  source TEXT,
  session_id UUID REFERENCES music_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_music_scrobbles_unique
  ON music_scrobbles(user_id, played_at, lower(title), artists);
CREATE INDEX IF NOT EXISTS idx_music_scrobbles_user_played
  ON music_scrobbles(user_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_scrobbles_session
  ON music_scrobbles(session_id);
