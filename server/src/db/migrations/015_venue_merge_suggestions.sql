CREATE TABLE venue_merge_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_a_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  venue_b_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  canonical_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  duplicate_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  canonical_name VARCHAR(255) NOT NULL,
  duplicate_name VARCHAR(255) NOT NULL,
  canonical_checkin_count INTEGER NOT NULL DEFAULT 0,
  duplicate_checkin_count INTEGER NOT NULL DEFAULT 0,
  similarity_score NUMERIC(6, 4) NOT NULL,
  distance_meters INTEGER NOT NULL,
  reason VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT venue_merge_suggestions_status_check CHECK (status IN ('pending', 'denied', 'applied', 'invalid')),
  CONSTRAINT venue_merge_suggestions_distinct_pair CHECK (venue_a_id IS NULL OR venue_b_id IS NULL OR venue_a_id <> venue_b_id)
);

CREATE UNIQUE INDEX idx_venue_merge_suggestions_pair ON venue_merge_suggestions (venue_a_id, venue_b_id);
CREATE INDEX idx_venue_merge_suggestions_status ON venue_merge_suggestions (status, created_at DESC);

CREATE TRIGGER trg_venue_merge_suggestions_updated_at
  BEFORE UPDATE ON venue_merge_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();