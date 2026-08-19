-- Add theme preference to user_settings
-- (notifications_enabled was added here historically and later removed;
--  see 027_drop_notifications.sql)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'system';
