-- Add distance unit preference to user settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS distance_unit VARCHAR(20) DEFAULT 'metric';

UPDATE user_settings
SET distance_unit = 'metric'
WHERE distance_unit IS NULL;

ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_distance_unit_check
  CHECK (distance_unit IN ('metric', 'imperial'));
