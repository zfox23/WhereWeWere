-- ============================================================================
-- Checkin lists: named lists of LOCATION CHECK-INS (not venues), so events
-- like concerts or broadway shows can be collected into one browsable section
-- without a new check-in type.
--
-- Mirrors the venue_lists / venue_list_items design (migration 046), except
-- the items reference checkins (which cascade away when the check-in is
-- deleted) and carry a nullable `rank` for manual ordering. Ranks are
-- 1..n gap-free per list; NULL = unranked (sorts to the bottom).
-- ============================================================================

CREATE TABLE checkin_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX idx_checkin_lists_user ON checkin_lists(user_id);

CREATE TRIGGER trg_checkin_lists_updated_at
  BEFORE UPDATE ON checkin_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE checkin_list_items (
  list_id UUID NOT NULL REFERENCES checkin_lists(id) ON DELETE CASCADE,
  checkin_id UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  -- Manual rank within the list; NULL = unranked. Only one item per list
  -- may hold a given rank (enforced by the partial unique index below).
  rank INT NULL CHECK (rank IS NULL OR rank >= 1),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, checkin_id)
);
CREATE INDEX idx_checkin_list_items_checkin ON checkin_list_items(checkin_id);
CREATE UNIQUE INDEX idx_checkin_list_items_rank
  ON checkin_list_items(list_id, rank) WHERE rank IS NOT NULL;
