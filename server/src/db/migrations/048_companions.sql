-- ============================================================================
-- Shared companion database.
--
-- Companions (people "with" on a check-in) are supported by any check-in type
-- that implements them (location, media, ...). The rows live in one
-- core-owned table instead of per-plugin tables, keyed by the check-in
-- type's plugin id plus the check-in id, so every plugin shares the same
-- storage, the same autocomplete name pool, and the same service layer
-- (server/src/services/companions.ts).
--
-- Replaces the location-plugin-owned checkin_companions table (migration
-- 046), whose rows are moved into the shared table below.
-- ============================================================================

CREATE TABLE IF NOT EXISTS companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_type TEXT NOT NULL,
  checkin_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (checkin_type, checkin_id, name)
);
CREATE INDEX IF NOT EXISTS idx_companions_checkin ON companions(checkin_type, checkin_id);
CREATE INDEX IF NOT EXISTS idx_companions_name    ON companions(name);

-- Move the location check-in companions into the shared table.
INSERT INTO companions (checkin_type, checkin_id, name, created_at)
SELECT 'location', cc.checkin_id, cc.name, cc.created_at
FROM checkin_companions cc
ON CONFLICT (checkin_type, checkin_id, name) DO NOTHING;

DROP TABLE IF EXISTS checkin_companions;
