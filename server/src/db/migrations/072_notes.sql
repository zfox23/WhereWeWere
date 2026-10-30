-- ============================================================================
-- Notes (notes plugin): free-form markdown notes with colored tags, plus the
-- derived data of the similarity analysis (embeddings, neighbors, themes).
--   title / body       - optional title, markdown body
--   source             - 'manual' (written in the app) or 'import' (a file)
--   source_filename    - the imported file's name, for reference
--   content_hash       - md5 of title + body: embeddings remember the hash
--                        they were computed from, so edits mark them stale
-- ============================================================================

CREATE TABLE IF NOT EXISTS note_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NULL,
  body TEXT NOT NULL DEFAULT '',
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checkin_timezone TEXT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  source_filename TEXT NULL,
  content_hash TEXT GENERATED ALWAYS AS (md5(COALESCE(title, '') || E'\n' || body)) STORED,
  word_count INT GENERATED ALWAYS AS (
    CASE WHEN body ~ '\S'
      THEN cardinality(regexp_split_to_array(btrim(body, E' \t\r\n'), '\s+'))
      ELSE 0 END
  ) STORED,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english'::regconfig, COALESCE(title, '')), 'A')
    || setweight(to_tsvector('english'::regconfig, body), 'B')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (COALESCE(btrim(title), '') <> '' OR body ~ '\S')
);

CREATE INDEX IF NOT EXISTS idx_note_checkins_user_time ON note_checkins (user_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_checkins_search ON note_checkins USING GIN (search_vector);

CREATE TRIGGER update_note_checkins_updated_at
  BEFORE UPDATE ON note_checkins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS note_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 60),
  color TEXT NOT NULL DEFAULT '#6366f1' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_note_tags_user_name ON note_tags (user_id, lower(name));

CREATE TRIGGER update_note_tags_updated_at
  BEFORE UPDATE ON note_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS note_tag_links (
  note_id UUID NOT NULL REFERENCES note_checkins(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tag_links_tag ON note_tag_links (tag_id);

-- ---------------------------------------------------------------------------
-- Similarity analysis (derived; rebuilt by the notes-similarity job)
-- ---------------------------------------------------------------------------

-- One mean-pooled, L2-normalized vector per note.
CREATE TABLE IF NOT EXISTS note_embeddings (
  note_id UUID PRIMARY KEY REFERENCES note_checkins(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dims INT NOT NULL,
  chunk_count INT NOT NULL,
  embedding REAL[] NOT NULL,
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Clusters of similar notes, named by the LLM.
CREATE TABLE IF NOT EXISTS note_themes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NULL,
  color TEXT NOT NULL,
  size INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_note_themes_user ON note_themes (user_id);

-- rank 1 = the note's primary theme, rank 2 = a close second.
CREATE TABLE IF NOT EXISTS note_theme_members (
  note_id UUID NOT NULL REFERENCES note_checkins(id) ON DELETE CASCADE,
  theme_id UUID NOT NULL REFERENCES note_themes(id) ON DELETE CASCADE,
  rank SMALLINT NOT NULL CHECK (rank IN (1, 2)),
  score REAL NOT NULL,
  PRIMARY KEY (note_id, theme_id)
);

CREATE INDEX IF NOT EXISTS idx_note_theme_members_theme ON note_theme_members (theme_id);

-- Each note's most similar notes (cosine similarity of the embeddings).
CREATE TABLE IF NOT EXISTS note_neighbors (
  note_id UUID NOT NULL REFERENCES note_checkins(id) ON DELETE CASCADE,
  neighbor_id UUID NOT NULL REFERENCES note_checkins(id) ON DELETE CASCADE,
  similarity REAL NOT NULL,
  PRIMARY KEY (note_id, neighbor_id)
);
