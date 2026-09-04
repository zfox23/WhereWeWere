-- Store a SHA-256 hash of the uploaded .gpx file content so duplicate
-- uploads can be detected. NULL for tracks uploaded before this migration.
ALTER TABLE tracks ADD COLUMN file_hash TEXT;

-- Only enforce uniqueness where a hash exists.
CREATE UNIQUE INDEX idx_tracks_user_file_hash ON tracks (user_id, file_hash) WHERE file_hash IS NOT NULL;
