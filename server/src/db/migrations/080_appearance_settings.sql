-- Per-user appearance knobs (background pattern/gradient and future display
-- options). One JSONB object validated by shared/src/appearance.ts so new
-- knobs don't need a column each. Previously these lived only in the
-- browser's localStorage.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS appearance JSONB NOT NULL DEFAULT '{}'::jsonb;
