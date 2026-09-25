-- ============================================================================
-- Location check-in enhancements:
--   1) Check-in star rating (1-4 or NULL = unrated)
--   2) Venue star rating (item-level attribute, 1-4 or NULL = unrated)
--   3) checkin_companions — people "here with" on a check-in
--   4) venue_lists / venue_list_items — named lists venues can be in
-- (mirrors the media plugin's media_lists / media_list_items design)
-- ============================================================================

-- 1) Check-in rating
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS rating SMALLINT
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 4));

CREATE INDEX IF NOT EXISTS idx_checkins_rating ON checkins(user_id, rating) WHERE rating IS NOT NULL;

-- 2) Venue rating (item-level attribute, like media_items.rating)
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS rating SMALLINT
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 4));

CREATE INDEX IF NOT EXISTS idx_venues_rating ON venues(rating) WHERE rating IS NOT NULL;

-- 3) Companions (people "here with" on a check-in)
CREATE TABLE checkin_companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (checkin_id, name)
);
CREATE INDEX idx_checkin_companions_checkin ON checkin_companions(checkin_id);
CREATE INDEX idx_checkin_companions_name    ON checkin_companions(name);

-- 4) Venue lists (mirrors media_lists / media_list_items)
CREATE TABLE venue_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX idx_venue_lists_user ON venue_lists(user_id);

CREATE TRIGGER trg_venue_lists_updated_at
  BEFORE UPDATE ON venue_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE venue_list_items (
  list_id UUID NOT NULL REFERENCES venue_lists(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, venue_id)
);
CREATE INDEX idx_venue_list_items_venue ON venue_list_items(venue_id);
