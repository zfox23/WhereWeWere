-- Store per-point track data (timestamp, elevation, heart rate) as JSONB so
-- the client can render graphs. Coordinates already live in `path`, and the
-- array order matches the points of the LineString.
--
-- Shape: [{ "t": 1700000000000, "ele": 152.4, "hr": 141 }, ...]
--   t   - epoch milliseconds, or null if the point had no timestamp
--   ele - elevation in meters, or null
--   hr  - heart rate in bpm, or null
-- NULL for tracks uploaded before this migration.
ALTER TABLE tracks ADD COLUMN points JSONB;
