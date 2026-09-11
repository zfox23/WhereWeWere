-- Book metadata from Hardcover: page count and series position/total.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS page_count INT;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS series_name TEXT;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS series_position INT;
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS series_count INT;
