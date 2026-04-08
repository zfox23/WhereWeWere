ALTER TABLE checkins
ADD COLUMN IF NOT EXISTS client_ref_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS checkins_user_client_ref_id_unique
ON checkins (user_id, client_ref_id)
WHERE client_ref_id IS NOT NULL;

ALTER TABLE mood_checkins
ADD COLUMN IF NOT EXISTS client_ref_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mood_checkins_user_client_ref_id_unique
ON mood_checkins (user_id, client_ref_id)
WHERE client_ref_id IS NOT NULL;