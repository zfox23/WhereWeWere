-- Add theme preference and notification settings to user_settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'system';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
