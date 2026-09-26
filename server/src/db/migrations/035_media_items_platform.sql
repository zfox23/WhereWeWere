-- Video game platform (e.g. "PlayStation 2", "Game Boy Color"), sourced from IGDB.
ALTER TABLE media_items ADD COLUMN IF NOT EXISTS platform TEXT;
