-- ============================================================================
-- Move mood plugin settings out of user_settings into the plugin framework.
--
-- The `mood_icon_pack` column on user_settings was owned by the mood check-in
-- type. It now lives in the generic plugin_settings table under
-- plugin_id = 'mood', key = 'mood_icon_pack' (declared by the plugin's
-- settingsKeys). Existing values are backfilled before the column is dropped
-- so no user preference is lost.
-- ============================================================================

INSERT INTO plugin_settings (user_id, plugin_id, key, value)
SELECT user_id, 'mood', 'mood_icon_pack', to_jsonb(mood_icon_pack)
FROM user_settings
WHERE mood_icon_pack IS NOT NULL
ON CONFLICT (user_id, plugin_id, key) DO NOTHING;

ALTER TABLE user_settings DROP COLUMN IF EXISTS mood_icon_pack;
