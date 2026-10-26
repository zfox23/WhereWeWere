-- Ranked list items keep a gap-free 1..n block of ranks. Anything that deletes
-- items closes the hole it leaves: removing an item from a list, but also the
-- cascades (deleting a check-in, a venue or a media item takes its list
-- memberships with it), which no application code ever sees.
--
-- A statement-level trigger sees every deleted row at once, so a bulk delete
-- renumbers each affected list once. Ranks are parked far above any real rank
-- first so the unique (list_id, rank) indexes never collide mid-statement.
CREATE OR REPLACE FUNCTION close_list_rank_gaps() RETURNS trigger AS $fn$
BEGIN
  EXECUTE format(
    'UPDATE %1$I SET rank = rank + 1000000
     WHERE rank IS NOT NULL AND list_id IN (SELECT list_id FROM removed WHERE rank IS NOT NULL)',
    TG_TABLE_NAME);
  EXECUTE format(
    'UPDATE %1$I t SET rank = r.rn
     FROM (SELECT ctid AS row_id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY rank) AS rn
           FROM %1$I
           WHERE rank IS NOT NULL AND list_id IN (SELECT list_id FROM removed WHERE rank IS NOT NULL)) r
     WHERE t.ctid = r.row_id',
    TG_TABLE_NAME);
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_checkin_list_items_close_gaps
  AFTER DELETE ON checkin_list_items
  REFERENCING OLD TABLE AS removed
  FOR EACH STATEMENT EXECUTE FUNCTION close_list_rank_gaps();

CREATE TRIGGER trg_venue_list_items_close_gaps
  AFTER DELETE ON venue_list_items
  REFERENCING OLD TABLE AS removed
  FOR EACH STATEMENT EXECUTE FUNCTION close_list_rank_gaps();

CREATE TRIGGER trg_media_list_items_close_gaps
  AFTER DELETE ON media_list_items
  REFERENCING OLD TABLE AS removed
  FOR EACH STATEMENT EXECUTE FUNCTION close_list_rank_gaps();

CREATE TRIGGER trg_music_list_items_close_gaps
  AFTER DELETE ON music_list_items
  REFERENCING OLD TABLE AS removed
  FOR EACH STATEMENT EXECUTE FUNCTION close_list_rank_gaps();
