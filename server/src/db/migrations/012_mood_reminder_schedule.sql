-- Add per-user daily mood reminder schedule (HH:MM 24-hour local time)
ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS mood_reminder_times TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE user_settings
SET mood_reminder_times = ARRAY[]::TEXT[]
WHERE mood_reminder_times IS NULL;
