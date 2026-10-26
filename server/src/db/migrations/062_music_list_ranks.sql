-- Music lists are ranked like Places lists: ranked items form a gap-free 1..n
-- block, the rest are unranked (NULL). Existing items keep the order they
-- were kept in, as ranks.
ALTER TABLE music_list_items ADD COLUMN IF NOT EXISTS rank INT;

UPDATE music_list_items i SET rank = r.rank
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY position, added_at, id) AS rank
  FROM music_list_items
) r
WHERE i.id = r.id AND i.rank IS NULL;

-- When a list last changed, for the lists index.
ALTER TABLE music_lists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Looks up a song's plays (title is the indexable half of a song's identity).
CREATE INDEX IF NOT EXISTS idx_music_scrobbles_user_title
  ON music_scrobbles(user_id, (lower(btrim(title))));
