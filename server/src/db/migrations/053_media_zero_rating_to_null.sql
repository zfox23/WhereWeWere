-- 0 means "no rating" in the UI; stored zeros shadowed real check-in ratings
-- (COALESCE of item rating over latest check-in rating) and skewed stats.
UPDATE media_items SET rating = NULL WHERE rating = 0;
UPDATE media_checkins SET rating = NULL WHERE rating = 0;
