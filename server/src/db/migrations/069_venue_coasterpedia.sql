-- ============================================================================
-- Coasterpedia enrichment for venues in the "Amusement Ride" category.
-- One row per venue holds the outcome of the last lookup:
--   matched   - data holds the Coasterpedia attraction record
--   ambiguous - several candidates matched; candidates holds them for the user to pick
--   no_match  - nothing matched; the user can enter a Coasterpedia ID or URL
--   error     - the lookup failed (see error); the user can retry
-- Missing API key is not stored: the UI derives it from the plugin setting.
-- ============================================================================

CREATE TABLE IF NOT EXISTS venue_coasterpedia (
  venue_id UUID PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('matched', 'ambiguous', 'no_match', 'error')),
  attraction_id INT NULL,
  data JSONB NULL,
  candidates JSONB NULL,
  error TEXT NULL,
  -- name/parent the lookup ran against, so a later save only re-runs it when they change
  looked_up_name TEXT NULL,
  looked_up_parent UUID NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venue_coasterpedia_user ON venue_coasterpedia(user_id);

CREATE TRIGGER update_venue_coasterpedia_updated_at
  BEFORE UPDATE ON venue_coasterpedia
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
