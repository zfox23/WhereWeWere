CREATE TABLE sleep_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sleep_as_android_id BIGINT NOT NULL,
    sleep_timezone TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    rating NUMERIC(3, 2) NOT NULL DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT sleep_entries_sleep_as_android_id_unique UNIQUE (user_id, sleep_as_android_id),
    CONSTRAINT sleep_entries_time_order CHECK (ended_at >= started_at),
    CONSTRAINT sleep_entries_rating_range CHECK (rating >= 0 AND rating <= 5)
);

CREATE INDEX idx_sleep_entries_user_id ON sleep_entries(user_id);
CREATE INDEX idx_sleep_entries_started_at ON sleep_entries(started_at DESC);

CREATE TRIGGER trg_sleep_entries_updated_at
    BEFORE UPDATE ON sleep_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
