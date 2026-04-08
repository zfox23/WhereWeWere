-- Table to log every incoming Sleep as Android webhook event.
-- Used for display ("N events received") and debugging.
CREATE TABLE sleep_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    value1 TEXT,
    value2 TEXT,
    value3 TEXT,
    raw_body JSONB,
    received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sleep_webhook_events_user_id ON sleep_webhook_events(user_id);
CREATE INDEX idx_sleep_webhook_events_received_at ON sleep_webhook_events(received_at DESC);

-- Allow sleep entries that were started via webhook to be marked as
-- in-progress (tracking started, not yet stopped).
ALTER TABLE sleep_entries ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT FALSE;
