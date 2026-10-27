-- ============================================================================
-- Daily weather from Open-Meteo, one row per user and local calendar day.
-- The weather is for the place the user was at local noon that day (latest
-- check-in at or before noon), so the coordinates are stored with the row.
--   ok    - data holds the daily summary (metric units) and 24 hourly entries;
--           data.final is false while the day is too recent for the archive
--   error - the fetch failed (see error); the backfill job retries it
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_weather (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  timezone TEXT NULL,
  data JSONB NULL,
  error TEXT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, local_date)
);

CREATE TRIGGER update_daily_weather_updated_at
  BEFORE UPDATE ON daily_weather
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
