-- Cumulative "Total Time Played" (in minutes) for a game at the time of that
-- check-in. Newer check-ins carry the updated total (values are not summed).
ALTER TABLE media_checkins ADD COLUMN IF NOT EXISTS time_played_minutes INTEGER
    CHECK (time_played_minutes IS NULL OR time_played_minutes >= 0);
