-- Media lists become rankable like the other list types: ranks are 1..n among
-- ranked items, NULL = unranked. Existing items stay unranked (they were
-- collections, not rankings). Lists also get unique names per user
-- (case-insensitive), as music lists have.

-- Rename the later of any case-insensitive duplicates ("Faves" -> "Faves (2)") so the index can be built.
UPDATE media_lists l SET name = l.name || ' (' || d.n || ')'
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, lower(name) ORDER BY created_at, id) AS n
  FROM media_lists
) d
WHERE l.id = d.id AND d.n > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_lists_user_name ON media_lists(user_id, lower(name));

ALTER TABLE media_list_items
  ADD COLUMN IF NOT EXISTS rank INT NULL CHECK (rank IS NULL OR rank >= 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_list_items_rank
  ON media_list_items(list_id, rank) WHERE rank IS NOT NULL;

-- A paused "rank by comparing" session, like the other list types' (066).
CREATE TABLE IF NOT EXISTS media_rank_sessions (
  list_id UUID PRIMARY KEY REFERENCES media_lists(id) ON DELETE CASCADE,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
