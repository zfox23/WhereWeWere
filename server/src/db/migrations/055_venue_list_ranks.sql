-- ============================================================================
-- Venue list ranking: lets a venue list (e.g. "Favorite roller coasters") be
-- manually ordered, mirroring checkin_list_items.rank (migration 051).
-- Ranks are 1..n gap-free per list; NULL = unranked (sorts to the bottom).
-- ============================================================================

ALTER TABLE venue_list_items
  ADD COLUMN rank INT NULL CHECK (rank IS NULL OR rank >= 1);

CREATE UNIQUE INDEX idx_venue_list_items_rank
  ON venue_list_items(list_id, rank) WHERE rank IS NOT NULL;
