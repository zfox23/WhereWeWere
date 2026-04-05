-- ============================================================================
-- WhereWeWere Initial Schema
-- ============================================================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Venue categories table (self-referencing for hierarchy)
CREATE TABLE venue_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    icon VARCHAR(50),
    parent_id UUID REFERENCES venue_categories(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Venues table
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    category_id UUID REFERENCES venue_categories(id),
    address VARCHAR(500),
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100),
    postal_code VARCHAR(20),
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    osm_id VARCHAR(50),
    created_by UUID REFERENCES users(id),
    search_vector TSVECTOR,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Checkins table
CREATE TABLE checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    venue_id UUID NOT NULL REFERENCES venues(id),
    notes TEXT,
    checked_in_at TIMESTAMPTZ DEFAULT NOW(),
    search_vector TSVECTOR,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Checkin photos table
CREATE TABLE checkin_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkin_id UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255),
    mime_type VARCHAR(50),
    caption TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Checkin indexes
CREATE INDEX idx_checkins_user_id ON checkins(user_id);
CREATE INDEX idx_checkins_venue_id ON checkins(venue_id);
CREATE INDEX idx_checkins_checked_in_at ON checkins(checked_in_at DESC);

-- Venue indexes
CREATE INDEX idx_venues_lat_lng ON venues(latitude, longitude);
CREATE INDEX idx_venues_name ON venues(name);
CREATE INDEX idx_venues_osm_id ON venues(osm_id);
CREATE INDEX idx_venues_category_id ON venues(category_id);

-- Photo indexes
CREATE INDEX idx_checkin_photos_checkin_id ON checkin_photos(checkin_id);

-- Full-text search GIN indexes
CREATE INDEX idx_venues_search ON venues USING GIN(search_vector);
CREATE INDEX idx_checkins_search ON checkins USING GIN(search_vector);

-- ============================================================================
-- Full-text search triggers
-- ============================================================================

-- Venue search vector: combines name, address, city, state, country
CREATE OR REPLACE FUNCTION venues_search_vector_update() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.address, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.city, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.state, '')), 'C') ||
        setweight(to_tsvector('english', COALESCE(NEW.country, '')), 'C');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_venues_search_vector
    BEFORE INSERT OR UPDATE OF name, address, city, state, country
    ON venues
    FOR EACH ROW
    EXECUTE FUNCTION venues_search_vector_update();

-- Checkin search vector: combines notes
CREATE OR REPLACE FUNCTION checkins_search_vector_update() RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.notes, '')), 'A');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_checkins_search_vector
    BEFORE INSERT OR UPDATE OF notes
    ON checkins
    FOR EACH ROW
    EXECUTE FUNCTION checkins_search_vector_update();

-- ============================================================================
-- Updated_at triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_venues_updated_at
    BEFORE UPDATE ON venues
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_checkins_updated_at
    BEFORE UPDATE ON checkins
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Seed default venue categories
-- ============================================================================

INSERT INTO venue_categories (name, icon) VALUES
    ('Food', 'utensils'),
    ('Coffee Shop', 'coffee'),
    ('Bar', 'beer'),
    ('Park', 'tree'),
    ('Gym', 'dumbbell'),
    ('Office', 'briefcase'),
    ('Home', 'home'),
    ('Shop', 'shopping-bag'),
    ('Museum', 'landmark'),
    ('Theater', 'film'),
    ('Hotel', 'bed'),
    ('Airport', 'plane'),
    ('Train Station', 'train'),
    ('Beach', 'umbrella-beach'),
    ('Library', 'book');
