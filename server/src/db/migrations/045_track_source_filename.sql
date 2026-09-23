-- Remember the filename of the originally-uploaded .gpx/.tcx file so
-- backups can ship it under its original name. NULL for tracks restored
-- from v1 backups or created before this migration.
ALTER TABLE tracks ADD COLUMN source_filename TEXT;
