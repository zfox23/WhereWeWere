-- Add Maloja URL to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS maloja_url VARCHAR(500);

-- Cache table for scrobbles fetched from Maloja per check-in
CREATE TABLE IF NOT EXISTS checkin_scrobbles (
    checkin_id UUID PRIMARY KEY REFERENCES checkins(id) ON DELETE CASCADE,
    scrobbles JSONB NOT NULL DEFAULT '[]',
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);
