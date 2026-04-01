-- ============================================================================
-- Mood Checkins
-- ============================================================================

-- Activity groups (e.g., "Social", "Health", "Hobbies")
CREATE TABLE mood_activity_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mood_activity_groups_user ON mood_activity_groups(user_id);

CREATE TRIGGER trg_mood_activity_groups_updated_at
    BEFORE UPDATE ON mood_activity_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Activities within groups (e.g., "Walking", "Gaming", "Family")
CREATE TABLE mood_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES mood_activity_groups(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mood_activities_group ON mood_activities(group_id);

CREATE TRIGGER trg_mood_activities_updated_at
    BEFORE UPDATE ON mood_activities
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Mood checkins
CREATE TABLE mood_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mood SMALLINT NOT NULL CHECK (mood >= 1 AND mood <= 5),
    note TEXT,
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mood_checkins_user ON mood_checkins(user_id);
CREATE INDEX idx_mood_checkins_checked_in_at ON mood_checkins(checked_in_at DESC);

CREATE TRIGGER trg_mood_checkins_updated_at
    BEFORE UPDATE ON mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Junction table for mood checkin <-> activities
CREATE TABLE mood_checkin_activities (
    mood_checkin_id UUID NOT NULL REFERENCES mood_checkins(id) ON DELETE CASCADE,
    activity_id UUID NOT NULL REFERENCES mood_activities(id) ON DELETE CASCADE,
    PRIMARY KEY (mood_checkin_id, activity_id)
);

CREATE INDEX idx_mood_checkin_activities_activity ON mood_checkin_activities(activity_id);

-- Add mood icon pack setting
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS mood_icon_pack VARCHAR(20) DEFAULT 'emoji';
