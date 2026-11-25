-- ============================================================================
-- Steam auto check-ins: one check-in per play session.
--
-- Steam raises a game's playtime while it is running, so an hourly sync saw
-- a long session as several increases and logged a check-in for each. A
-- sync now only notes that a session is open while playtime keeps rising,
-- and logs one check-in for the whole session once it stops.
--
--   checkin_baseline_minutes  Steam's total when the open session began (or,
--                             with no session open, at the last sync)
--   session_started_at        the sync before the session's first increase;
--                             NULL when no session is open
--   session_last_rise_at      the sync that last saw playtime rise
-- ============================================================================

ALTER TABLE media_steam_games
    ADD COLUMN checkin_baseline_minutes INTEGER CHECK (checkin_baseline_minutes >= 0),
    ADD COLUMN session_started_at TIMESTAMPTZ,
    ADD COLUMN session_last_rise_at TIMESTAMPTZ;

UPDATE media_steam_games SET checkin_baseline_minutes = playtime_minutes;
