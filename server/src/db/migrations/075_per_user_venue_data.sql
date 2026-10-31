-- Venues are a shared catalog, but a venue's star rating and its Coasterpedia
-- lookup are a user's own. Ratings move to a per-user table (the existing ones
-- belong to the original user); venues.rating is left in place, no longer
-- read or written, so nothing is lost.

CREATE TABLE venue_ratings (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, venue_id)
);

CREATE INDEX idx_venue_ratings_venue_id ON venue_ratings(venue_id);

INSERT INTO venue_ratings (user_id, venue_id, rating)
SELECT '00000000-0000-0000-0000-000000000001', id, rating
FROM venues
WHERE rating IS NOT NULL;

COMMENT ON COLUMN venues.rating IS 'Superseded by venue_ratings (migration 075); kept unused.';

-- One Coasterpedia record per (venue, user) instead of per venue.
ALTER TABLE venue_coasterpedia DROP CONSTRAINT venue_coasterpedia_pkey;
ALTER TABLE venue_coasterpedia ADD PRIMARY KEY (venue_id, user_id);
