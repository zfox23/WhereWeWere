-- ============================================================================
-- Scrobbles now live in music_scrobbles (migration 056), fed directly by
-- multi-scrobbler. Drop the per-check-in cache of an external scrobble
-- server's responses, and the URL setting that pointed at it.
-- ============================================================================

DROP TABLE IF EXISTS checkin_scrobbles;
ALTER TABLE user_settings DROP COLUMN IF EXISTS maloja_url;
