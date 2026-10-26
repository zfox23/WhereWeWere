-- Hand-entered plays ("I heard this song out in the world"): a note, where
-- the play happened, and who was there (companions live in the core
-- companions table, keyed by the scrobble id). Sessions remember whether they
-- contain one, so the Home timeline always shows them.
ALTER TABLE music_scrobbles ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE music_scrobbles ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE music_scrobbles ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
-- Meters, as reported by the device.
ALTER TABLE music_scrobbles ADD COLUMN IF NOT EXISTS location_accuracy INT;

ALTER TABLE music_sessions ADD COLUMN IF NOT EXISTS has_manual BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE music_sessions s SET has_manual = TRUE
WHERE EXISTS (SELECT 1 FROM music_scrobbles m WHERE m.session_id = s.id AND m.source = 'manual');
