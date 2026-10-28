-- ============================================================================
-- Food check-ins (food plugin): one row per meal.
--   recipe_name        - what was eaten: a snapshot of the Mealie recipe name
--                        (kept so the timeline survives renames/deletions in
--                        Mealie), or free text for meals not in Mealie
--   mealie_recipe_*    - the Mealie recipe, when the meal came from one
--   location_checkin_id - optional link to a location check-in (e.g. a
--                        restaurant). No FK: that table belongs to another plugin.
--   mealie_event_id    - the "made this" timeline event written to Mealie, so
--                        edits and deletes can update or remove it
-- ============================================================================

CREATE TABLE IF NOT EXISTS food_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_name TEXT NOT NULL,
  mealie_recipe_id TEXT NULL,
  mealie_recipe_slug TEXT NULL,
  rating SMALLINT NULL CHECK (rating BETWEEN 1 AND 4),
  notes TEXT NULL,
  location_checkin_id UUID NULL,
  mealie_event_id TEXT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checkin_timezone TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_checkins_user_time ON food_checkins (user_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_checkins_location ON food_checkins (location_checkin_id) WHERE location_checkin_id IS NOT NULL;

CREATE TRIGGER update_food_checkins_updated_at
  BEFORE UPDATE ON food_checkins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
