-- Add daylio dedup hash to mood_checkins for import idempotency
ALTER TABLE mood_checkins ADD COLUMN IF NOT EXISTS daylio_hash VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mood_checkins_daylio_hash
    ON mood_checkins(daylio_hash) WHERE daylio_hash IS NOT NULL;
