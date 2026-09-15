-- ============================================================================
-- Item-level user metadata for media_items.
--
-- rating / raw_score / notes / time_played_minutes (games) / status live on
-- the media item itself, independently of any check-in event. The same
-- columns remain on media_checkins for per-episode/per-session context, but
-- are no longer aggregated into the item display for games.
--
-- No backfill: existing items start with NULL item-level fields; display
-- falls back to the latest check-in's rating on the server side.
-- ============================================================================

ALTER TABLE media_items
  ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating IS NULL OR (rating >= 0 AND rating <= 4)),
  ADD COLUMN IF NOT EXISTS raw_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS time_played_minutes INTEGER CHECK (time_played_minutes IS NULL OR time_played_minutes >= 0),
  ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('completed','in_progress','dropped'));

CREATE INDEX IF NOT EXISTS idx_media_items_rating ON media_items(user_id, rating) WHERE rating IS NOT NULL;

-- Synthetic games-CSV check-ins are now redundant (their data lives on the
-- item) and would keep inflating completed_count — remove them.
DELETE FROM media_checkins WHERE external_event_id LIKE 'ggbl:%';
