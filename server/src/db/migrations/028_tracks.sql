CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    distance_m NUMERIC(12, 2) NOT NULL DEFAULT 0,
    elapsed_time_s BIGINT NOT NULL DEFAULT 0,
    moving_time_s BIGINT NOT NULL DEFAULT 0,
    elevation_gain_m NUMERIC(12, 2) NOT NULL DEFAULT 0,
    avg_speed_mps NUMERIC(10, 3) NOT NULL DEFAULT 0,
    max_speed_mps NUMERIC(10, 3) NOT NULL DEFAULT 0,
    avg_hr SMALLINT,
    max_hr SMALLINT,
    point_count INTEGER NOT NULL DEFAULT 0,
    path GEOMETRY(LineString, 4326) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT tracks_time_order CHECK (ended_at >= started_at),
    CONSTRAINT tracks_moving_time_range CHECK (moving_time_s >= 0 AND moving_time_s <= elapsed_time_s)
);

CREATE INDEX idx_tracks_user_id ON tracks(user_id);
CREATE INDEX idx_tracks_started_at ON tracks(started_at DESC);
CREATE INDEX idx_tracks_path ON tracks USING GIST (path);

CREATE TRIGGER trg_tracks_updated_at
    BEFORE UPDATE ON tracks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
