-- ============================================================================
-- Similarity analysis over mood check-ins that have text (opt-in via the
-- notes plugin's include_mood_entries setting). Derived data, rebuilt by the
-- notes-similarity job: mood entries get their own embedding and theme-member
-- rows (cascading with the mood check-in) and share the themes with notes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS note_mood_embeddings (
  mood_checkin_id UUID PRIMARY KEY REFERENCES mood_checkins(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dims INT NOT NULL,
  chunk_count INT NOT NULL,
  embedding REAL[] NOT NULL,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_theme_mood_members (
  mood_checkin_id UUID NOT NULL REFERENCES mood_checkins(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES note_themes(id) ON DELETE CASCADE,
  rank SMALLINT NOT NULL CHECK (rank IN (1, 2)),
  score REAL NOT NULL,
  PRIMARY KEY (mood_checkin_id, theme_id)
);

CREATE INDEX IF NOT EXISTS idx_note_theme_mood_members_theme ON note_theme_mood_members (theme_id);

-- Neighbor lists for every pair that involves a mood entry (note <-> mood and
-- mood <-> mood); note <-> note pairs stay in note_neighbors. Each id is a
-- note_checkins or mood_checkins id, so there are no entry foreign keys: the
-- job rewrites a user's rows each run and readers join to the entry tables.
CREATE TABLE IF NOT EXISTS note_mood_neighbors (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL,
  neighbor_id UUID NOT NULL,
  similarity REAL NOT NULL,
  PRIMARY KEY (entry_id, neighbor_id)
);

CREATE INDEX IF NOT EXISTS idx_note_mood_neighbors_user ON note_mood_neighbors (user_id);
