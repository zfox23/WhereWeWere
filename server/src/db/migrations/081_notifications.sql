-- ============================================================================
-- Notifications (Web Push).
--
-- Server-sent push only: reminders reach Android even when the PWA is closed.
-- A device opts in by subscribing; one push_subscriptions row = one device.
-- Per-plugin toggles and schedules live in plugin_settings (core key
-- `notifications_enabled` plus each plugin's own keys).
-- ============================================================================

-- Instance-level secrets the server generates once (e.g. the VAPID key pair;
-- changing it would invalidate every push subscription).
CREATE TABLE IF NOT EXISTS server_secrets (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The push service URL identifies the browser install; re-subscribing
    -- the same browser under another account moves the row to that account.
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    -- The device's IANA zone, refreshed whenever the app opens. Schedules
    -- are wall-clock times in this zone.
    timezone TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);

-- One row per (device, trigger occurrence) sent. The unique key is the claim
-- that makes each scheduled occurrence go out at most once, even if the
-- scheduler ticks twice or two server processes run.
CREATE TABLE notification_deliveries (
    id BIGSERIAL PRIMARY KEY,
    subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL,
    trigger_key TEXT NOT NULL,
    occurrence_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (subscription_id, plugin_id, trigger_key, occurrence_at)
);

CREATE INDEX notification_deliveries_created_at_idx ON notification_deliveries (created_at);
