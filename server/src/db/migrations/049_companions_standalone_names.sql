-- ============================================================================
-- Allow standalone companion names (Profile "Companions" tab).
--
-- The Companions tab manages the shared companion name pool directly, so a
-- name that has never been attached to a check-in can be added on its own.
-- Such "standalone" rows have checkin_type IS NULL and checkin_id IS NULL.
-- They only feed the name pool (autocomplete) and never affect check-in
-- companion lists, timeline companion filtering, or stats, all of which
-- match rows on (checkin_type, checkin_id) or count rows with a checkin_id.
--
-- PostgreSQL unique constraints treat NULLs as distinct, so a partial unique
-- index enforces "at most one standalone row per name" (case-insensitively).
-- ============================================================================

ALTER TABLE companions ALTER COLUMN checkin_type DROP NOT NULL;
ALTER TABLE companions ALTER COLUMN checkin_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companions_standalone_name
  ON companions (lower(name))
  WHERE checkin_id IS NULL;
