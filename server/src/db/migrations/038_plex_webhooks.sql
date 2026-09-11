-- ============================================================================
-- Plex webhooks: table to log every incoming Plex webhook event.
--
-- Used for display ("N events received") and debugging, mirroring
-- sleep_webhook_events. Also adds the comma-separated Plex username filter to
-- user_settings: media.scrobble events are only tracked when the Plex account
-- that triggered them matches one of these usernames (empty = track all).
-- ============================================================================

CREATE TABLE plex_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    plex_username TEXT,
    raw_body JSONB,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_plex_webhook_events_user_id ON plex_webhook_events(user_id);
CREATE INDEX idx_plex_webhook_events_received_at ON plex_webhook_events(received_at DESC);

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS plex_usernames TEXT;
