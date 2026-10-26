-- ============================================================================
-- Music plugin: one identity for "the same song".
--
-- Scrobblers and imports write the same song differently: Spotify sends
-- "Known You Before" by Jason Ross, Seven Lions and Emilie Brandt; Last.fm has
-- "Known You Before (with Emilie Brandt)" by Jason Ross. Grouping on the exact
-- title and artist list split one song into several, so plays counted
-- differently on the library, a play's page and lists.
--
-- A song is now its title (without a trailing "(feat. X)" / "(with X)" credit
-- or remaster tag, which catalogs and scrobblers disagree about) and its first
-- artist. Remixes, live versions and the like stay separate songs.
-- ============================================================================

CREATE OR REPLACE FUNCTION music_song_key(title TEXT, artists TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(btrim(title)), '\s*[\(\[]\s*(feat\.?|ft\.?|featuring|with)\s[^\)\]]*[\)\]]', '', 'g'),
               '\s*[\(\[][^\)\]]*remaster[^\)\]]*[\)\]]', '', 'g'),
             '\s+-\s+(\d{4}\s+)?remaster.*$', '', 'g'))
         || chr(31) || lower(btrim(COALESCE(artists[1], '')))
$$;

ALTER TABLE music_scrobbles
  ADD COLUMN IF NOT EXISTS song_key TEXT GENERATED ALWAYS AS (music_song_key(title, artists)) STORED;

CREATE INDEX IF NOT EXISTS idx_music_scrobbles_song_key
  ON music_scrobbles(user_id, song_key);

-- List items identify a song by this key too. Re-key them, merging any that
-- are now the same song within one list (the best-ranked, earliest one stays).
DELETE FROM music_list_items d
USING (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY list_id, music_song_key(title, artists)
           ORDER BY rank NULLS LAST, position, added_at, id) AS rn
  FROM music_list_items WHERE kind = 'song'
) x
WHERE d.id = x.id AND x.rn > 1;

UPDATE music_list_items
SET item_key = 'song:' || music_song_key(title, artists)
WHERE kind = 'song';

-- Close any rank gaps the merge left.
UPDATE music_list_items i SET rank = r.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY rank) AS rn
  FROM music_list_items WHERE rank IS NOT NULL
) r
WHERE i.id = r.id AND i.rank IS DISTINCT FROM r.rn;
