-- ============================================================================
-- Multi-user accounts: password login, sessions, per-user webhooks and jobs.
--
-- The pre-existing single user (00000000-0000-0000-0000-000000000001) keeps
-- its id, so every row it already owns stays owned by it. It becomes the
-- instance admin. Its password_hash stays the unusable 'no-auth' placeholder
-- until one is set with `npm run user:set-password` (see docs/accounts.md).
-- ============================================================================

-- Accounts have no email; keep the column (and any existing value) but stop
-- requiring it.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users
    ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN disabled_at TIMESTAMPTZ,
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN password_changed_at TIMESTAMPTZ,
    -- Secret path segment for inbound webhooks (Sleep as Android, Plex), which
    -- can't log in. 64 hex chars from two v4 UUIDs (~244 random bits).
    ADD COLUMN webhook_token TEXT NOT NULL
        DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

ALTER TABLE users ADD CONSTRAINT users_webhook_token_key UNIQUE (webhook_token);

-- Usernames are case-insensitive for uniqueness and login, displayed as typed.
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));
ALTER TABLE users ADD CONSTRAINT users_username_format
    CHECK (username ~ '^[A-Za-z0-9_.-]{3,30}$');

UPDATE users SET is_admin = TRUE WHERE id = '00000000-0000-0000-0000-000000000001';

-- Login sessions. Only a SHA-256 of the cookie token is stored, so a database
-- leak doesn't hand out live sessions.
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    remember BOOLEAN NOT NULL,
    user_agent TEXT,
    ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- Jobs become per-user; existing ones belong to the original user.
ALTER TABLE jobs ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE jobs SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
ALTER TABLE jobs ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX idx_jobs_user_id ON jobs(user_id);

DROP INDEX IF EXISTS idx_jobs_one_active_per_type;
CREATE UNIQUE INDEX idx_jobs_one_active_per_user_type
    ON jobs (user_id, type)
    WHERE status IN ('pending', 'running');

-- Companions were keyed only by (checkin_type, checkin_id); give them an owner
-- so the name pool and renames are per-user. Existing ones belong to the
-- original user.
ALTER TABLE companions ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE companions SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
ALTER TABLE companions ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX idx_companions_user_name ON companions(user_id, name);
