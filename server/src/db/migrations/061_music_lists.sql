-- ============================================================================
-- Music plugin: user-made lists (favorites and so on) of songs and albums.
--
-- Items are identified by an opaque key built in SQL from the same expressions
-- the library groups plays by (see plugins/music/services/identity.ts), so a
-- list entry keeps matching its plays across re-imports and restores. The
-- display fields are copied from a play when the item is added.
-- ============================================================================

CREATE TABLE IF NOT EXISTS music_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_music_lists_user_name
  ON music_lists(user_id, lower(name));

CREATE TABLE IF NOT EXISTS music_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES music_lists(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('song', 'album')),
  title TEXT NOT NULL,
  artists TEXT[] NOT NULL DEFAULT '{}',
  -- Albums: the album itself. Songs: the album they were added from.
  album TEXT,
  album_ref TEXT,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (list_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_music_list_items_list
  ON music_list_items(list_id, position);
