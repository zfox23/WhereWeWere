-- Add icon field to mood_activities for custom icons
ALTER TABLE mood_activities ADD COLUMN IF NOT EXISTS icon VARCHAR(100);

-- Delete all previously imported Daylio entries to start fresh
DELETE FROM mood_checkins WHERE daylio_hash IS NOT NULL;

-- Update display_order to properly sort activities if not already set
ALTER TABLE mood_activity_groups ALTER COLUMN display_order SET DEFAULT 0;
ALTER TABLE mood_activities ALTER COLUMN display_order SET DEFAULT 0;
