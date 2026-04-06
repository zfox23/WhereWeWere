ALTER TABLE checkins
ADD COLUMN IF NOT EXISTS checkin_timezone TEXT;
