-- Remove all leftovers from the removed notifications feature
DROP TABLE IF EXISTS push_delivery_logs;
DROP TABLE IF EXISTS push_subscriptions;
ALTER TABLE user_settings DROP COLUMN IF EXISTS notifications_enabled;
ALTER TABLE user_settings DROP COLUMN IF EXISTS mood_reminder_times;
