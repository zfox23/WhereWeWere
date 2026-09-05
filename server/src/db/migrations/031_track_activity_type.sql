-- Activity type for uploaded tracks, derived from the GPX <type> element
-- or the TCX Activity @Sport attribute (e.g. "Biking", "Running").
-- NULL for tracks uploaded before this migration.
ALTER TABLE tracks ADD COLUMN activity_type TEXT;
