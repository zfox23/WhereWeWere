-- Update checkin_type check on media_checkins
ALTER TABLE media_checkins
  DROP CONSTRAINT IF EXISTS media_checkins_checkin_type_check;

ALTER TABLE media_checkins
  ADD CONSTRAINT media_checkins_checkin_type_check
  CHECK (checkin_type IN ('completed', 'in_progress', 'dropped', 'started'));

-- Update status check on media_items
ALTER TABLE media_items
  DROP CONSTRAINT IF EXISTS media_items_status_check;

ALTER TABLE media_items
  ADD CONSTRAINT media_items_status_check
  CHECK (status IN ('completed', 'in_progress', 'dropped', 'started'));