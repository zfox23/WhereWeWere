-- Repair migration for databases where version 024 was marked applied
-- but user_settings.distance_unit was not actually added.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS distance_unit VARCHAR(20);

UPDATE user_settings
SET distance_unit = 'metric'
WHERE distance_unit IS NULL;

ALTER TABLE user_settings
  ALTER COLUMN distance_unit SET DEFAULT 'metric';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_distance_unit_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_distance_unit_check
      CHECK (distance_unit IN ('metric', 'imperial'));
  END IF;
END $$;
