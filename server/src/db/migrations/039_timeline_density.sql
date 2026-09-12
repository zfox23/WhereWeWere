-- Add timeline density preference (comfortable/compact) to user settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS timeline_density VARCHAR(20) DEFAULT 'comfortable';

UPDATE user_settings
SET timeline_density = 'comfortable'
WHERE timeline_density IS NULL;

ALTER TABLE user_settings
  ALTER COLUMN timeline_density SET DEFAULT 'comfortable';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_timeline_density_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_timeline_density_check
      CHECK (timeline_density IN ('comfortable', 'compact'));
  END IF;
END $$;
