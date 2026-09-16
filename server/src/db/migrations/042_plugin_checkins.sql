-- ============================================================================
-- Check-In Type Plugin Framework
-- ============================================================================
-- Generic storage for plugin check-in types. A plugin that does not ship a
-- custom store keeps all of its per-check-in data in `data` (JSONB, validated
-- against the plugin's field schema). The timestamp and timezone are first-
-- class columns so the unified timeline can order and date-filter them
-- without touching JSONB.
--
-- Plugin settings: free-form key/value rows per user per plugin. Keys are
-- declared (with type + default) by the plugin's `settingsKeys`.

CREATE TABLE plugin_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plugin_id VARCHAR(50) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checkin_timezone VARCHAR(50),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plugin_checkins_plugin_user ON plugin_checkins(plugin_id, user_id);
CREATE INDEX idx_plugin_checkins_checked_in_at ON plugin_checkins(checked_in_at DESC);

CREATE TRIGGER trg_plugin_checkins_updated_at
    BEFORE UPDATE ON plugin_checkins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE plugin_settings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plugin_id VARCHAR(50) NOT NULL,
    key VARCHAR(100) NOT NULL,
    value JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, plugin_id, key)
);

CREATE INDEX idx_plugin_settings_plugin ON plugin_settings(plugin_id);

CREATE TRIGGER trg_plugin_settings_updated_at
    BEFORE UPDATE ON plugin_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
