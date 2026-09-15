-- ============================================================================
-- TGDB-sourced game metadata for media_items (game rows only).
--
-- overview / content_rating / players / coop come straight off the TGDB Game
-- object; genres / developers / publishers are resolved from TGDB id arrays
-- into name arrays. All nullable: non-game rows and local-only games stay
-- NULL. `content_rating` is the ESRB-style rating (e.g. "E - Everyone") —
-- kept distinct from the user's own 0-4 star `rating` column (migration 040).
-- No backfill: existing games are enriched by re-running the CSV import or
-- the detail-page provider sync.
-- ============================================================================

ALTER TABLE media_items
  ADD COLUMN IF NOT EXISTS overview TEXT,
  ADD COLUMN IF NOT EXISTS content_rating TEXT,
  ADD COLUMN IF NOT EXISTS players INT CHECK (players IS NULL OR players > 0),
  ADD COLUMN IF NOT EXISTS coop TEXT,
  ADD COLUMN IF NOT EXISTS genres TEXT[],
  ADD COLUMN IF NOT EXISTS developers TEXT[],
  ADD COLUMN IF NOT EXISTS publishers TEXT[];
