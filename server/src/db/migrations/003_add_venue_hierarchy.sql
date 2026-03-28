-- Add parent-child hierarchy to venues (e.g. Terminal F -> Philadelphia International Airport)
ALTER TABLE venues
  ADD COLUMN parent_venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  ADD CONSTRAINT venues_no_self_parent CHECK (parent_venue_id != id);

CREATE INDEX idx_venues_parent_venue_id ON venues(parent_venue_id);
