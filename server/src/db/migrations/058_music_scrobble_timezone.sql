-- ============================================================================
-- Music scrobbles carry the IANA timezone they were played in, like every
-- other check-in type. The source data (multi-scrobbler, Maloja exports) is
-- epoch seconds only, so the zone is assigned from the user's other check-ins
-- (the latest timezone-bearing check-in at or before the play). Plays with no
-- earlier check-in use the music plugin's fallback timezone setting.
-- ============================================================================

ALTER TABLE music_scrobbles ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
