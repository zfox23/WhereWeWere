-- The source URL of an album's stored thumbnail. Backups carry the thumbnails
-- as files; when a restore can't (a plain JSON backup), the lookup job uses
-- this to download the ones that are missing. NULL means the release has no cover.
ALTER TABLE music_albums ADD COLUMN IF NOT EXISTS thumb_url TEXT;
