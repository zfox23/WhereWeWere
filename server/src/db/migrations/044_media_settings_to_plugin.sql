-- ============================================================================
-- Move media plugin settings out of user_settings into the plugin framework.
--
-- The `tmdb_api_key`, `hardcover_api_key`, and
-- `plex_usernames` columns on user_settings were owned by the media check-in
-- type. They now live in the generic plugin_settings table under
-- plugin_id = 'media' with matching key names (declared by the media plugin's
-- settingsKeys). Existing values are backfilled before the columns are
-- dropped so no user preference is lost.
-- ============================================================================

INSERT INTO plugin_settings (user_id, plugin_id, key, value)
SELECT user_id, 'media', 'tmdb_api_key', to_jsonb(tmdb_api_key)
FROM user_settings
WHERE tmdb_api_key IS NOT NULL
ON CONFLICT (user_id, plugin_id, key) DO NOTHING;

INSERT INTO plugin_settings (user_id, plugin_id, key, value)
SELECT user_id, 'media', 'hardcover_api_key', to_jsonb(hardcover_api_key)
FROM user_settings
WHERE hardcover_api_key IS NOT NULL
ON CONFLICT (user_id, plugin_id, key) DO NOTHING;

INSERT INTO plugin_settings (user_id, plugin_id, key, value)
SELECT user_id, 'media', 'plex_usernames', to_jsonb(plex_usernames)
FROM user_settings
WHERE plex_usernames IS NOT NULL
ON CONFLICT (user_id, plugin_id, key) DO NOTHING;

ALTER TABLE user_settings DROP COLUMN IF EXISTS tmdb_api_key;
ALTER TABLE user_settings DROP COLUMN IF EXISTS hardcover_api_key;
ALTER TABLE user_settings DROP COLUMN IF EXISTS plex_usernames;
