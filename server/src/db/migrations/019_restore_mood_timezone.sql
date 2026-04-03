ALTER TABLE mood_checkins
ADD COLUMN IF NOT EXISTS mood_timezone TEXT;
