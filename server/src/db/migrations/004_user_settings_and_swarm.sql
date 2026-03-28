-- ============================================================================
-- User settings and Swarm import support
-- ============================================================================

-- User settings for integration credentials
CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    dawarich_url VARCHAR(500),
    dawarich_api_key VARCHAR(500),
    immich_url VARCHAR(500),
    immich_api_key VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add swarm_id to checkins for deduplication during CSV import
ALTER TABLE checkins ADD COLUMN swarm_id VARCHAR(100);
CREATE UNIQUE INDEX idx_checkins_swarm_id ON checkins(swarm_id) WHERE swarm_id IS NOT NULL;

-- Add swarm_venue_id to venues for matching during CSV import
ALTER TABLE venues ADD COLUMN swarm_venue_id VARCHAR(100);
CREATE INDEX idx_venues_swarm_venue_id ON venues(swarm_venue_id) WHERE swarm_venue_id IS NOT NULL;
