-- ============================================================================
-- Allow 'igdb' as a media_items.external_source value.
--
-- IGDB (via the Twitch OAuth client-credentials flow) becomes the provider
-- for game metadata. The CHECK constraint from migration 033 only listed
-- tmdb/hardcover. The partial unique index idx_media_items_external is
-- unchanged: it is keyed on (user_id, media_type, external_source,
-- external_id), so different provider rows for the same game can coexist.
-- ============================================================================

-- Drop the existing check by name (033 declared it inline on the column).
ALTER TABLE media_items DROP CONSTRAINT IF EXISTS media_items_external_source_check;
ALTER TABLE media_items ADD CONSTRAINT media_items_external_source_check
  CHECK (external_source IN ('tmdb', 'hardcover', 'igdb'));
