-- Dedupe keys that were unique across the whole instance become unique per
-- user, so one user's Swarm/Daylio import (or standalone companion name)
-- can't block -- or reveal -- another user's.

DROP INDEX IF EXISTS idx_checkins_swarm_id;
CREATE UNIQUE INDEX idx_checkins_user_swarm_id
    ON checkins (user_id, swarm_id) WHERE swarm_id IS NOT NULL;

DROP INDEX IF EXISTS idx_mood_checkins_daylio_hash;
CREATE UNIQUE INDEX idx_mood_checkins_user_daylio_hash
    ON mood_checkins (user_id, daylio_hash) WHERE daylio_hash IS NOT NULL;

DROP INDEX IF EXISTS idx_companions_standalone_name;
CREATE UNIQUE INDEX idx_companions_user_standalone_name
    ON companions (user_id, lower(name)) WHERE checkin_id IS NULL;
